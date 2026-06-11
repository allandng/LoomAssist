import XCTest
@testable import LoomKit

final class VoiceParserTests: XCTestCase {
    let cal = Foundation.Calendar.current

    func testParsesExplicitDateAndStripsCommandVerbs() {
        let draft = FallbackIntentParser.parse("Schedule lunch with Sam on June 19 at 12pm")
        XCTAssertNotNil(draft)
        XCTAssertEqual(draft?.title, "Lunch with Sam")
        XCTAssertEqual(draft?.source, .dateDetector)
        let parts = cal.dateComponents([.month, .day, .hour], from: draft!.start)
        XCTAssertEqual(parts.month, 6)
        XCTAssertEqual(parts.day, 19)
        XCTAssertEqual(parts.hour, 12)
        XCTAssertEqual(draft!.end.timeIntervalSince(draft!.start), 3600,
                       "no stated duration defaults to one hour")
    }

    func testNoDateDefaultsToNextFullHour() {
        let now = cal.date(from: DateComponents(year: 2026, month: 6, day: 11,
                                                hour: 14, minute: 23))!
        let draft = FallbackIntentParser.parse("Add gym session", now: now)
        XCTAssertEqual(draft?.title, "Gym session")
        XCTAssertEqual(draft?.start, cal.date(from: DateComponents(
            year: 2026, month: 6, day: 11, hour: 15, minute: 0
        )))
    }

    func testEmptyTranscriptIsNil() {
        XCTAssertNil(FallbackIntentParser.parse("   "))
    }

    func testTitleNeverEmpty() {
        let draft = FallbackIntentParser.parse("June 19 at 12pm")
        XCTAssertEqual(draft?.title, "New event")
    }

    func testCleanTitleStripsTrailingConnectives() {
        XCTAssertEqual(FallbackIntentParser.cleanTitle("book dentist appointment on"),
                       "Dentist appointment")
        XCTAssertEqual(FallbackIntentParser.cleanTitle("set up team sync at"),
                       "Team sync")
    }

    func testCreateEventWritesAndQueuesForPush() async throws {
        let db = try AppDatabase.inMemory()
        let server = MockServer()
        let engine = SyncEngine(db: db, client: MockClient(server: server),
                                dek: Vault.generateDEK(), deviceId: "ios_test")

        let eventId = try LocalEdits.createEvent(
            db, title: "Lunch with Sam",
            startTime: "2026-06-19T12:00:00", endTime: "2026-06-19T13:00:00"
        )
        let (event, calendarCount) = try dbRead(db) { txn in
            (try LoomEvent.fetchOne(txn, key: eventId)!,
             try LoomCalendar.fetchCount(txn))
        }
        XCTAssertEqual(event.title, "Lunch with Sam")
        XCTAssertNotNil(event.lastModified)
        XCTAssertEqual(calendarCount, 1, "auto-creates a Personal timeline when none exists")

        let summary = try await engine.run()
        XCTAssertEqual(summary.push["pushed"], 2, "new calendar + new event both push")
    }
}
