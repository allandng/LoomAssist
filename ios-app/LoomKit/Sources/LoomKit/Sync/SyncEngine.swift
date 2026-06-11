import Foundation
import GRDB

/// Cloud sync engine — encrypt-push / pull-decrypt-apply against the AWS API.
/// Semantic port of backend-api/services/cloudsync/engine.py (protocol
/// schema_version 2). The desktop file is the reference; behavior divergence
/// is a bug here unless commented otherwise.
///
/// - Payloads carry NO local primary keys; FKs travel as `<col>__ref` keys
///   holding the target's record_id, translated at the edges.
/// - Push order is calendar → event → task (referenced before referrer).
/// - Pulls that reference a not-yet-seen record defer and retry within the
///   run; stragglers force-apply with NULL refs.
/// - Conflict policy: whole-record last-write-wins by the row's
///   `last_modified` string; server optimistic concurrency (version + 409)
///   keeps simultaneous writers from clobbering.
/// - Records with a different schema_version are skipped, not guessed at.
public final class SyncEngine {
    public static let schemaVersion = LoomKit.syncSchemaVersion

    /// Insertion order = push order: referenced types before referrers.
    static let syncedTypes: [(type: String, prefix: String)] = [
        ("calendar", "cal"),
        ("event", "evt"),
        ("task", "tsk"),
    ]

    /// Local FK columns that travel as record_id references.
    static let fkRefs: [String: [String: String]] = [
        "event": ["calendar_id": "calendar", "depends_on_event_id": "event"],
        "task": ["event_id": "event"],
    ]

    /// SQLite stores booleans as 0/1; the desktop serializes them as JSON
    /// true/false. These columns are emitted as booleans on push.
    static let boolColumns: [String: Set<String>] = [
        "calendar": ["created_via_sync", "is_course"],
        "event": ["is_recurring", "is_all_day"],
        "task": ["is_complete"],
    ]

    public struct Summary: Equatable, Sendable {
        public var pull: [String: Int]
        public var push: [String: Int]
        public var cursor: Int64
    }

    public enum SyncError: Error {
        case decryptFailed(recordId: String)
        case payloadNotJSON(recordId: String)
    }

    private struct UnresolvedRef: Error { let recordId: String }

    private let db: AppDatabase
    private let client: any SyncAPIClient
    private let dek: Data
    private let deviceId: String
    private let now: () -> String

    public init(db: AppDatabase, client: any SyncAPIClient, dek: Data,
                deviceId: String,
                now: @escaping () -> String = SyncEngine.isoNow) {
        self.db = db
        self.client = client
        self.dek = dek
        self.deviceId = deviceId
        self.now = now
    }

    public static func isoNow() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS"
        return formatter.string(from: Date())
    }

    /// One full cycle: pull (LWW apply) then push.
    ///
    /// All GRDB access goes through the small synchronous helpers below —
    /// in an async context the compiler picks DatabaseWriter's async
    /// overloads, whose @Sendable closures can't share the engine's
    /// mutable pull/push bookkeeping.
    public func run() async throws -> Summary {
        let cursor = try ensureConfigAndReadCursor()
        let records = try await client.recordsSince(cursor)
        let pullCounts = try applyPulled(records, since: cursor)
        let pushCounts = try await push()
        let newCursor = try stampLastSynced()
        return Summary(pull: pullCounts, push: pushCounts, cursor: newCursor)
    }

    private func ensureConfigAndReadCursor() throws -> Int64 {
        try db.writer.write { db in
            if let config = try CloudSyncConfig.fetchOne(db, key: "me") {
                return config.pullCursor
            }
            try CloudSyncConfig().insert(db)
            return 0
        }
    }

    private func stampLastSynced() throws -> Int64 {
        try db.writer.write { db in
            var config = try CloudSyncConfig.fetchOne(db, key: "me")!
            config.lastSyncedAt = self.now()
            try config.update(db)
            return config.pullCursor
        }
    }

    // MARK: - Pull

    private func applyPulled(_ records: [ServerRecord], since: Int64) throws -> [String: Int] {
        var counts = ["created": 0, "updated": 0, "deleted": 0, "kept_local": 0,
                      "skipped": 0, "skipped_schema": 0, "unresolved_refs": 0]

        try db.writer.write { db in
            var maxSeen = since
            var deferred: [ServerRecord] = []

            for record in records {
                maxSeen = max(maxSeen, record.lastModified)
                if try !self.applyOne(db, record, counts: &counts, forceRefs: false) {
                    deferred.append(record)
                }
            }

            // Referenced records may have arrived later in the same pull —
            // retry until a pass makes no progress, then force with NULL refs.
            while !deferred.isEmpty {
                var still: [ServerRecord] = []
                for record in deferred {
                    if try !self.applyOne(db, record, counts: &counts, forceRefs: false) {
                        still.append(record)
                    }
                }
                if still.count == deferred.count {
                    for record in still {
                        _ = try self.applyOne(db, record, counts: &counts, forceRefs: true)
                        counts["unresolved_refs"]! += 1
                    }
                    break
                }
                deferred = still
            }

            var config = try CloudSyncConfig.fetchOne(db, key: "me")!
            config.pullCursor = maxSeen
            try config.update(db)
        }
        return counts
    }

    /// Apply one pulled record. Returns false if deferred on an unresolved ref.
    private func applyOne(_ db: Database, _ record: ServerRecord,
                          counts: inout [String: Int], forceRefs: Bool) throws -> Bool {
        guard Self.syncedTypes.contains(where: { $0.type == record.recordType }) else {
            counts["skipped"]! += 1
            return true
        }
        let table = record.recordType
        var state = try CloudSyncState.filter(Column("record_id") == record.recordId).fetchOne(db)

        // Our own write echoing back, or anything already processed.
        if let s = state, record.version <= s.serverVersion {
            counts["skipped"]! += 1
            return true
        }

        if record.tombstone {
            if var s = state {
                let row = try Row.fetchOne(
                    db, sql: "SELECT * FROM \(table) WHERE id = ?", arguments: [s.localId]
                )
                if let row, row["deleted_at"] == nil {
                    try db.execute(
                        sql: "UPDATE \(table) SET deleted_at = ? WHERE id = ?",
                        arguments: [now(), s.localId]
                    )
                    counts["deleted"]! += 1
                }
                s.serverVersion = record.version
                s.deleted = true
                try s.update(db)
            } else {
                counts["skipped"]! += 1  // delete of a record we never had
            }
            return true
        }

        guard let ciphertextB64 = record.ciphertext, let nonceB64 = record.nonce,
              let ciphertext = Data(base64Encoded: ciphertextB64),
              let nonce = Data(base64Encoded: nonceB64) else {
            throw SyncError.decryptFailed(recordId: record.recordId)
        }
        let plaintext: Data
        do {
            plaintext = try Vault.decryptRecord(ciphertext: ciphertext, nonce: nonce, dek: dek)
        } catch {
            throw SyncError.decryptFailed(recordId: record.recordId)
        }
        guard let envelope = try JSONSerialization.jsonObject(with: plaintext) as? [String: Any] else {
            throw SyncError.payloadNotJSON(recordId: record.recordId)
        }
        guard envelope["schema_version"] as? Int == Self.schemaVersion else {
            counts["skipped_schema"]! += 1
            return true
        }
        let data = envelope["data"] as? [String: Any] ?? [:]

        if state == nil {
            let resolution: ([String: Int64?], [String])
            do {
                resolution = try resolveRefs(db, data, force: forceRefs)
            } catch is UnresolvedRef {
                return false
            }
            var (resolved, _) = resolution
            // NOT NULL FK integrity on create:
            if table == "task", (resolved["event_id"] ?? nil) == nil {
                // a task without its event is meaningless — drop it
                counts["skipped"]! += 1
                return true
            }
            if table == "event", (resolved["calendar_id"] ?? nil) == nil {
                resolved.updateValue(try fallbackCalendarId(db), forKey: "calendar_id")
            }
            let localId = try insertRow(db, table: table, data: data, resolved: resolved)
            var newState = CloudSyncState(
                recordType: table,
                localId: localId,
                recordId: record.recordId,
                serverVersion: record.version,
                syncedLocalModified: data["last_modified"] as? String
            )
            try newState.insert(db)
            counts["created"]! += 1
        } else {
            guard let row = try Row.fetchOne(
                db, sql: "SELECT * FROM \(table) WHERE id = ?", arguments: [state!.localId]
            ) else {
                state!.serverVersion = record.version
                try state!.update(db)
                counts["skipped"]! += 1
                return true
            }
            let rowLM: String? = row["last_modified"]
            let localDirty = rowLM != state!.syncedLocalModified
            if localDirty, lm(rowLM) > lm(data["last_modified"] as? String) {
                // Local unpushed edit is newer — keep it; bumping
                // server_version lets the push phase win the version check.
                state!.serverVersion = record.version
                try state!.update(db)
                counts["kept_local"]! += 1
            } else {
                do {
                    try applyPayload(db, table: table, localId: state!.localId,
                                     data: data, forceRefs: forceRefs)
                } catch is UnresolvedRef {
                    return false
                }
                state!.serverVersion = record.version
                state!.syncedLocalModified = data["last_modified"] as? String
                state!.deleted = false
                try state!.update(db)
                counts["updated"]! += 1
            }
        }
        return true
    }

    // MARK: - Push

    private func push() async throws -> [String: Int] {
        var counts = ["pushed": 0, "deleted": 0, "conflict_lost": 0, "orphan_tombstoned": 0]

        try assignRecordIds()

        // Pass 1: push dirty rows in dependency order.
        for (type, _) in Self.syncedTypes {
            for localId in try liveRowIds(table: type) {
                guard let outcome = try await pushRow(table: type, localId: localId) else { continue }
                counts[outcome]! += 1
            }
        }

        // Pass 2: states whose local row was hard-deleted (calendar deletes) —
        // tombstone server-side so other devices learn.
        for var state in try findOrphanStates() {
            let result = try await client.deleteRecord(state.recordId)
            state.serverVersion = result.version
            state.deleted = true
            try saveState(state)
            counts["orphan_tombstoned"]! += 1
        }

        return counts
    }

    /// Pass 0: assign record_ids to every live unsynced row first, so __ref
    /// serialization resolves regardless of within-type ordering.
    private func assignRecordIds() throws {
        try db.writer.write { db in
            for (type, prefix) in Self.syncedTypes {
                let rows = try Row.fetchAll(db, sql: "SELECT id, deleted_at FROM \(type)")
                for row in rows {
                    let localId: Int64 = row["id"]
                    let deletedAt: String? = row["deleted_at"]
                    if deletedAt == nil,
                       try CloudSyncState
                           .filter(Column("record_type") == type && Column("local_id") == localId)
                           .fetchOne(db) == nil {
                        var state = CloudSyncState(
                            recordType: type,
                            localId: localId,
                            recordId: "\(prefix)_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
                        )
                        try state.insert(db)
                    }
                }
            }
        }
    }

    private func liveRowIds(table: String) throws -> [Int64] {
        try db.writer.read {
            try Int64.fetchAll($0, sql: "SELECT id FROM \(table) ORDER BY id")
        }
    }

    private func findOrphanStates() throws -> [CloudSyncState] {
        try db.writer.read { db in
            var found: [CloudSyncState] = []
            for state in try CloudSyncState.filter(Column("deleted") == false).fetchAll(db) {
                guard Self.syncedTypes.contains(where: { $0.type == state.recordType }) else { continue }
                let exists = try Bool.fetchOne(
                    db, sql: "SELECT EXISTS(SELECT 1 FROM \(state.recordType) WHERE id = ?)",
                    arguments: [state.localId]
                ) ?? false
                if !exists { found.append(state) }
            }
            return found
        }
    }

    private func saveState(_ state: CloudSyncState) throws {
        try db.writer.write { try state.update($0) }
    }

    private struct Pending {
        var state: CloudSyncState
        var rowLM: String?
        var ciphertext: String
        var nonce: String
    }

    private enum PushAction {
        case nothing
        case tombstone(CloudSyncState, rowLM: String?)
        case put(Pending)
    }

    private func preparePush(table: String, localId: Int64) throws -> PushAction {
        try db.writer.read { db in
            guard let row = try Row.fetchOne(
                db, sql: "SELECT * FROM \(table) WHERE id = ?", arguments: [localId]
            ) else { return .nothing }
            guard let state = try CloudSyncState
                .filter(Column("record_type") == table && Column("local_id") == localId)
                .fetchOne(db) else {
                return .nothing  // deleted_at row that was never synced
            }
            let rowLM: String? = row["last_modified"]
            let deletedAt: String? = row["deleted_at"]

            if deletedAt != nil {
                if state.deleted { return .nothing }  // tombstone already on server
                return .tombstone(state, rowLM: rowLM)
            }
            if rowLM == state.syncedLocalModified, !state.deleted {
                return .nothing  // clean
            }
            let plaintext = try self.serialize(db, table: table, row: row)
            let (ciphertext, nonce) = try Vault.encryptRecord(plaintext, dek: self.dek)
            return .put(Pending(
                state: state, rowLM: rowLM,
                ciphertext: ciphertext.base64EncodedString(),
                nonce: nonce.base64EncodedString()
            ))
        }
    }

    /// Server won the version race: apply its copy locally and align state.
    private func applyServerWin(table: String, localId: Int64, data: [String: Any],
                                state: CloudSyncState, serverVersion: Int,
                                rowLM: String?) throws {
        try db.writer.write { db in
            try self.applyPayload(db, table: table, localId: localId,
                                  data: data, forceRefs: true)
            var aligned = state
            aligned.serverVersion = serverVersion
            aligned.syncedLocalModified = rowLM
            try aligned.update(db)
        }
    }

    /// Returns "pushed" | "deleted" | "conflict_lost" | nil.
    private func pushRow(table: String, localId: Int64) async throws -> String? {
        switch try preparePush(table: table, localId: localId) {
        case .nothing:
            return nil

        case .tombstone(var state, let rowLM):
            let result = try await client.deleteRecord(state.recordId)
            state.serverVersion = result.version
            state.deleted = true
            state.syncedLocalModified = rowLM
            try saveState(state)
            return "deleted"

        case .put(let pending):
            var result: PutResult
            do {
                result = try await client.putRecord(
                    pending.state.recordId,
                    ciphertext: pending.ciphertext, nonce: pending.nonce,
                    recordType: table,
                    expectedVersion: pending.state.serverVersion,
                    deviceId: deviceId
                )
            } catch let SyncAPIError.versionConflict(_, currentVersion) {
                if let current = try await client.getRecord(pending.state.recordId),
                   !current.tombstone,
                   let serverData = try decryptEnvelope(current),
                   lm(serverData["last_modified"] as? String) >= lm(pending.rowLM) {
                    // Server is newer — take it (LWW), stop pushing ours.
                    try applyServerWin(table: table, localId: localId, data: serverData,
                                       state: pending.state, serverVersion: current.version,
                                       rowLM: pending.rowLM)
                    return "conflict_lost"
                }
                // Ours is newer (or server tombstoned a record we just
                // edited): retry once at the current version.
                result = try await client.putRecord(
                    pending.state.recordId,
                    ciphertext: pending.ciphertext, nonce: pending.nonce,
                    recordType: table,
                    expectedVersion: currentVersion ?? 0,
                    deviceId: deviceId
                )
            }
            var state = pending.state
            state.serverVersion = result.version
            state.syncedLocalModified = pending.rowLM
            state.deleted = false
            try saveState(state)
            return "pushed"
        }
    }

    /// Decrypts a server record's envelope; nil if schema_version mismatches.
    private func decryptEnvelope(_ record: ServerRecord) throws -> [String: Any]? {
        guard let ciphertextB64 = record.ciphertext, let nonceB64 = record.nonce,
              let ciphertext = Data(base64Encoded: ciphertextB64),
              let nonce = Data(base64Encoded: nonceB64) else { return nil }
        let plaintext = try Vault.decryptRecord(ciphertext: ciphertext, nonce: nonce, dek: dek)
        guard let envelope = try JSONSerialization.jsonObject(with: plaintext) as? [String: Any],
              envelope["schema_version"] as? Int == Self.schemaVersion else { return nil }
        return envelope["data"] as? [String: Any]
    }

    // MARK: - Serialization (desktop _serialize)

    func serialize(_ db: Database, table: String, row: Row) throws -> Data {
        let refCols = Self.fkRefs[table] ?? [:]
        let bools = Self.boolColumns[table] ?? []
        var data: [String: Any] = [:]

        for (column, dbValue) in row where column != "id" {
            if refCols[column] != nil { continue }  // replaced by __ref below
            data[column] = jsonValue(dbValue, isBool: bools.contains(column))
        }
        for (column, refType) in refCols {
            let localId: Int64? = row[column]
            var ref: String? = nil
            if let localId,
               let target = try CloudSyncState
                   .filter(Column("record_type") == refType && Column("local_id") == localId)
                   .fetchOne(db) {
                ref = target.recordId  // dangling FK -> nil
            }
            data["\(column)__ref"] = ref ?? NSNull()
        }
        let envelope: [String: Any] = [
            "type": table,
            "data": data,
            "schema_version": Self.schemaVersion,
        ]
        return try JSONSerialization.data(withJSONObject: envelope)
    }

    // MARK: - Ref resolution + row writes (desktop _resolve_refs / _set_columns)

    /// Returns (resolved {col: localId-or-nil}, unresolved [col]). Throws
    /// UnresolvedRef unless force.
    private func resolveRefs(_ db: Database, _ data: [String: Any],
                             force: Bool) throws -> ([String: Int64?], [String]) {
        var resolved: [String: Int64?] = [:]
        var unresolved: [String] = []
        for (key, value) in data where key.hasSuffix("__ref") {
            let col = String(key.dropLast("__ref".count))
            guard let recordId = value as? String else {
                resolved.updateValue(nil, forKey: col)  // null or malformed ref
                continue
            }
            if let target = try CloudSyncState
                .filter(Column("record_id") == recordId).fetchOne(db) {
                resolved.updateValue(target.localId, forKey: col)
            } else if force {
                resolved.updateValue(nil, forKey: col)
                unresolved.append(col)
            } else {
                throw UnresolvedRef(recordId: recordId)
            }
        }
        return (resolved, unresolved)
    }

    private func insertRow(_ db: Database, table: String,
                           data: [String: Any], resolved: [String: Int64?]) throws -> Int64 {
        let tableColumns = Set(try db.columns(in: table).map(\.name))
        var values: [String: (any DatabaseValueConvertible)?] = [:]
        for (key, value) in data
        where key != "id" && !key.hasSuffix("__ref") && tableColumns.contains(key) {
            values[key] = Self.dbValue(value)
        }
        for (col, localId) in resolved where tableColumns.contains(col) {
            values.updateValue(localId, forKey: col)
        }
        let columns = values.keys.sorted()
        let sql = """
            INSERT INTO \(table) (\(columns.joined(separator: ", ")))
            VALUES (\(columns.map { ":\($0)" }.joined(separator: ", ")))
            """
        try db.execute(sql: sql, arguments: StatementArguments(values))
        return db.lastInsertedRowID
    }

    /// Update path: set plain columns, resolve refs. Unresolvable refs under
    /// force keep the row's current value rather than nulling a live FK.
    private func applyPayload(_ db: Database, table: String, localId: Int64,
                              data: [String: Any], forceRefs: Bool) throws {
        var (resolved, unresolved) = try resolveRefs(db, data, force: forceRefs)
        for col in unresolved {
            resolved.removeValue(forKey: col)
        }
        let tableColumns = Set(try db.columns(in: table).map(\.name))
        var values: [String: (any DatabaseValueConvertible)?] = [:]
        for (key, value) in data
        where key != "id" && !key.hasSuffix("__ref") && tableColumns.contains(key) {
            values[key] = Self.dbValue(value)
        }
        for (col, ref) in resolved where tableColumns.contains(col) {
            values.updateValue(ref, forKey: col)
        }
        guard !values.isEmpty else { return }
        let columns = values.keys.sorted()
        values["__pk"] = localId
        let sql = """
            UPDATE \(table)
            SET \(columns.map { "\($0) = :\($0)" }.joined(separator: ", "))
            WHERE id = :__pk
            """
        try db.execute(sql: sql, arguments: StatementArguments(values))
    }

    /// Event.calendar_id is NOT NULL — events whose calendar can't be
    /// resolved land on the first live calendar, or a 'Synced' one we create
    /// (which then syncs out like any other row).
    private func fallbackCalendarId(_ db: Database) throws -> Int64 {
        if let id = try Int64.fetchOne(
            db, sql: "SELECT id FROM calendar WHERE deleted_at IS NULL ORDER BY id LIMIT 1"
        ) {
            return id
        }
        var cal = LoomCalendar(name: "Synced", lastModified: now())
        try cal.insert(db)
        return cal.id!
    }

    // MARK: - Value bridging

    /// Sortable last-modified key; missing timestamps lose every LWW race.
    private func lm(_ value: String?) -> String { value ?? "" }

    private func jsonValue(_ dbValue: DatabaseValue, isBool: Bool) -> Any {
        switch dbValue.storage {
        case .null: return NSNull()
        case .int64(let i): return isBool ? (i != 0) : i
        case .double(let d): return d
        case .string(let s): return s
        case .blob(let d): return d.base64EncodedString()
        }
    }

    static func dbValue(_ any: Any) -> (any DatabaseValueConvertible)? {
        switch any {
        case is NSNull:
            return nil
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
            let type = String(cString: number.objCType)
            if type == "d" || type == "f" { return number.doubleValue }
            return number.int64Value
        case let string as String:
            return string
        default:
            return nil
        }
    }
}
