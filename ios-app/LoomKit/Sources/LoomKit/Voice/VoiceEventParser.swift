import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// A parsed "voice → event" draft, ready for user confirmation.
public struct EventDraft: Equatable, Sendable {
    public enum Source: String, Sendable {
        /// Apple Intelligence Foundation Models (on-device LLM).
        case appleIntelligence
        /// NSDataDetector date extraction — the capability fallback.
        case dateDetector
    }

    public var title: String
    public var start: Date
    public var end: Date
    public var source: Source

    public init(title: String, start: Date, end: Date, source: Source) {
        self.title = title
        self.start = start
        self.end = end
        self.source = source
    }
}

/// Transcript → EventDraft. Tries the on-device LLM when Apple Intelligence
/// is available (iOS 26 FoundationModels), otherwise — or on any model
/// failure — falls back to date detection. Both paths run fully on-device;
/// nothing about the transcript leaves the phone.
public enum VoiceEventParser {
    public static func parse(_ transcript: String, now: Date = Date()) async -> EventDraft? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *), SmartIntentParser.isAvailable {
            if let draft = try? await SmartIntentParser.parse(transcript, now: now) {
                return draft
            }
            // Model refused or returned garbage — degrade, don't fail.
        }
        #endif
        return FallbackIntentParser.parse(transcript, now: now)
    }

    /// For UI messaging ("Using on-device intelligence" vs "Basic parsing").
    public static var smartParserAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            return SmartIntentParser.isAvailable
        }
        #endif
        return false
    }
}

// MARK: - Apple Intelligence path

#if canImport(FoundationModels)
@available(iOS 26.0, macOS 26.0, *)
@Generable
struct GeneratedEventDraft {
    @Guide(description: "Short event title without dates, e.g. 'Lunch with Sam'")
    var title: String
    @Guide(description: "Event start in the local timezone, format yyyy-MM-dd'T'HH:mm:ss")
    var startISO: String
    @Guide(description: "Event end in the local timezone, format yyyy-MM-dd'T'HH:mm:ss. If no duration or end was stated, use one hour after start.")
    var endISO: String
}

@available(iOS 26.0, macOS 26.0, *)
enum SmartIntentParser {
    static var isAvailable: Bool {
        SystemLanguageModel.default.availability == .available
    }

    static func parse(_ transcript: String, now: Date) async throws -> EventDraft? {
        let nowISO = LocalEdits.localISO(now)
        let weekday = now.formatted(.dateTime.weekday(.wide))
        // Small on-device models misresolve bare weekday names; spell out
        // the next week as a lookup table instead of trusting date math.
        let cal = Foundation.Calendar.current
        let weekTable = (0...6).map { offset -> String in
            let day = cal.date(byAdding: .day, value: offset, to: now)!
            var name = day.formatted(.dateTime.weekday(.wide))
            if offset == 0 { name += " (today)" }
            if offset == 1 { name += " (tomorrow)" }
            return "\(name) = \(EventExpander.localDateString(day, cal))"
        }.joined(separator: ", ")
        let session = LanguageModelSession(instructions: """
            You convert spoken calendar requests into a single event draft.
            The current local date-time is \(nowISO) (\(weekday)).
            Date lookup table for relative names: \(weekTable).
            Use those exact dates for weekday names. Times are local —
            do not convert timezones.
            """)
        let response = try await session.respond(
            to: transcript, generating: GeneratedEventDraft.self
        )
        guard let start = EventExpander.parseLocalISO(response.content.startISO) else {
            return nil
        }
        let end = EventExpander.parseLocalISO(response.content.endISO)
            .flatMap { $0 > start ? $0 : nil }
            ?? start.addingTimeInterval(3600)
        let title = response.content.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }
        return EventDraft(title: title, start: start, end: end, source: .appleIntelligence)
    }
}
#endif

// MARK: - Date-detector fallback

public enum FallbackIntentParser {
    public static func parse(_ transcript: String, now: Date = Date()) -> EventDraft? {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)
        let range = NSRange(trimmed.startIndex..<trimmed.endIndex, in: trimmed)
        let match = detector?
            .matches(in: trimmed, options: [], range: range)
            .first { $0.date != nil }

        let start = match?.date ?? nextFullHour(after: now)
        let duration = (match?.duration).flatMap { $0 > 0 ? $0 : nil } ?? 3600
        let end = start.addingTimeInterval(duration)

        var title = trimmed
        if let match, let matchRange = Range(match.range, in: trimmed) {
            title.removeSubrange(matchRange)
        }
        title = cleanTitle(title)
        return EventDraft(
            title: title.isEmpty ? "New event" : title,
            start: start, end: end, source: .dateDetector
        )
    }

    static func nextFullHour(after date: Date) -> Date {
        let cal = Foundation.Calendar.current
        let hour = cal.dateComponents([.hour], from: date).hour ?? 0
        return cal.date(
            bySettingHour: min(hour + 1, 23), minute: 0, second: 0, of: date
        ) ?? date
    }

    /// Strip command verbs ("schedule", "add…") and dangling connectives
    /// left behind when the date phrase is removed.
    static func cleanTitle(_ raw: String) -> String {
        var title = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        let leaders = ["please", "schedule", "add", "create", "book", "set up", "new event", "an event", "event"]
        var stripped = true
        while stripped {
            stripped = false
            for leader in leaders where title.lowercased().hasPrefix(leader + " ") {
                title = String(title.dropFirst(leader.count + 1))
                stripped = true
            }
        }

        let trailers = ["on", "at", "for", "from", "this", "next"]
        var trimming = true
        while trimming {
            trimming = false
            title = title.trimmingCharacters(in: CharacterSet(charactersIn: " ,.!?"))
            for trailer in trailers where title.lowercased().hasSuffix(" " + trailer) {
                title = String(title.dropLast(trailer.count + 1))
                trimming = true
            }
        }

        guard let first = title.first else { return title }
        return first.uppercased() + title.dropFirst()
    }
}
