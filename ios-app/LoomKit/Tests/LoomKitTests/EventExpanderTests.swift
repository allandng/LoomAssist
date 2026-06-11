import XCTest
@testable import LoomKit

final class EventExpanderTests: XCTestCase {
    let cal = Foundation.Calendar.current

    func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    func testNonRecurringSingleOccurrence() {
        let event = LoomEvent(id: 7, title: "Dentist", startTime: "2026-06-12T09:00:00",
                              endTime: "2026-06-12T09:45:00", calendarId: 1)
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.count, 1)
        XCTAssertEqual(occs[0].id, "7")
        XCTAssertEqual(occs[0].start, date(2026, 6, 12, 9, 0))
        XCTAssertEqual(occs[0].end, date(2026, 6, 12, 9, 45))
        XCTAssertFalse(occs[0].isAllDay)
    }

    func testAllDayUsesDateOnly() {
        let event = LoomEvent(id: 3, title: "Conference", startTime: "2026-06-20T08:30:00",
                              endTime: "2026-06-20T17:00:00", calendarId: 1, isAllDay: true)
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.count, 1)
        XCTAssertTrue(occs[0].isAllDay)
        XCTAssertEqual(occs[0].start, date(2026, 6, 20))
    }

    func testLecturePrepBlock() {
        let event = LoomEvent(id: 9, title: "CS107", startTime: "2026-06-12T10:00:00",
                              endTime: "2026-06-12T11:30:00", calendarId: 1,
                              eventType: "lecture", prepMinutes: 30)
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.count, 2)
        let prep = occs.first { $0.isPrepBlock }!
        XCTAssertEqual(prep.id, "9_prep")
        XCTAssertEqual(prep.start, date(2026, 6, 12, 9, 30))
        XCTAssertEqual(prep.end, date(2026, 6, 12, 10, 0))
    }

    func testRecurringWeekdaysWithEnd() {
        // Mon/Wed (1,3) from Mon 2026-06-01 through 2026-06-14: 4 occurrences.
        let event = LoomEvent(id: 5, title: "Standup", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T09:15:00", calendarId: 1,
                              isRecurring: true, recurrenceDays: "1,3",
                              recurrenceEnd: "2026-06-14")
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.map(\.instanceDate),
                       ["2026-06-01", "2026-06-03", "2026-06-08", "2026-06-10"])
        XCTAssertEqual(occs[1].start, date(2026, 6, 3, 9, 0))
        XCTAssertEqual(occs[1].end, date(2026, 6, 3, 9, 15), "duration carries to each occurrence")
        XCTAssertEqual(occs[0].id, "5_2026-06-01")
    }

    func testRecurringSkippedDates() {
        let event = LoomEvent(id: 5, title: "Standup", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T09:15:00", calendarId: 1,
                              isRecurring: true, recurrenceDays: "1,3",
                              recurrenceEnd: "2026-06-14", skippedDates: "2026-06-08")
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.map(\.instanceDate), ["2026-06-01", "2026-06-03", "2026-06-10"])
    }

    func testRecurringPerDayTimesObjectShape() {
        let event = LoomEvent(id: 5, title: "Lab", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T10:00:00", calendarId: 1,
                              isRecurring: true, recurrenceDays: "1,3",
                              recurrenceEnd: "2026-06-07",
                              perDayTimes: #"{"3":{"start":"14:00","end":"16:30"}}"#)
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.count, 2)
        XCTAssertEqual(occs[0].start, date(2026, 6, 1, 9, 0), "Monday keeps base time")
        XCTAssertEqual(occs[1].start, date(2026, 6, 3, 14, 0), "Wednesday uses per-day override")
        XCTAssertEqual(occs[1].end, date(2026, 6, 3, 16, 30))
    }

    func testRecurringPerDayTimesLegacyArrayShape() {
        let event = LoomEvent(id: 5, title: "Lab", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T10:00:00", calendarId: 1,
                              isRecurring: true, recurrenceDays: "3",
                              recurrenceEnd: "2026-06-07",
                              perDayTimes: #"{"3":["14:00","16:30"]}"#)
        let occs = EventExpander.expand(event)
        XCTAssertEqual(occs.count, 1)
        XCTAssertEqual(occs[0].start, date(2026, 6, 3, 14, 0))
    }

    func testRecurringNoEndCapsAtOneYear() {
        let event = LoomEvent(id: 5, title: "Weekly", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T10:00:00", calendarId: 1,
                              isRecurring: true, recurrenceDays: "1")
        let occs = EventExpander.expand(event)
        // Mondays for one year: 52 or 53.
        XCTAssertTrue((52...53).contains(occs.count), "got \(occs.count)")
        XCTAssertEqual(occs.first?.instanceDate, "2026-06-01")
    }

    func testRecurringWithoutDaysIsEmpty() {
        let event = LoomEvent(id: 5, title: "Broken", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T10:00:00", calendarId: 1,
                              isRecurring: true, recurrenceDays: nil)
        XCTAssertEqual(EventExpander.expand(event), [])
    }

    func testTombstonedEventExpandsToNothing() {
        let event = LoomEvent(id: 5, title: "Gone", startTime: "2026-06-01T09:00:00",
                              endTime: "2026-06-01T10:00:00", calendarId: 1,
                              deletedAt: "2026-06-02T00:00:00")
        XCTAssertEqual(EventExpander.expand(event), [])
    }

    func testWindowFilterAndSort() {
        let one = LoomEvent(id: 1, title: "B later", startTime: "2026-06-12T10:00:00",
                            endTime: "2026-06-12T11:00:00", calendarId: 1)
        let two = LoomEvent(id: 2, title: "A early", startTime: "2026-06-12T09:00:00",
                            endTime: "2026-06-12T09:30:00", calendarId: 1)
        let outside = LoomEvent(id: 3, title: "Tomorrow", startTime: "2026-06-13T09:00:00",
                                endTime: "2026-06-13T10:00:00", calendarId: 1)
        let occs = EventExpander.occurrences(
            in: [one, two, outside],
            from: date(2026, 6, 12), to: date(2026, 6, 13)
        )
        XCTAssertEqual(occs.map(\.title), ["A early", "B later"])
    }
}
