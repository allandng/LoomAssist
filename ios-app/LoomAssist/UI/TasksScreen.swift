import SwiftUI
import LoomKit

struct TasksScreen: View {
    @EnvironmentObject var store: AppStore

    private let columns: [(key: String, label: String)] = [
        ("backlog", "Backlog"), ("doing", "Doing"), ("done", "Done"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LoomSpace.s7) {
                Text("Tasks")
                    .font(LoomFont.heading)
                    .kerning(-0.28)
                    .foregroundStyle(LoomColor.textMain)
                    .padding(.top, LoomSpace.s5)

                ForEach(columns, id: \.key) { column in
                    let rows = store.tasks.filter { ($0.status ?? "backlog") == column.key }
                    VStack(alignment: .leading, spacing: LoomSpace.s4) {
                        SectionLabel(text: column.label, count: rows.count)
                        if rows.isEmpty {
                            Text("Empty.")
                                .font(LoomFont.secondary)
                                .foregroundStyle(LoomColor.textDim)
                        } else {
                            ForEach(rows, id: \.id) { task in
                                TaskRow(task: task)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, LoomSpace.s7)
            .padding(.bottom, LoomSpace.s8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(LoomColor.bgMain)
    }
}

struct TaskRow: View {
    @EnvironmentObject var store: AppStore
    let task: LoomTask

    private var event: LoomEvent? {
        store.event(byId: task.eventId)
    }

    private var swatch: Color {
        guard let event else { return LoomColor.accent }
        return store.timelineColor(for: event.calendarId)
    }

    var body: some View {
        HStack(spacing: LoomSpace.s5) {
            Button {
                store.toggleTask(task)
                if !task.isComplete {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            } label: {
                LoomCheckbox(isOn: task.isComplete, color: swatch)
                    .frame(width: LoomSpace.minTapTarget, height: LoomSpace.minTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: LoomSpace.s1) {
                Text(task.note ?? event?.title ?? "Untitled task")
                    .font(LoomFont.body)
                    .foregroundStyle(LoomColor.textMain)
                    .strikethrough(task.isComplete, color: LoomColor.textDim)
                    .lineLimit(2)
                if let event {
                    Text(event.title)
                        .font(LoomFont.secondary)
                        .foregroundStyle(LoomColor.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: LoomSpace.s2) {
                if let priority = task.priority, priority != "low" {
                    Text(priority)
                        .font(LoomFont.label)
                        .textCase(.uppercase)
                        .kerning(12 * 0.05)
                        .foregroundStyle(priority == "high" ? LoomColor.error : LoomColor.warning)
                }
                if let due = task.dueDate {
                    Text(due)
                        .font(LoomFont.monoSmall)
                        .foregroundStyle(LoomColor.textDim)
                }
            }
        }
        .padding(LoomSpace.s6)
        .frame(minHeight: LoomSpace.minTapTarget)
        .background(LoomColor.bgElevated)
        .clipShape(RoundedRectangle(cornerRadius: LoomRadius.xl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: LoomRadius.xl, style: .continuous)
                .stroke(LoomColor.border, lineWidth: 1)
        )
    }
}
