import Foundation

/// One renderable occurrence of an event. Recurring events are stored as a
/// single row and expanded client-side — port of the desktop's
/// frontend-ui/src/src/lib/eventUtils.ts:toFCEvents().
public struct EventOccurrence: Equatable, Identifiable, Sendable {
    /// "{eventId}" for one-offs, "{eventId}_{YYYY-MM-DD}" for recurring
    /// occurrences, with a "_prep" suffix on prep blocks — same id scheme
    /// as the desktop so debugging lines up across platforms.
    public var id: String
    public var eventId: Int64
    public var calendarId: Int64
    public var title: String
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var isPrepBlock: Bool
    public var instanceDate: String?
}

public enum EventExpander {
    /// Expand one event into occurrences, applying the desktop's rules:
    /// - non-recurring: one occurrence (+ a prep block for lectures with
    ///   prep_minutes, timed events only)
    /// - recurring: walk day-by-day from the event's start date to
    ///   recurrence_end (or +1 year), keeping days listed in
    ///   recurrence_days (0=Sun…6=Sat), skipping skipped_dates, applying
    ///   per_day_times overrides, else carrying the original duration.
    ///
    /// Divergence note: the desktop derives occurrence date strings via
    /// Date.toISOString() (UTC), which shifts a day in UTC-positive
    /// timezones; we use the local date, which is what the calendar grid
    /// actually displays.
    public static func expand(
        _ event: LoomEvent,
        calendar: Foundation.Calendar = .current,
        now: Date = Date()
    ) -> [EventOccurrence] {
        guard event.deletedAt == nil, let eventId = event.id else { return [] }

        // Non-recurring
        guard event.isRecurring == true else {
            if event.isAllDay == true {
                guard let day = parseDateOnly(String(event.startTime.prefix(10)), calendar) else { return [] }
                return [EventOccurrence(
                    id: String(eventId), eventId: eventId, calendarId: event.calendarId,
                    title: event.title, start: day,
                    end: calendar.date(byAdding: .day, value: 1, to: day)!,
                    isAllDay: true, isPrepBlock: false, instanceDate: nil
                )]
            }
            guard let start = parseLocalISO(event.startTime),
                  let end = parseLocalISO(event.endTime) else { return [] }
            var out = [EventOccurrence(
                id: String(eventId), eventId: eventId, calendarId: event.calendarId,
                title: event.title, start: start, end: end,
                isAllDay: false, isPrepBlock: false, instanceDate: nil
            )]
            if event.eventType == "lecture", let prep = event.prepMinutes, prep > 0 {
                out.append(EventOccurrence(
                    id: "\(eventId)_prep", eventId: eventId, calendarId: event.calendarId,
                    title: event.title,
                    start: start.addingTimeInterval(-Double(prep) * 60), end: start,
                    isAllDay: false, isPrepBlock: true, instanceDate: nil
                ))
            }
            return out
        }

        // Recurring
        let days = Set(
            (event.recurrenceDays ?? "")
                .split(separator: ",")
                .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        )
        guard !days.isEmpty,
              let startDT = parseLocalISO(event.startTime),
              let endDT = parseLocalISO(event.endTime) else { return [] }

        let skipped = Set((event.skippedDates ?? "").split(separator: ",").map(String.init))
        let perDay = parsePerDayTimes(event.perDayTimes)
        let duration = endDT.timeIntervalSince(startDT)

        let limit: Date
        if let recurrenceEnd = event.recurrenceEnd,
           let endDay = parseDateOnly(recurrenceEnd, calendar) {
            limit = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: endDay)!
        } else {
            limit = calendar.date(byAdding: .year, value: 1, to: startDT)!
        }

        let startHM = calendar.dateComponents([.hour, .minute], from: startDT)
        let originDay = calendar.startOfDay(for: startDT)
        var cursor = originDay
        var results: [EventOccurrence] = []

        while cursor <= limit {
            let dow = calendar.component(.weekday, from: cursor) - 1  // 0=Sun…6=Sat, JS getDay()
            if days.contains(dow), cursor >= originDay {
                let dateStr = localDateString(cursor, calendar)
                if !skipped.contains(dateStr) {
                    let occStart: Date
                    let occEnd: Date
                    if let times = perDay[dow],
                       let s = setTime(times.start, on: cursor, calendar),
                       let e = setTime(times.end, on: cursor, calendar) {
                        occStart = s
                        occEnd = e
                    } else {
                        occStart = calendar.date(
                            bySettingHour: startHM.hour ?? 0, minute: startHM.minute ?? 0,
                            second: 0, of: cursor
                        )!
                        occEnd = occStart.addingTimeInterval(duration)
                    }
                    results.append(EventOccurrence(
                        id: "\(eventId)_\(dateStr)", eventId: eventId,
                        calendarId: event.calendarId, title: event.title,
                        start: occStart, end: occEnd,
                        isAllDay: event.isAllDay == true, isPrepBlock: false,
                        instanceDate: dateStr
                    ))
                    if event.eventType == "lecture", let prep = event.prepMinutes,
                       prep > 0, event.isAllDay != true {
                        results.append(EventOccurrence(
                            id: "\(eventId)_\(dateStr)_prep", eventId: eventId,
                            calendarId: event.calendarId, title: event.title,
                            start: occStart.addingTimeInterval(-Double(prep) * 60),
                            end: occStart,
                            isAllDay: false, isPrepBlock: true, instanceDate: dateStr
                        ))
                    }
                }
            }
            cursor = calendar.date(byAdding: .day, value: 1, to: cursor)!
        }
        return results
    }

    /// All occurrences from `events` overlapping [from, to), sorted by start.
    public static func occurrences(
        in events: [LoomEvent], from: Date, to: Date,
        calendar: Foundation.Calendar = .current
    ) -> [EventOccurrence] {
        events
            .flatMap { expand($0, calendar: calendar) }
            .filter { $0.start < to && $0.end > from }
            .sorted { ($0.start, $0.title) < ($1.start, $1.title) }
    }

    // MARK: - Parsing

    /// per_day_times JSON: {"1": {"start":"09:00","end":"11:00"}, ...} —
    /// keyed by 0–6 day number. Tolerates the legacy ["09:00","11:00"]
    /// array shape. Malformed input parses to empty, same as the desktop.
    static func parsePerDayTimes(_ raw: String?) -> [Int: (start: String, end: String)] {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        var out: [Int: (start: String, end: String)] = [:]
        for (key, value) in object {
            guard let dow = Int(key) else { continue }
            if let dict = value as? [String: String],
               let s = dict["start"], let e = dict["end"] {
                out[dow] = (s, e)
            } else if let pair = value as? [String], pair.count == 2 {
                out[dow] = (pair[0], pair[1])
            }
        }
        return out
    }

    /// Desktop timestamps are timezone-naive ISO strings rendered in local
    /// time ("2026-06-12T09:00:00", optional fractional seconds).
    public static func parseLocalISO(_ string: String) -> Date? {
        let formats = ["yyyy-MM-dd'T'HH:mm:ss.SSSSSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"]
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format
            if let date = formatter.date(from: string) { return date }
        }
        return nil
    }

    static func parseDateOnly(_ string: String, _ calendar: Foundation.Calendar) -> Date? {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    public static func localDateString(_ date: Date, _ calendar: Foundation.Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    static func setTime(_ hhmm: String, on day: Date, _ calendar: Foundation.Calendar) -> Date? {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        return calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day)
    }
}
