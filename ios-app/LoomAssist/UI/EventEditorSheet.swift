import SwiftUI
import LoomKit

/// Identifiable wrapper so .sheet(item:) can key on an event id.
struct EditingEvent: Identifiable {
    let id: Int64
}

/// Light-edit sheet per the handoff's Modal spec: bgPanel surface, 17pt/600
/// header with a ghost × close, fields with uppercase micro-labels, and a
/// footer action strip on bgSubtle behind a hairline.
struct EventEditorSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    let eventId: Int64

    @State private var title: String = ""
    @State private var start: Date = .now
    @State private var end: Date = .now
    @State private var isRecurring = false
    @State private var confirmingDelete = false
    @State private var loaded = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(LoomColor.border)

            ScrollView {
                VStack(alignment: .leading, spacing: LoomSpace.s7) {
                    field("Title") {
                        TextField("Event title", text: $title)
                            .font(LoomFont.body)
                            .foregroundStyle(LoomColor.textMain)
                            .padding(12)
                            .frame(minHeight: LoomSpace.minTapTarget)
                            .background(LoomColor.bgSubtle)
                            .clipShape(RoundedRectangle(cornerRadius: LoomRadius.md, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: LoomRadius.md, style: .continuous)
                                    .stroke(LoomColor.border, lineWidth: 1)
                            )
                    }

                    if isRecurring {
                        Text("This event repeats — the title edit applies to every occurrence. Time changes for recurring events arrive in a later update.")
                            .font(LoomFont.secondary)
                            .foregroundStyle(LoomColor.textMuted)
                    } else {
                        field("Starts") {
                            DatePicker("", selection: $start)
                                .labelsHidden()
                                .tint(LoomColor.accent)
                        }
                        field("Ends") {
                            DatePicker("", selection: $end, in: start...)
                                .labelsHidden()
                                .tint(LoomColor.accent)
                        }
                    }
                }
                .padding(LoomSpace.s7)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            footer
        }
        .background(LoomColor.bgPanel)
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(LoomRadius.xxl)
        .onAppear(perform: load)
        .confirmationDialog("Delete this event?", isPresented: $confirmingDelete,
                            titleVisibility: .visible) {
            Button("Delete event", role: .destructive) {
                store.deleteEvent(eventId: eventId)
                dismiss()
            }
        } message: {
            Text(isRecurring ? "Every occurrence will be removed." : "This can be synced back from another device until the change propagates.")
        }
    }

    private var header: some View {
        HStack {
            Text("Edit event")
                .font(LoomFont.title)
                .foregroundStyle(LoomColor.textMain)
            Spacer()
            // FLAGGED: SF Symbol approximation of the stroke-set × glyph
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(LoomColor.textMuted)
                    .frame(width: LoomSpace.minTapTarget, height: LoomSpace.minTapTarget)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, LoomSpace.s7)
        .padding(.vertical, LoomSpace.s4)
    }

    private var footer: some View {
        HStack {
            Button("Delete") { confirmingDelete = true }
                .font(LoomFont.control.weight(.medium))
                .foregroundStyle(LoomColor.error)
                .frame(minHeight: LoomSpace.minTapTarget)
                .buttonStyle(.plain)

            Spacer()

            Button {
                store.saveEvent(
                    eventId: eventId, title: title,
                    start: isRecurring ? nil : start,
                    end: isRecurring ? nil : end
                )
                dismiss()
            } label: {
                Text("Save")
                    .font(LoomFont.control)
                    .foregroundStyle(LoomColor.onAccent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(LoomColor.accent)
                    .clipShape(RoundedRectangle(cornerRadius: LoomRadius.lg, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            .opacity(title.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
        }
        .padding(.horizontal, LoomSpace.s7)
        .padding(.vertical, LoomSpace.s5)
        .background(LoomColor.bgSubtle)
        .overlay(alignment: .top) {
            Rectangle().fill(LoomColor.border).frame(height: 1)
        }
    }

    @ViewBuilder
    private func field(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: LoomSpace.s3) {
            Text(label).loomLabelStyle()
            content()
        }
    }

    private func load() {
        guard !loaded, let event = store.event(byId: eventId) else { return }
        loaded = true
        title = event.title
        isRecurring = event.isRecurring == true
        start = EventExpander.parseLocalISO(event.startTime) ?? .now
        end = EventExpander.parseLocalISO(event.endTime) ?? .now
    }
}
