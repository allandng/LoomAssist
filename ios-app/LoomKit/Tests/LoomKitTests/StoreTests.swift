import XCTest
import GRDB
@testable import LoomKit

final class StoreTests: XCTestCase {
    var db: AppDatabase!

    override func setUpWithError() throws {
        db = try AppDatabase.inMemory()
    }

    func testMigrationCreatesAllTables() throws {
        let tables = try db.writer.read { db in
            try String.fetchAll(db, sql: """
                SELECT name FROM sqlite_master WHERE type = 'table'
                AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'grdb_%'
                ORDER BY name
                """)
        }
        XCTAssertEqual(tables, ["calendar", "cloudsyncconfig", "cloudsyncstate", "event", "task"])
    }

    func testCalendarCRUD() throws {
        var cal = LoomCalendar(name: "School", color: "#aabbcc", lastModified: "2026-06-11T10:00:00")
        try db.writer.write { try cal.insert($0) }
        XCTAssertNotNil(cal.id)

        var fetched = try db.writer.read { try LoomCalendar.fetchOne($0, key: cal.id) }!
        XCTAssertEqual(fetched, cal)

        fetched.name = "University"
        try db.writer.write { [fetched] in try fetched.update($0) }
        let updated = try db.writer.read { try LoomCalendar.fetchOne($0, key: cal.id) }!
        XCTAssertEqual(updated.name, "University")

        _ = try db.writer.write { try LoomCalendar.deleteOne($0, key: cal.id) }
        let gone = try db.writer.read { try LoomCalendar.fetchOne($0, key: cal.id) }
        XCTAssertNil(gone)
    }

    func testEventRoundTripAllFields() throws {
        var cal = LoomCalendar(name: "Main")
        try db.writer.write { try cal.insert($0) }

        var event = LoomEvent(
            title: "CS107 Lecture",
            startTime: "2026-06-12T09:00:00",
            endTime: "2026-06-12T10:30:00",
            calendarId: cal.id!,
            isRecurring: true,
            recurrenceDays: "1,3",
            recurrenceEnd: "2026-12-15",
            description: "Systems programming",
            uniqueDescription: "Bring laptop",
            reminderMinutes: 15,
            externalUid: "ics-uid-1",
            timezone: "local",
            isAllDay: false,
            skippedDates: "2026-07-04",
            perDayTimes: #"{"1":["09:00","10:30"]}"#,
            checklist: #"[{"text":"reading","done":false}]"#,
            actualStart: "2026-06-12T09:02:00",
            actualEnd: "2026-06-12T10:28:00",
            missedAt: nil,
            location: "Gates B12",
            travelTimeMinutes: 20,
            eventType: "lecture",
            prepMinutes: 30,
            reminderSource: "user",
            dependsOnEventId: nil,
            dependsOffsetMinutes: nil,
            lastModified: "2026-06-11T12:00:00",
            deletedAt: nil,
            connectionCalendarId: "cc-uuid",
            externalId: "google-evt-id",
            externalEtag: "etag-1",
            lastSyncedAt: "2026-06-11T12:05:00",
            assignmentId: 7
        )
        try db.writer.write { try event.insert($0) }

        let fetched = try db.writer.read { try LoomEvent.fetchOne($0, key: event.id) }!
        XCTAssertEqual(fetched, event)
    }

    func testTaskCRUD() throws {
        var task = LoomTask(eventId: 42, note: "essay draft", priority: "high",
                            dueDate: "2026-06-20", lastModified: "2026-06-11T12:00:00")
        try db.writer.write { try task.insert($0) }

        var fetched = try db.writer.read { try LoomTask.fetchOne($0, key: task.id) }!
        XCTAssertEqual(fetched, task)
        XCTAssertFalse(fetched.isComplete)
        XCTAssertEqual(fetched.status, "backlog")

        fetched.isComplete = true
        fetched.status = "done"
        try db.writer.write { [fetched] in try fetched.update($0) }
        let updated = try db.writer.read { try LoomTask.fetchOne($0, key: task.id) }!
        XCTAssertTrue(updated.isComplete)
        XCTAssertEqual(updated.status, "done")
    }

    func testSyncStateUniqueRecordId() throws {
        var a = CloudSyncState(recordType: "event", localId: 1, recordId: "evt_abc")
        try db.writer.write { try a.insert($0) }

        var dup = CloudSyncState(recordType: "event", localId: 2, recordId: "evt_abc")
        XCTAssertThrowsError(try db.writer.write { try dup.insert($0) }) { error in
            guard let dbError = error as? DatabaseError else {
                return XCTFail("expected DatabaseError, got \(error)")
            }
            XCTAssertEqual(dbError.resultCode, .SQLITE_CONSTRAINT)
        }
    }

    func testConfigSingleRowPattern() throws {
        let config = CloudSyncConfig(email: "a@b.com", userSub: "sub-1", pullCursor: 1746902400000)
        try db.writer.write { try config.insert($0) }

        // Same "me" key upserts rather than accumulating rows.
        let updated = CloudSyncConfig(email: "a@b.com", userSub: "sub-1",
                                      pullCursor: 1746999999999, lastSyncedAt: "2026-06-11T12:00:00")
        try db.writer.write { try updated.upsert($0) }

        let all = try db.writer.read { try CloudSyncConfig.fetchAll($0) }
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all[0].pullCursor, 1746999999999)
        XCTAssertEqual(all[0].id, "me")
    }

    /// The wire protocol serializes desktop rows by snake_case column name.
    /// Prove our columns match by writing raw snake_case SQL (as if applying
    /// a pulled payload) and reading it back through the typed record.
    func testSnakeCaseColumnsMatchWireProtocol() throws {
        try db.writer.write { db in
            try db.execute(sql: """
                INSERT INTO calendar (name, created_via_sync, course_code, last_modified)
                VALUES ('Synced', 1, 'CS107', '2026-06-11T10:00:00')
                """)
            try db.execute(sql: """
                INSERT INTO event (title, start_time, end_time, calendar_id,
                                   per_day_times, travel_time_minutes, reminder_source,
                                   depends_offset_minutes, connection_calendar_id, external_id)
                VALUES ('Midterm', '2026-06-15T13:00:00', '2026-06-15T15:00:00', 1,
                        '{}', 10, 'inferred', 5, 'cc-1', 'ext-1')
                """)
            try db.execute(sql: """
                INSERT INTO task (event_id, is_complete, estimated_minutes, due_date)
                VALUES (1, 0, 90, '2026-06-14')
                """)
        }

        let cal = try db.writer.read { try LoomCalendar.fetchOne($0, key: 1) }!
        XCTAssertEqual(cal.createdViaSync, true)
        XCTAssertEqual(cal.courseCode, "CS107")
        XCTAssertEqual(cal.lastModified, "2026-06-11T10:00:00")

        let event = try db.writer.read { try LoomEvent.fetchOne($0, key: 1) }!
        XCTAssertEqual(event.startTime, "2026-06-15T13:00:00")
        XCTAssertEqual(event.perDayTimes, "{}")
        XCTAssertEqual(event.travelTimeMinutes, 10)
        XCTAssertEqual(event.reminderSource, "inferred")
        XCTAssertEqual(event.dependsOffsetMinutes, 5)
        XCTAssertEqual(event.connectionCalendarId, "cc-1")
        XCTAssertEqual(event.externalId, "ext-1")

        let task = try db.writer.read { try LoomTask.fetchOne($0, key: 1) }!
        XCTAssertEqual(task.eventId, 1)
        XCTAssertEqual(task.estimatedMinutes, 90)
        XCTAssertEqual(task.dueDate, "2026-06-14")

        // And the reverse: a typed insert must land in snake_case columns.
        var out = LoomEvent(title: "Review", startTime: "2026-06-16T09:00:00",
                            endTime: "2026-06-16T10:00:00", calendarId: 1,
                            travelTimeMinutes: 25)
        try db.writer.write { try out.insert($0) }
        let raw = try db.writer.read {
            try Row.fetchOne($0, sql: "SELECT travel_time_minutes FROM event WHERE id = ?",
                             arguments: [out.id])
        }!
        XCTAssertEqual(raw["travel_time_minutes"], 25)
    }

    func testSoftDeleteTombstoneFiltering() throws {
        var live = LoomEvent(title: "Live", startTime: "2026-06-12T09:00:00",
                             endTime: "2026-06-12T10:00:00", calendarId: 1)
        var dead = LoomEvent(title: "Dead", startTime: "2026-06-12T11:00:00",
                             endTime: "2026-06-12T12:00:00", calendarId: 1,
                             deletedAt: "2026-06-10T08:00:00")
        try db.writer.write { db in
            try live.insert(db)
            try dead.insert(db)
        }
        let alive = try db.writer.read {
            try LoomEvent.filter(Column("deleted_at") == nil).fetchAll($0)
        }
        XCTAssertEqual(alive.map(\.title), ["Live"])
    }
}
