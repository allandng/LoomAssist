import SwiftUI
import LoomKit

// Shared LoomAssist components, per the design handoff README.
// Icons: the handoff's icons.svg only ships social glyphs, not the ~30-glyph
// product stroke set — every SF Symbol below is a FLAGGED approximation per
// the README's escape hatch, to be replaced when the real set arrives.

// MARK: - Timeline color

extension Color {
    /// Parse a stored timeline hex ("#A8643F"); falls back to loom accent.
    init(timelineHex: String?) {
        guard var hex = timelineHex?.trimmingCharacters(in: .whitespaces),
              hex.hasPrefix("#"), hex.count == 7 else {
            self = LoomColor.accent
            return
        }
        hex.removeFirst()
        guard let value = UInt32(hex, radix: 16) else {
            self = LoomColor.accent
            return
        }
        self = Color(UIColor(hex: value))
    }
}

// MARK: - Section label

struct SectionLabel: View {
    let text: String
    var count: Int? = nil

    var body: some View {
        HStack {
            Text(text).loomMicroHeaderStyle()
            Spacer()
            if let count {
                Text("\(count)")
                    .font(LoomFont.monoSmall)
                    .foregroundStyle(LoomColor.textDim)
            }
        }
    }
}

// MARK: - Event pill (anatomy is sacred)

struct EventPillView: View {
    let occurrence: EventOccurrence
    let swatch: Color
    var showsDate: Bool = false

    private var timeLabel: String {
        if occurrence.isAllDay { return "all day" }
        let formatter = DateFormatter()
        formatter.dateFormat = "H:mm"
        return formatter.string(from: occurrence.start)
    }

    var body: some View {
        HStack(spacing: LoomSpace.s4) {
            // 3pt leading bar in the full swatch, inset, radius 1
            RoundedRectangle(cornerRadius: 1)
                .fill(swatch)
                .frame(width: 3)
                .padding(.vertical, 3)

            Text(timeLabel)
                .font(LoomFont.monoSmall)
                .foregroundStyle(swatch)

            Text(occurrence.title)
                .font(LoomFont.secondary.weight(.medium))
                .italic(occurrence.isPrepBlock)
                .foregroundStyle(LoomColor.textMain)
                .lineLimit(1)

            if occurrence.isPrepBlock {
                Text("prep")
                    .font(LoomFont.monoSmall)
                    .foregroundStyle(LoomColor.textDim)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, LoomSpace.s4)
        .padding(.vertical, LoomSpace.s3)
        .frame(minHeight: LoomSpace.minTapTarget)
        .background(
            occurrence.isPrepBlock
                ? AnyShapeStyle(PrepStripes(color: swatch))
                : AnyShapeStyle(swatch.opacity(0.13))
        )
        .clipShape(RoundedRectangle(cornerRadius: LoomRadius.sm, style: .continuous))
        .opacity(occurrence.isPrepBlock ? 0.65 : 1)
    }
}

/// Sanctioned 45° stripe pattern for prep blocks: swatch @ 8% / clear, 4pt period.
struct PrepStripes: ShapeStyle {
    let color: Color

    func resolve(in environment: EnvironmentValues) -> some ShapeStyle {
        ImagePaint(image: Image(size: CGSize(width: 8, height: 8)) { context in
            context.fill(Path(CGRect(origin: .zero, size: CGSize(width: 8, height: 8))),
                         with: .color(.clear))
            var stripe = Path()
            stripe.move(to: CGPoint(x: -2, y: 10))
            stripe.addLine(to: CGPoint(x: 10, y: -2))
            context.stroke(stripe, with: .color(color.opacity(0.08)), lineWidth: 4)
        })
    }
}

// MARK: - Segmented view switcher (Day / Week)

struct LoomSegmented<Option: Hashable>: View {
    let options: [(Option, String)]
    @Binding var selection: Option

    var body: some View {
        HStack(spacing: LoomSpace.s1) {
            ForEach(options, id: \.0) { option, label in
                let active = option == selection
                Text(label)
                    .font(LoomFont.label)
                    .foregroundStyle(active ? LoomColor.textMain : LoomColor.textMuted)
                    .padding(.horizontal, LoomSpace.s6)
                    .padding(.vertical, LoomSpace.s4)
                    .frame(minHeight: 36)
                    .background(active ? LoomColor.bgElevated : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: LoomRadius.lg - 2, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: LoomRadius.lg - 2, style: .continuous)
                            .stroke(active ? LoomColor.border : .clear, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(LoomMotion.selection) { selection = option }
                        UISelectionFeedbackGenerator().selectionChanged()
                    }
            }
        }
        .padding(LoomSpace.s1)
        .background(LoomColor.bgSubtle)
        .clipShape(RoundedRectangle(cornerRadius: LoomRadius.lg, style: .continuous))
    }
}

// MARK: - Checkbox (display)

struct LoomCheckbox: View {
    let isOn: Bool
    let color: Color

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: LoomRadius.xs, style: .continuous)
                .fill(isOn ? color : .clear)
            RoundedRectangle(cornerRadius: LoomRadius.xs, style: .continuous)
                .stroke(color, lineWidth: 1.5)
            if isOn {
                // FLAGGED: SF Symbol approximation of the stroke-set check glyph
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(LoomColor.onAccent)
            }
        }
        .frame(width: 19, height: 19)
        .animation(LoomMotion.standard, value: isOn)
    }
}

// MARK: - Ghost icon button (nav chevrons etc.)

struct GhostIconButton: View {
    let systemName: String  // FLAGGED: SF Symbol approximations of the stroke set
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(LoomColor.textMain)
                .frame(width: LoomSpace.minTapTarget, height: LoomSpace.minTapTarget)
                .background(.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: LoomRadius.xl, style: .continuous)
                        .stroke(LoomColor.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}
