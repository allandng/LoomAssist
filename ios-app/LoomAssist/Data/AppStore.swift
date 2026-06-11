import Foundation
import SwiftUI
import LoomKit
import GRDB

/// App-wide observable store over the local SQLite database. Read-only for
/// substep 6 — light edits arrive in substep 7.
@MainActor
final class AppStore: ObservableObject {
    @Published var timelines: [LoomCalendar] = []
    @Published var events: [LoomEvent] = []
    @Published var tasks: [LoomTask] = []

    let db: AppDatabase
    /// One Whisper instance per process — the CoreML model loads once.
    let transcriber = WhisperTranscriber()

    init() {
        do {
            db = try AppDatabase.onDisk(at: AppDatabase.defaultURL())
        } catch {
            // In-memory fallback keeps the app usable if the data dir is hosed.
            db = try! AppDatabase.inMemory()
        }
        #if DEBUG
        if ProcessInfo.processInfo.environment["LOOM_SEED_DEMO"] == "1" {
            try? seedDemoData()
        }
        #endif
        reload()
    }

    func reload() {
        do {
            let (timelines, events, tasks) = try db.writer.read { db in
                (
                    try LoomCalendar.filter(Column("deleted_at") == nil)
                        .order(Column("id")).fetchAll(db),
                    try LoomEvent.filter(Column("deleted_at") == nil).fetchAll(db),
                    try LoomTask.filter(Column("deleted_at") == nil)
                        .order(Column("id").desc).fetchAll(db)
                )
            }
            self.timelines = timelines
            self.events = events
            self.tasks = tasks
        } catch {
            // Leave last-good state in place; local-first means no blocking errors.
        }
    }

    func timelineColor(for calendarId: Int64) -> Color {
        Color(timelineHex: timelines.first(where: { $0.id == calendarId })?.color)
    }

    func event(byId id: Int64) -> LoomEvent? {
        events.first { $0.id == id }
    }

    // MARK: - Light edits (substep 7) — all stamp last_modified via LocalEdits,
    // which is what queues them for the next sync push.

    func saveEvent(eventId: Int64, title: String, start: Date?, end: Date?) {
        try? LocalEdits.saveEvent(
            db, eventId: eventId, title: title,
            startTime: start.map(LocalEdits.localISO),
            endTime: end.map(LocalEdits.localISO)
        )
        reload()
    }

    func toggleTask(_ task: LoomTask) {
        guard let id = task.id else { return }
        try? LocalEdits.setTaskComplete(db, taskId: id, complete: !task.isComplete)
        reload()
    }

    func deleteEvent(eventId: Int64) {
        try? LocalEdits.softDeleteEvent(db, eventId: eventId)
        reload()
    }

    func createEvent(title: String, start: Date, end: Date) {
        try? LocalEdits.createEvent(
            db, title: title,
            startTime: LocalEdits.localISO(start),
            endTime: LocalEdits.localISO(end)
        )
        reload()
    }

    #if DEBUG
    /// Demo fixtures for visual verification: LOOM_SEED_DEMO=1 wipes and
    /// reseeds. Dates are anchored to the current week so screenshots
    /// always have content.
    private func seedDemoData() throws {
        let cal = Foundation.Calendar.current
        let today = cal.startOfDay(for: Date())
        let weekday = cal.component(.weekday, from: today) - 1  // 0=Sun
        let monday = cal.date(byAdding: .day, value: weekday == 0 ? -6 : 1 - weekday, to: today)!
        let iso = { (d: Date) in EventExpander.localDateString(d) }
        let dt = { (day: Date, h: Int, m: Int) in
            "\(iso(day))T\(String(format: "%02d:%02d", h, m)):00"
        }
        let now = SyncEngine.isoNow()

        try db.writer.write { db in
            try db.execute(sql: "DELETE FROM task")
            try db.execute(sql: "DELETE FROM event")
            try db.execute(sql: "DELETE FROM calendar")
            try db.execute(sql: "DELETE FROM cloudsyncstate")

            var school = LoomCalendar(name: "School", color: "#A8643F", lastModified: now)
            var work = LoomCalendar(name: "Work", color: "#6B8F5E", lastModified: now)
            var personal = LoomCalendar(name: "Personal", color: "#C9913B", lastModified: now)
            try school.insert(db); try work.insert(db); try personal.insert(db)

            // Recurring lecture Mon/Wed with a Wednesday per-day override + prep.
            var lecture = LoomEvent(
                title: "CS107 systems lecture",
                startTime: dt(monday, 10, 0), endTime: dt(monday, 11, 30),
                calendarId: school.id!, isRecurring: true, recurrenceDays: "1,3",
                recurrenceEnd: iso(cal.date(byAdding: .month, value: 3, to: monday)!),
                perDayTimes: #"{"3":{"start":"14:00","end":"15:30"}}"#,
                eventType: "lecture", prepMinutes: 30, lastModified: now
            )
            try lecture.insert(db)

            var standup = LoomEvent(
                title: "Team standup",
                startTime: dt(monday, 9, 0), endTime: dt(monday, 9, 15),
                calendarId: work.id!, isRecurring: true, recurrenceDays: "1,2,3,4,5",
                recurrenceEnd: iso(cal.date(byAdding: .month, value: 3, to: monday)!),
                lastModified: now
            )
            try standup.insert(db)

            var gym = LoomEvent(
                title: "Gym with Sam",
                startTime: dt(cal.date(byAdding: .day, value: 1, to: today)!, 18, 0),
                endTime: dt(cal.date(byAdding: .day, value: 1, to: today)!, 19, 0),
                calendarId: personal.id!, location: "Campus rec center",
                lastModified: now
            )
            try gym.insert(db)

            var essayDue = LoomEvent(
                title: "PHIL 12 essay due",
                startTime: dt(cal.date(byAdding: .day, value: 3, to: today)!, 0, 0),
                endTime: dt(cal.date(byAdding: .day, value: 3, to: today)!, 23, 59),
                calendarId: school.id!, isAllDay: true, lastModified: now
            )
            try essayDue.insert(db)

            var review = LoomEvent(
                title: "Quarterly review prep",
                startTime: dt(today, 13, 0), endTime: dt(today, 14, 0),
                calendarId: work.id!, lastModified: now
            )
            try review.insert(db)

            var draft = LoomTask(eventId: essayDue.id!, note: "Draft thesis paragraph",
                                 status: "doing", priority: "high",
                                 dueDate: iso(cal.date(byAdding: .day, value: 2, to: today)!),
                                 lastModified: now)
            var reading = LoomTask(eventId: lecture.id!, note: "Read ch. 4 before lecture",
                                   status: "backlog", priority: "med", lastModified: now)
            var slides = LoomTask(eventId: review.id!, isComplete: true,
                                  note: "Collect Q2 metrics", status: "done",
                                  priority: "low", lastModified: now)
            try draft.insert(db); try reading.insert(db); try slides.insert(db)
        }
    }
    #endif
}
