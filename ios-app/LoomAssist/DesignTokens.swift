// LoomAssist design tokens — SwiftUI
// Generated from the LoomAssist design system (tokens/colors.css, typography.css, spacing.css).
// Light = warm linen (default), Dark = espresso. High-contrast values are in the
// README — wire them to accessibilityContrast if scope allows.
//
// Fonts: bundle Inter (400/500/600/700) and JetBrains Mono (400/500) as TTF/OTF
// and register via UIAppFonts. Until then the fallbacks below use SF Pro / SF Mono.

import SwiftUI
import UIKit

// MARK: - Hex helpers

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1.0) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255.0,
            green: CGFloat((hex >> 8) & 0xFF) / 255.0,
            blue: CGFloat(hex & 0xFF) / 255.0,
            alpha: alpha
        )
    }
}

/// Dynamic color: light (warm linen) / dark (espresso).
private func dyn(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
    Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(hex: dark, alpha: darkAlpha)
            : UIColor(hex: light, alpha: lightAlpha)
    })
}

// MARK: - Colors

enum LoomColor {
    // Surfaces
    static let bgMain      = dyn(light: 0xFAF7F1, dark: 0x1C1713)
    static let bgPanel     = dyn(light: 0xF2EDE3, dark: 0x262019)
    static let bgElevated  = dyn(light: 0xFFFFFF, dark: 0x332B22)
    static let bgSubtle    = dyn(light: 0xEAE3D6, dark: 0x16120E)

    // Borders (borders do the separation, not shadows)
    static let border       = dyn(light: 0xE0D7C7, dark: 0x3A3128)
    static let borderStrong = dyn(light: 0xC6B9A4, dark: 0x514537)

    // Text (warm ink)
    static let textMain  = dyn(light: 0x2C2317, dark: 0xF2EBDF)
    static let textMuted = dyn(light: 0x6E6252, dark: 0xB5A793)
    static let textDim   = dyn(light: 0xA0937E, dark: 0x7F7260)

    // Accent — the logo's blue thread. ALWAYS pair accent fills with onAccent.
    static let accent        = dyn(light: 0x1D72B3, dark: 0x3FA9F5)
    static let accentSoft    = dyn(light: 0x1D72B3, dark: 0x3FA9F5, lightAlpha: 0.12, darkAlpha: 0.18)
    static let accentPressed = dyn(light: 0x165E96, dark: 0x66BDF8)   // desktop "hover"
    static let onAccent      = dyn(light: 0xFFFFFF, dark: 0x0A2540)   // never hardcode white

    // Semantic (earth-toned)
    static let success = dyn(light: 0x3D7A4E, dark: 0x7CB585)
    static let warning = dyn(light: 0xA8731C, dark: 0xDCA844)
    static let error   = dyn(light: 0xBA3B2C, dark: 0xE06A5A)
    static let info    = dyn(light: 0x3E6E96, dark: 0x7FA8C9)

    // Modal backdrop (system sheets usually handle this)
    static let modalBackdrop = dyn(light: 0x2C2317, dark: 0x0A0705, lightAlpha: 0.45, darkAlpha: 0.65)
}

// MARK: - Timeline swatches (same in both themes; never blue)

enum LoomTimeline: String, CaseIterable {
    case school, work, personal, health, family, errands

    var color: Color {
        switch self {
        case .school:   return Color(UIColor(hex: 0xA8643F)) // clay
        case .work:     return Color(UIColor(hex: 0x6B8F5E)) // sage
        case .personal: return Color(UIColor(hex: 0xC9913B)) // ochre
        case .health:   return Color(UIColor(hex: 0xB06A7E)) // dusty rose
        case .family:   return Color(UIColor(hex: 0x5E8F8A)) // muted teal
        case .errands:  return Color(UIColor(hex: 0x8A7356)) // umber
        }
    }

    /// Tinted fill for pills and chips (13% alpha).
    var tint: Color { color.opacity(0.13) }
}

// MARK: - Typography (mobile ramp, Dynamic Type–relative)

enum LoomFont {
    // Family names once the TTFs are registered. SF fallback until then.
    static let sansFamily = "Inter"          // fallback: system (SF Pro)
    static let monoFamily = "JetBrainsMono"  // fallback: system .monospaced (SF Mono)

    private static func sans(_ size: CGFloat, _ weight: Font.Weight, relativeTo style: Font.TextStyle) -> Font {
        if UIFont(name: sansFamily, size: size) != nil {
            return .custom(sansFamily, size: size, relativeTo: style).weight(weight)
        }
        return .system(style).weight(weight) // FLAGGED: SF Pro fallback until Inter is bundled
    }

    private static func mono(_ size: CGFloat, _ weight: Font.Weight, relativeTo style: Font.TextStyle) -> Font {
        if UIFont(name: monoFamily, size: size) != nil {
            return .custom(monoFamily, size: size, relativeTo: style).weight(weight)
        }
        return .system(style, design: .monospaced).weight(weight) // FLAGGED: SF Mono fallback
    }

    /// 34pt / 700 — home greeting ("Good morning, {name}.")
    static let greeting = sans(34, .bold, relativeTo: .largeTitle)
    /// 28pt / 700 — screen headings (apply .kerning(-0.28))
    static let heading = sans(28, .bold, relativeTo: .title)
    /// 20pt / 600 — brand title
    static let brand = sans(20, .semibold, relativeTo: .title3)
    /// 17pt / 600 — row, modal, and page titles
    static let title = sans(17, .semibold, relativeTo: .headline)
    /// 16pt / 400 — body default
    static let body = sans(16, .regular, relativeTo: .body)
    /// 15pt / 600 — buttons and controls
    static let control = sans(15, .semibold, relativeTo: .subheadline)
    /// 13pt / 400 — secondary copy, toasts
    static let secondary = sans(13, .regular, relativeTo: .footnote)
    /// 12pt / 600 — chip text, field labels (uppercase via labelStyle below)
    static let label = sans(12, .semibold, relativeTo: .caption)
    /// 11pt / 600 — uppercase section/column micro-headers
    static let microHeader = sans(11, .semibold, relativeTo: .caption2)

    /// 13pt mono — times, durations, "Synced 2m ago"
    static let monoMeta = mono(13, .regular, relativeTo: .footnote)
    /// 12pt mono — counts, mini-chips ("2/5"), time prefixes
    static let monoSmall = mono(12, .regular, relativeTo: .caption)
}

// MARK: - Micro-label treatment (uppercase is typographic, never typed in copy)

extension View {
    /// Field/section label: uppercase + 0.05em tracking.
    func loomLabelStyle() -> some View {
        self.font(LoomFont.label)
            .textCase(.uppercase)
            .kerning(12 * 0.05)
            .foregroundStyle(LoomColor.textMuted)
    }

    /// Column/section micro-header: uppercase + 0.08em tracking.
    func loomMicroHeaderStyle() -> some View {
        self.font(LoomFont.microHeader)
            .textCase(.uppercase)
            .kerning(11 * 0.08)
            .foregroundStyle(LoomColor.textMuted)
    }
}

// MARK: - Spacing (pt) — tight 4px-ish rhythm

enum LoomSpace {
    static let s1: CGFloat = 2
    static let s2: CGFloat = 4
    static let s3: CGFloat = 6
    static let s4: CGFloat = 8
    static let s5: CGFloat = 10
    static let s6: CGFloat = 14
    static let s7: CGFloat = 18
    static let s8: CGFloat = 24
    static let s9: CGFloat = 32

    /// Card / panel padding on mobile.
    static let panelPadding: CGFloat = 18
    /// Minimum hit target for anything tappable.
    static let minTapTarget: CGFloat = 44
}

// MARK: - Radii (pt)

enum LoomRadius {
    static let xs: CGFloat = 3      // checkboxes, tiny chips
    static let sm: CGFloat = 4      // event pills, kbd
    static let md: CGFloat = 6      // fields
    static let lg: CGFloat = 8      // buttons, segmented controls
    static let xl: CGFloat = 10     // nav buttons, task cards
    static let xxl: CGFloat = 12    // cards, modals, panels
    // capsule for chips/badges/avatar: use Capsule()
}

// MARK: - Card chrome (border, no shadow)

extension View {
    /// LoomAssist card: panel fill + 1pt hairline, NO shadow.
    func loomCard(fill: Color = LoomColor.bgPanel) -> some View {
        self.padding(LoomSpace.panelPadding)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: LoomRadius.xxl, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: LoomRadius.xxl, style: .continuous)
                    .stroke(LoomColor.border, lineWidth: 1)
            )
    }
}

// MARK: - Motion

enum LoomMotion {
    /// Standard UI transition: 80–150ms plain ease. No springs, no bounce.
    static let standard: Animation = .easeInOut(duration: 0.1)
    static let selection: Animation = .easeInOut(duration: 0.15)
    /// Live-state pulse period (sync dot, urgent chips). Gate on Reduce Motion.
    static let pulsePeriod: Double = 1.4
}
