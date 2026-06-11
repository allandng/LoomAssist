import XCTest
import GRDB
@testable import LoomKit

/// In-memory fake of the AWS sync API with real version bookkeeping —
/// the Swift cousin of the FakeClient in backend-api/tests/test_cloud_sync.py.
actor MockServer {
    struct Stored {
        var recordType: String
        var version: Int
        var lastModified: Int64
        var tombstone: Bool
        var ciphertext: String?
        var nonce: String?
    }

    var records: [String: Stored] = [:]
    var clock: Int64 = 0
    var putCalls = 0
    var deleteCalls = 0
    /// recordId -> number of times a put must 409 before succeeding.
    var conflictOnce: Set<String> = []

    func seed(_ recordId: String, type: String, payload: Data, dek: Data, version: Int = 1) throws {
        let (ciphertext, nonce) = try Vault.encryptRecord(payload, dek: dek)
        clock += 1
        records[recordId] = Stored(
            recordType: type, version: version, lastModified: clock,
            tombstone: false,
            ciphertext: ciphertext.base64EncodedString(),
            nonce: nonce.base64EncodedString()
        )
    }

    func seedTombstone(_ recordId: String, type: String, version: Int) {
        clock += 1
        records[recordId] = Stored(
            recordType: type, version: version, lastModified: clock, tombstone: true
        )
    }

    func armConflict(_ recordId: String) { conflictOnce.insert(recordId) }

    func snapshot() -> [String: Stored] { records }

    // SyncAPIClient surface (called through the adapter below)

    func recordsSince(_ since: Int64) -> [ServerRecord] {
        records
            .filter { $0.value.lastModified > since }
            .map { id, s in
                ServerRecord(recordId: id, recordType: s.recordType, version: s.version,
                             lastModified: s.lastModified, tombstone: s.tombstone,
                             ciphertext: s.ciphertext, nonce: s.nonce)
            }
            .sorted { $0.lastModified < $1.lastModified }
    }

    func getRecord(_ recordId: String) -> ServerRecord? {
        guard let s = records[recordId] else { return nil }
        return ServerRecord(recordId: recordId, recordType: s.recordType, version: s.version,
                            lastModified: s.lastModified, tombstone: s.tombstone,
                            ciphertext: s.ciphertext, nonce: s.nonce)
    }

    func putRecord(_ recordId: String, ciphertext: String, nonce: String,
                   recordType: String, expectedVersion: Int) throws -> PutResult {
        putCalls += 1
        if conflictOnce.remove(recordId) != nil {
            throw SyncAPIError.versionConflict(
                recordId: recordId, currentVersion: records[recordId]?.version ?? 0
            )
        }
        let current = records[recordId]?.version ?? 0
        guard expectedVersion == current else {
            throw SyncAPIError.versionConflict(recordId: recordId, currentVersion: current)
        }
        clock += 1
        records[recordId] = Stored(
            recordType: recordType, version: current + 1, lastModified: clock,
            tombstone: false, ciphertext: ciphertext, nonce: nonce
        )
        return PutResult(version: current + 1)
    }

    func deleteRecord(_ recordId: String) -> PutResult {
        deleteCalls += 1
        let current = records[recordId]?.version ?? 0
        clock += 1
        var s = records[recordId] ?? Stored(recordType: "?", version: 0, lastModified: clock,
                                            tombstone: false, ciphertext: nil, nonce: nil)
        s.version = current + 1
        s.lastModified = clock
        s.tombstone = true
        s.ciphertext = nil
        s.nonce = nil
        records[recordId] = s
        return PutResult(version: s.version)
    }
}

struct MockClient: SyncAPIClient {
    let server: MockServer

    func vaultInfo() async throws -> VaultInfo? { nil }
    func vaultInit(wrappedDek: String, salt: String,
                   kdfParams: Vault.KDFParams, deviceId: String) async throws -> Bool { true }
    func recordsSince(_ sinceMs: Int64) async throws -> [ServerRecord] {
        await server.recordsSince(sinceMs)
    }
    func getRecord(_ recordId: String) async throws -> ServerRecord? {
        await server.getRecord(recordId)
    }
    func putRecord(_ recordId: String, ciphertext: String, nonce: String,
                   recordType: String, expectedVersion: Int,
                   deviceId: String) async throws -> PutResult {
        try await server.putRecord(recordId, ciphertext: ciphertext, nonce: nonce,
                                   recordType: recordType, expectedVersion: expectedVersion)
    }
    func deleteRecord(_ recordId: String) async throws -> PutResult {
        await server.deleteRecord(recordId)
    }
}

/// Synchronous GRDB bridges — calling writer.read/write directly from an
/// async test resolves to the @Sendable async overloads, which reject the
/// shared mutable fixtures these tests lean on.
func dbWrite(_ db: AppDatabase, _ body: (Database) throws -> Void) throws {
    try db.writer.write(body)
}

func dbRead<T>(_ db: AppDatabase, _ body: (Database) throws -> T) throws -> T {
    try db.writer.read(body)
}

final class SyncEngineTests: XCTestCase {
    var db: AppDatabase!
    var server: MockServer!
    var engine: SyncEngine!
    let dek = Vault.generateDEK()

    override func setUpWithError() throws {
        db = try AppDatabase.inMemory()
        server = MockServer()
        engine = SyncEngine(db: db, client: MockClient(server: server), dek: dek,
                            deviceId: "ios_test")
    }

    func envelope(_ type: String, _ data: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "type": type, "data": data, "schema_version": 2,
        ])
    }

    func decryptStored(_ stored: MockServer.Stored) throws -> [String: Any] {
        let plaintext = try Vault.decryptRecord(
            ciphertext: Data(base64Encoded: stored.ciphertext!)!,
            nonce: Data(base64Encoded: stored.nonce!)!, dek: dek
        )
        return try JSONSerialization.jsonObject(with: plaintext) as! [String: Any]
    }

    // MARK: - Push

    func testPushAssignsPrefixedRecordIdsAndRefs() async throws {
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "School", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
            var event = LoomEvent(title: "Lecture", startTime: "2026-06-12T09:00:00",
                                  endTime: "2026-06-12T10:00:00", calendarId: cal.id!,
                                  lastModified: "2026-06-11T10:00:01")
            try event.insert(db)
            var task = LoomTask(eventId: event.id!, note: "read ch. 4",
                                lastModified: "2026-06-11T10:00:02")
            try task.insert(db)
        }

        let summary = try await engine.run()
        XCTAssertEqual(summary.push["pushed"], 3)

        let snapshot = await server.snapshot()
        XCTAssertEqual(snapshot.count, 3)
        let calId = snapshot.keys.first { $0.hasPrefix("cal_") }
        let evtId = snapshot.keys.first { $0.hasPrefix("evt_") }
        let tskId = snapshot.keys.first { $0.hasPrefix("tsk_") }
        XCTAssertNotNil(calId); XCTAssertNotNil(evtId); XCTAssertNotNil(tskId)

        let evtEnvelope = try decryptStored(snapshot[evtId!]!)
        XCTAssertEqual(evtEnvelope["schema_version"] as? Int, 2)
        let evtData = evtEnvelope["data"] as! [String: Any]
        XCTAssertNil(evtData["id"], "payload must not carry local PKs")
        XCTAssertNil(evtData["calendar_id"], "FK must travel as __ref only")
        XCTAssertEqual(evtData["calendar_id__ref"] as? String, calId)
        XCTAssertTrue(evtData["depends_on_event_id__ref"] is NSNull)
        XCTAssertEqual(evtData["is_recurring"] as? Bool, false, "bools serialize as JSON booleans")

        let tskData = (try decryptStored(snapshot[tskId!]!))["data"] as! [String: Any]
        XCTAssertEqual(tskData["event_id__ref"] as? String, evtId)

        // Second run with nothing dirty pushes nothing.
        let second = try await engine.run()
        XCTAssertEqual(second.push["pushed"], 0)
    }

    func testPushTombstonesSoftDeletedRow() async throws {
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Main", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
        }
        _ = try await engine.run()

        try dbWrite(db) { db in
            try db.execute(sql: "UPDATE calendar SET deleted_at = '2026-06-11T11:00:00', last_modified = '2026-06-11T11:00:00'")
        }
        let summary = try await engine.run()
        XCTAssertEqual(summary.push["deleted"], 1)
        let snapshot = await server.snapshot()
        XCTAssertTrue(snapshot.values.allSatisfy(\.tombstone))
    }

    func testPushOrphanTombstoneForHardDeletedRow() async throws {
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Doomed", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
        }
        _ = try await engine.run()

        try dbWrite(db) { db in
            try db.execute(sql: "DELETE FROM calendar")  // hard delete, desktop-style
        }
        let summary = try await engine.run()
        XCTAssertEqual(summary.push["orphan_tombstoned"], 1)
    }

    func testConflictLostAppliesServerVersion() async throws {
        var localId: Int64 = 0
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Ours", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
            localId = cal.id!
        }
        _ = try await engine.run()

        // Local edit with an OLD timestamp; server edit with a NEWER one.
        try dbWrite(db) { db in
            try db.execute(sql: "UPDATE calendar SET name = 'Ours v2', last_modified = '2026-06-11T11:00:00'")
        }
        let recordId = try dbRead(db) {
            try CloudSyncState.fetchOne($0)!.recordId
        }
        let serverPayload = envelope("calendar", [
            "name": "Theirs v3", "last_modified": "2026-06-11T12:00:00",
        ])
        let (ct, nonce) = try Vault.encryptRecord(serverPayload, dek: dek)
        _ = try await server.putRecord(recordId, ciphertext: ct.base64EncodedString(),
                                       nonce: nonce.base64EncodedString(),
                                       recordType: "calendar", expectedVersion: 1)
        // Cursor already past the server edit? No — wind cursor back so the
        // pull doesn't see it, forcing the push-phase 409 path under test.
        try dbWrite(db) { db in
            var config = try CloudSyncConfig.fetchOne(db, key: "me")!
            config.pullCursor = .max
            try config.update(db)
        }

        let summary = try await engine.run()
        XCTAssertEqual(summary.push["conflict_lost"], 1)
        let name = try dbRead(db) {
            try String.fetchOne($0, sql: "SELECT name FROM calendar WHERE id = ?", arguments: [localId])
        }
        XCTAssertEqual(name, "Theirs v3", "LWW: newer server copy wins")
    }

    func testConflictWonRetriesAtCurrentVersion() async throws {
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Ours", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
        }
        _ = try await engine.run()

        // Local edit NEWER than anything server-side; arm a spurious 409.
        try dbWrite(db) { db in
            try db.execute(sql: "UPDATE calendar SET name = 'Ours v2', last_modified = '2026-06-11T23:00:00'")
        }
        let recordId = try dbRead(db) { try CloudSyncState.fetchOne($0)!.recordId }
        await server.armConflict(recordId)

        let summary = try await engine.run()
        XCTAssertEqual(summary.push["pushed"], 1)
        let stored = await server.snapshot()[recordId]!
        let data = (try decryptStored(stored))["data"] as! [String: Any]
        XCTAssertEqual(data["name"] as? String, "Ours v2")
    }

    // MARK: - Pull

    func testPullCreatesOutOfOrderViaDeferRetry() async throws {
        // Task arrives before its event, event before its calendar — the
        // defer-and-retry loop must land all three.
        try await server.seed("tsk_1", type: "task", payload: envelope("task", [
            "event_id__ref": "evt_1", "is_complete": false, "note": "essay",
            "last_modified": "2026-06-11T10:00:03",
        ]), dek: dek)
        try await server.seed("evt_1", type: "event", payload: envelope("event", [
            "title": "Lecture", "start_time": "2026-06-12T09:00:00",
            "end_time": "2026-06-12T10:00:00",
            "calendar_id__ref": "cal_1", "depends_on_event_id__ref": NSNull(),
            "is_recurring": true, "recurrence_days": "1,3",
            "last_modified": "2026-06-11T10:00:02",
        ]), dek: dek)
        try await server.seed("cal_1", type: "calendar", payload: envelope("calendar", [
            "name": "School", "color": "#aabbcc", "is_course": true,
            "last_modified": "2026-06-11T10:00:01",
        ]), dek: dek)

        let summary = try await engine.run()
        XCTAssertEqual(summary.pull["created"], 3)
        XCTAssertEqual(summary.pull["unresolved_refs"], 0)

        try dbRead(db) { db in
            let cal = try LoomCalendar.fetchOne(db)!
            XCTAssertEqual(cal.name, "School")
            XCTAssertEqual(cal.isCourse, true)
            let event = try LoomEvent.fetchOne(db)!
            XCTAssertEqual(event.calendarId, cal.id!)
            XCTAssertEqual(event.isRecurring, true)
            XCTAssertNil(event.dependsOnEventId)
            let task = try LoomTask.fetchOne(db)!
            XCTAssertEqual(task.eventId, event.id!)
        }

        // Nothing local was dirtied by the pull — push must be a no-op,
        // and a second pull skips everything (echo suppression).
        XCTAssertEqual(summary.push["pushed"], 0)
        let second = try await engine.run()
        XCTAssertEqual(second.pull["created"], 0)
        XCTAssertEqual(second.pull["updated"], 0)
    }

    func testPullEventWithUnknownCalendarGetsFallback() async throws {
        try await server.seed("evt_x", type: "event", payload: envelope("event", [
            "title": "Orphan", "start_time": "2026-06-12T09:00:00",
            "end_time": "2026-06-12T10:00:00",
            "calendar_id__ref": "cal_never_seen",
            "last_modified": "2026-06-11T10:00:00",
        ]), dek: dek)

        let summary = try await engine.run()
        XCTAssertEqual(summary.pull["created"], 1)
        XCTAssertEqual(summary.pull["unresolved_refs"], 1)
        try dbRead(db) { db in
            let event = try LoomEvent.fetchOne(db)!
            let cal = try LoomCalendar.fetchOne(db, key: event.calendarId)!
            XCTAssertEqual(cal.name, "Synced", "fallback calendar absorbs orphaned events")
        }
    }

    func testPullTaskWithUnknownEventDropped() async throws {
        try await server.seed("tsk_x", type: "task", payload: envelope("task", [
            "event_id__ref": "evt_never_seen", "is_complete": false,
            "last_modified": "2026-06-11T10:00:00",
        ]), dek: dek)

        let summary = try await engine.run()
        XCTAssertEqual(summary.pull["created"], 0)
        XCTAssertEqual(summary.pull["unresolved_refs"], 1)
        let taskCount = try dbRead(db) { try LoomTask.fetchCount($0) }
        XCTAssertEqual(taskCount, 0, "a task without its event is meaningless")
    }

    func testPullTombstoneSoftDeletesLocally() async throws {
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Shared", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
        }
        _ = try await engine.run()
        let recordId = try dbRead(db) { try CloudSyncState.fetchOne($0)!.recordId }

        let version = await server.snapshot()[recordId]!.version
        await server.seedTombstone(recordId, type: "calendar", version: version + 1)

        let summary = try await engine.run()
        XCTAssertEqual(summary.pull["deleted"], 1)
        let deletedAt = try dbRead(db) {
            try String.fetchOne($0, sql: "SELECT deleted_at FROM calendar")
        }
        XCTAssertNotNil(deletedAt)
    }

    func testPullKeepsNewerLocalEdit() async throws {
        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Mine", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
        }
        _ = try await engine.run()
        let recordId = try dbRead(db) { try CloudSyncState.fetchOne($0)!.recordId }

        // Server edit with an older timestamp than a fresh local edit.
        let payload = envelope("calendar", [
            "name": "Server stale", "last_modified": "2026-06-11T11:00:00",
        ])
        let (ct, nonce) = try Vault.encryptRecord(payload, dek: dek)
        let version = await server.snapshot()[recordId]!.version
        _ = try await server.putRecord(recordId, ciphertext: ct.base64EncodedString(),
                                       nonce: nonce.base64EncodedString(),
                                       recordType: "calendar", expectedVersion: version)
        try dbWrite(db) { db in
            try db.execute(sql: "UPDATE calendar SET name = 'Mine v2', last_modified = '2026-06-11T12:00:00'")
        }

        let summary = try await engine.run()
        XCTAssertEqual(summary.pull["kept_local"], 1)
        // Push phase then sends our newer copy.
        XCTAssertEqual(summary.push["pushed"], 1)
        let name = try dbRead(db) { try String.fetchOne($0, sql: "SELECT name FROM calendar") }
        XCTAssertEqual(name, "Mine v2")
    }

    func testPullSkipsForeignSchemaVersion() async throws {
        let alien = try! JSONSerialization.data(withJSONObject: [
            "type": "calendar", "data": ["name": "From the future"], "schema_version": 3,
        ])
        try await server.seed("cal_v3", type: "calendar", payload: alien, dek: dek)

        let summary = try await engine.run()
        XCTAssertEqual(summary.pull["skipped_schema"], 1)
        XCTAssertEqual(summary.pull["created"], 0)
    }

    // MARK: - Two clones, one server

    func testTwoCloneRoundTrip() async throws {
        // Clone A pushes; clone B pulls; B edits; A pulls B's edit.
        let dbB = try AppDatabase.inMemory()
        let engineB = SyncEngine(db: dbB, client: MockClient(server: server), dek: dek,
                                 deviceId: "ios_test_b")

        try dbWrite(db) { db in
            var cal = LoomCalendar(name: "Shared", lastModified: "2026-06-11T10:00:00")
            try cal.insert(db)
            var event = LoomEvent(title: "Standup", startTime: "2026-06-12T09:00:00",
                                  endTime: "2026-06-12T09:15:00", calendarId: cal.id!,
                                  isRecurring: true, recurrenceDays: "1,2,3,4,5",
                                  lastModified: "2026-06-11T10:00:01")
            try event.insert(db)
        }
        _ = try await engine.run()

        let pullB = try await engineB.run()
        XCTAssertEqual(pullB.pull["created"], 2)
        try dbWrite(dbB) { db in
            try db.execute(sql: "UPDATE event SET title = 'Standup (moved)', last_modified = '2026-06-11T13:00:00'")
        }
        _ = try await engineB.run()

        let pullA = try await engine.run()
        XCTAssertEqual(pullA.pull["updated"], 1)
        let title = try dbRead(db) { try String.fetchOne($0, sql: "SELECT title FROM event") }
        XCTAssertEqual(title, "Standup (moved)")
    }
}
