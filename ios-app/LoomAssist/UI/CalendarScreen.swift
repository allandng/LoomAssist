import SwiftUI
import LoomKit

enum CalendarViewMode: String, CaseIterable {
    case day, week
}

struct CalendarScreen: View {
    @EnvironmentObject var store: AppStore
    @State private var mode: CalendarViewMode = {
        #if DEBUG
        // Screenshot-harness preset, not a user-facing setting.
        if ProcessInfo.processInfo.environment["LOOM_START_MODE"] == "week" { return .week }
        #endif
        return .day
    }()
    @State private var anchor = Foundation.Calendar.current.startOfDay(for: Date())
    @State private var editing: EditingEvent?
    @State private var capturing = false

    private var cal: Foundation.Calendar { .current }

    private var weekStart: Date {
        let weekday = cal.component(.weekday, from: anchor) - 1  // 0=Sun
        return cal.date(byAdding: .day, value: -weekday, to: anchor)!
    }

    private var headerTitle: String {
        let formatter = DateFormatter()
        switch mode {
        case .day:
            formatter.dateFormat = "EEEE, MMM d"
            return formatter.string(from: anchor)
        case .week:
            formatter.dateFormat = "MMM d"
            let end = cal.date(byAdding: .day, value: 6, to: weekStart)!
            return "\(formatter.string(from: weekStart)) – \(formatter.string(from: end))"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(LoomColor.border)
            ScrollView {
                VStack(alignment: .leading, spacing: LoomSpace.s7) {
                    switch mode {
                    case .day: daySection(anchor, showEmpty: true)
                    case .week:
                        ForEach(0..<7, id: \.self) { offset in
                            daySection(cal.date(byAdding: .day, value: offset, to: weekStart)!,
                                       showEmpty: false)
                        }
                    }
                }
                .padding(.horizontal, LoomSpace.s7)
                .padding(.vertical, LoomSpace.s6)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(LoomColor.bgMain)
        // Quick capture — the one floating element the design allows.
        .overlay(alignment: .bottomTrailing) {
            Button { capturing = true } label: {
                // FLAGGED: SF Symbol approximation of the stroke-set mic glyph
                Image(systemName: "mic.fill")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(LoomColor.onAccent)
                    .frame(width: 56, height: 56)
                    .background(LoomColor.accent)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(LoomSpace.s7)
        }
        .sheet(item: $editing) { editing in
            EventEditorSheet(eventId: editing.id)
                .environmentObject(store)
        }
        .sheet(isPresented: $capturing) {
            VoiceCaptureSheet()
                .environmentObject(store)
        }
        #if DEBUG
        .onAppear {
            // Screenshot-harness preset, not a user-facing setting.
            if ProcessInfo.processInfo.environment["LOOM_OPEN_EDITOR"] == "1",
               let first = store.events.first?.id {
                editing = EditingEvent(id: first)
            }
        }
        #endif
    }

    private var header: some View {
        VStack(spacing: LoomSpace.s5) {
            HStack(spacing: LoomSpace.s4) {
                Text(headerTitle)
                    .font(LoomFont.title)
                    .foregroundStyle(LoomColor.textMain)
                Spacer()
                // FLAGGED: SF Symbol chevrons approximate the stroke icon set
                GhostIconButton(systemName: "chevron.left") { step(-1) }
                Button("Today") { withAnimation(LoomMotion.standard) { anchor = cal.startOfDay(for: Date()) } }
                    .font(LoomFont.label)
                    .foregroundStyle(LoomColor.accent)
                    .frame(minHeight: LoomSpace.minTapTarget)
                GhostIconButton(systemName: "chevron.right") { step(1) }
            }
            HStack {
                LoomSegmented(
                    options: [(CalendarViewMode.day, "Day"), (.week, "Week")],
                    selection: $mode
                )
                Spacer()
            }
        }
        .padding(.horizontal, LoomSpace.s7)
        .padding(.vertical, LoomSpace.s5)
    }

    private func step(_ direction: Int) {
        let component: Foundation.Calendar.Component = mode == .day ? .day : .weekOfYear
        withAnimation(LoomMotion.standard) {
            anchor = cal.date(byAdding: component, value: direction, to: anchor)!
        }
    }

    @ViewBuilder
    private func daySection(_ day: Date, showEmpty: Bool) -> some View {
        let dayEnd = cal.date(byAdding: .day, value: 1, to: day)!
        let occurrences = EventExpander.occurrences(in: store.events, from: day, to: dayEnd)
        if !occurrences.isEmpty || showEmpty {
            VStack(alignment: .leading, spacing: LoomSpace.s4) {
                if mode == .week {
                    SectionLabel(text: weekdayLabel(day), count: occurrences.count)
                }
                if occurrences.isEmpty {
                    Text("Nothing scheduled.")
                        .font(LoomFont.secondary)
                        .foregroundStyle(LoomColor.textDim)
                        .padding(.vertical, LoomSpace.s4)
                } else {
                    ForEach(occurrences) { occurrence in
                        EventPillView(
                            occurrence: occurrence,
                            swatch: store.timelineColor(for: occurrence.calendarId)
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            editing = EditingEvent(id: occurrence.eventId)
                        }
                    }
                }
            }
        }
    }

    private func weekdayLabel(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE d"
        let label = formatter.string(from: day)
        return cal.isDateInToday(day) ? "\(label) · today" : label
    }
}
