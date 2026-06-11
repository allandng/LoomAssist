import Foundation
import GRDB

/// The local SQLite store. Wraps a GRDB DatabaseWriter and owns migrations.
///
/// Tables intentionally carry no FOREIGN KEY constraints: the desktop's
/// SQLite (via SQLAlchemy) never enforces them, and the sync engine is the
/// integrity layer — pulls defer records whose `__ref` targets haven't
/// arrived yet, so enforcement here would only make the two stores diverge.
public struct AppDatabase: Sendable {
    public let writer: any DatabaseWriter

    public init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
    }

    /// On-disk store for the app. Creates parent directories as needed.
    public static func onDisk(at url: URL) throws -> AppDatabase {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        return try AppDatabase(DatabasePool(path: url.path))
    }

    /// In-memory store for unit tests and previews.
    public static func inMemory() throws -> AppDatabase {
        try AppDatabase(DatabaseQueue())
    }

    /// Default on-disk location: Application Support/LoomAssist/loom.sqlite3.
    public static func defaultURL() throws -> URL {
        try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask,
                 appropriateFor: nil, create: true)
            .appendingPathComponent("LoomAssist", isDirectory: true)
            .appendingPathComponent("loom.sqlite3")
    }

    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            try db.create(table: "calendar") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("name", .text).notNull().indexed()
                t.column("description", .text)
                t.column("color", .text)
                t.column("created_via_sync", .boolean)
                t.column("is_course", .boolean)
                t.column("course_code", .text)
                t.column("term_start", .text)
                t.column("term_end", .text)
                t.column("last_modified", .text)
                t.column("deleted_at", .text)
            }

            try db.create(table: "event") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("title", .text).notNull().indexed()
                t.column("start_time", .text).notNull()
                t.column("end_time", .text).notNull()
                t.column("calendar_id", .integer).notNull().indexed()
                t.column("is_recurring", .boolean)
                t.column("recurrence_days", .text)
                t.column("recurrence_end", .text)
                t.column("description", .text)
                t.column("unique_description", .text)
                t.column("reminder_minutes", .integer)
                t.column("external_uid", .text).indexed()
                t.column("timezone", .text)
                t.column("is_all_day", .boolean)
                t.column("skipped_dates", .text)
                t.column("per_day_times", .text)
                t.column("checklist", .text)
                t.column("actual_start", .text)
                t.column("actual_end", .text)
                t.column("missed_at", .text)
                t.column("location", .text)
                t.column("travel_time_minutes", .integer)
                t.column("event_type", .text)
                t.column("prep_minutes", .integer)
                t.column("reminder_source", .text)
                t.column("depends_on_event_id", .integer)
                t.column("depends_offset_minutes", .integer)
                t.column("last_modified", .text)
                t.column("deleted_at", .text)
                t.column("connection_calendar_id", .text).indexed()
                t.column("external_id", .text).indexed()
                t.column("external_etag", .text)
                t.column("last_synced_at", .text)
                t.column("assignment_id", .integer).indexed()
            }

            try db.create(table: "task") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("event_id", .integer).notNull().indexed()
                t.column("is_complete", .boolean).notNull().defaults(to: false)
                t.column("note", .text)
                t.column("added_at", .text)
                t.column("status", .text)
                t.column("priority", .text)
                t.column("due_date", .text)
                t.column("estimated_minutes", .integer)
                t.column("deadline", .text)
                t.column("grade", .double)
                t.column("weight", .double)
                t.column("last_modified", .text)
                t.column("deleted_at", .text)
            }

            try db.create(table: "cloudsyncstate") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("record_type", .text).notNull().indexed()
                t.column("local_id", .integer).notNull().indexed()
                t.column("record_id", .text).notNull().unique()
                t.column("server_version", .integer).notNull().defaults(to: 0)
                t.column("synced_local_modified", .text)
                t.column("deleted", .boolean).notNull().defaults(to: false)
            }

            try db.create(table: "cloudsyncconfig") { t in
                t.primaryKey("id", .text)
                t.column("email", .text)
                t.column("user_sub", .text)
                t.column("pull_cursor", .integer).notNull().defaults(to: 0)
                t.column("last_synced_at", .text)
            }
        }

        return migrator
    }
}
