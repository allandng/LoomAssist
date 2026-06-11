import Foundation
import GRDB

/// Light-edit write path. Every mutation stamps `last_modified` — that is
/// what makes a row "dirty" to the sync engine (its last_modified no longer
/// matches CloudSyncState.synced_local_modified), so edits flow to the cloud
/// on the next cycle without any extra bookkeeping here. Deletes are
/// tombstones (`deleted_at`), never hard DELETEs, matching desktop semantics.
public enum LocalEdits {
    public static func saveEvent(
        _ db: AppDatabase, eventId: Int64,
        title: String, startTime: String? = nil, endTime: String? = nil
    ) throws {
        try db.writer.write { txn in
            var assignments: [String] = ["title = :title", "last_modified = :lm"]
            var arguments: [String: (any DatabaseValueConvertible)?] = [
                "title": title, "lm": SyncEngine.isoNow(), "id": eventId,
            ]
            if let startTime {
                assignments.append("start_time = :start")
                arguments.updateValue(startTime, forKey: "start")
            }
            if let endTime {
                assignments.append("end_time = :end")
                arguments.updateValue(endTime, forKey: "end")
            }
            try txn.execute(
                sql: "UPDATE event SET \(assignments.joined(separator: ", ")) WHERE id = :id",
                arguments: StatementArguments(arguments)
            )
        }
    }

    public static func setTaskComplete(_ db: AppDatabase, taskId: Int64, complete: Bool) throws {
        try db.writer.write { txn in
            try txn.execute(
                sql: "UPDATE task SET is_complete = ?, last_modified = ? WHERE id = ?",
                arguments: [complete, SyncEngine.isoNow(), taskId]
            )
        }
    }

    /// Create a new event (voice capture, quick add). Lands on the given
    /// timeline, the first live one, or a fresh "Personal" timeline — the
    /// stamped last_modified queues it for the next sync push either way.
    @discardableResult
    public static func createEvent(
        _ db: AppDatabase, title: String, startTime: String, endTime: String,
        calendarId: Int64? = nil
    ) throws -> Int64 {
        try db.writer.write { txn in
            let now = SyncEngine.isoNow()
            let targetCalendar: Int64
            if let calendarId {
                targetCalendar = calendarId
            } else if let first = try Int64.fetchOne(
                txn, sql: "SELECT id FROM calendar WHERE deleted_at IS NULL ORDER BY id LIMIT 1"
            ) {
                targetCalendar = first
            } else {
                var cal = LoomCalendar(name: "Personal", lastModified: now)
                try cal.insert(txn)
                targetCalendar = cal.id!
            }
            var event = LoomEvent(title: title, startTime: startTime, endTime: endTime,
                                  calendarId: targetCalendar, lastModified: now)
            try event.insert(txn)
            return event.id!
        }
    }

    public static func softDeleteEvent(_ db: AppDatabase, eventId: Int64) throws {
        try db.writer.write { txn in
            let now = SyncEngine.isoNow()
            try txn.execute(
                sql: "UPDATE event SET deleted_at = ?, last_modified = ? WHERE id = ?",
                arguments: [now, now, eventId]
            )
        }
    }

    /// Local-time Date → the timezone-naive ISO format the schema uses.
    public static func localISO(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter.string(from: date)
    }
}
