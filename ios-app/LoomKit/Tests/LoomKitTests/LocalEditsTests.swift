import XCTest
import GRDB
@testable import LoomKit

/// Light edits must stamp last_modified so the sync engine sees them as
/// dirty. The integration tests run a real engine cycle against the mock
/// server to prove each edit kind actually flows out.
final class LocalEditsTests: XCTestCase {
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

    @discardableResult
    func seedEventWithTask() throws -> (eventId: Int64, taskId: Int64) {
        try db.writer.write { db in
            var cal = LoomCalendar(name: "Main", lastModified: "2026-06-11T08:00:00")
            try cal.insert(db)
            var event = LoomEvent(title: "Original", startTime: "2026-06-12T09:00:00",
                                  endTime: "2026-06-12T10:00:00", calendarId: cal.id!,
                                  lastModified: "2026-06-11T08:00:00")
            try event.insert(db)
            var task = LoomTask(eventId: event.id!, note: "todo",
                                lastModified: "2026-06-11T08:00:00")
            try task.insert(db)
            return (event.id!, task.id!)
        }
    }

    func testSaveEventStampsLastModified() throws {
        let (eventId, _) = try seedEventWithTask()
        try LocalEdits.saveEvent(db, eventId: eventId, title: "Renamed",
                                 startTime: "2026-06-12T10:30:00",
                                 endTime: "2026-06-12T11:30:00")
        let event = try dbRead(db) { try LoomEvent.fetchOne($0, key: eventId)! }
        XCTAssertEqual(event.title, "Renamed")
        XCTAssertEqual(event.startTime, "2026-06-12T10:30:00")
        XCTAssertEqual(event.endTime, "2026-06-12T11:30:00")
        XCTAssertGreaterThan(event.lastModified ?? "", "2026-06-11T08:00:00")
    }

    func testTitleOnlyEditLeavesTimesAlone() throws {
        let (eventId, _) = try seedEventWithTask()
        try LocalEdits.saveEvent(db, eventId: eventId, title: "Renamed only")
        let event = try dbRead(db) { try LoomEvent.fetchOne($0, key: eventId)! }
        XCTAssertEqual(event.startTime, "2026-06-12T09:00:00")
        XCTAssertEqual(event.endTime, "2026-06-12T10:00:00")
    }

    func testEditedEventPushesOnNextCycle() async throws {
        let (eventId, _) = try seedEventWithTask()
        _ = try await engine.run()  // everything clean after first sync

        try LocalEdits.saveEvent(db, eventId: eventId, title: "Renamed")
        let summary = try await engine.run()
        XCTAssertEqual(summary.push["pushed"], 1, "only the edited event re-pushes")

        // The pushed ciphertext carries the new title.
        let recordId = try dbRead(db) { db in
            try CloudSyncState
                .filter(Column("record_type") == "event" && Column("local_id") == eventId)
                .fetchOne(db)!.recordId
        }
        let stored = await server.snapshot()[recordId]!
        let plaintext = try Vault.decryptRecord(
            ciphertext: Data(base64Encoded: stored.ciphertext!)!,
            nonce: Data(base64Encoded: stored.nonce!)!, dek: dek
        )
        let envelope = try JSONSerialization.jsonObject(with: plaintext) as! [String: Any]
        XCTAssertEqual((envelope["data"] as! [String: Any])["title"] as? String, "Renamed")
    }

    func testCompletedTaskPushesOnNextCycle() async throws {
        let (_, taskId) = try seedEventWithTask()
        _ = try await engine.run()

        try LocalEdits.setTaskComplete(db, taskId: taskId, complete: true)
        let task = try dbRead(db) { try LoomTask.fetchOne($0, key: taskId)! }
        XCTAssertTrue(task.isComplete)

        let summary = try await engine.run()
        XCTAssertEqual(summary.push["pushed"], 1)
    }

    func testDeletedEventTombstonesOnNextCycle() async throws {
        let (eventId, _) = try seedEventWithTask()
        _ = try await engine.run()

        try LocalEdits.softDeleteEvent(db, eventId: eventId)
        let event = try dbRead(db) { try LoomEvent.fetchOne($0, key: eventId)! }
        XCTAssertNotNil(event.deletedAt)

        let summary = try await engine.run()
        XCTAssertEqual(summary.push["deleted"], 1, "tombstone, not a payload push")
    }

    func testLocalISORoundTripsThroughExpander() {
        let date = EventExpander.parseLocalISO("2026-06-12T09:30:00")!
        XCTAssertEqual(LocalEdits.localISO(date), "2026-06-12T09:30:00")
    }
}
