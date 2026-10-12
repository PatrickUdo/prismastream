// "Prisma" design tokens for tvOS: near-black depth, a violet accent, spectral highlights.
// Mirrors src/app.css, scaled for a 10-foot UI (1920×1080 pt canvas).

import SwiftUI

extension Color {
    /// "#rrggbb" or "rrggbb"; falls back to the default accent on malformed input.
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        let v = UInt64(s, radix: 16) ?? 0x7c5cff
        self.init(.sRGB,
                  red: Double((v >> 16) & 0xff) / 255,
                  green: Double((v >> 8) & 0xff) / 255,
                  blue: Double(v & 0xff) / 255,
                  opacity: 1)
    }
}

enum Theme {
    static let bg = Color(hex: "#07070b")
    static let elev1 = Color(hex: "#101018")
    static let elev2 = Color(hex: "#171722")
    static let elev3 = Color(hex: "#20202e")
    static let text = Color(hex: "#f4f3f8")
    static let text2 = Color(hex: "#f4f3f8").opacity(0.72)
    static let text3 = Color(hex: "#f4f3f8").opacity(0.5)
    static let line = Color.white.opacity(0.08)
    static let lineStrong = Color.white.opacity(0.16)
    static let live = Color(hex: "#ff3b5c")
    static let rating = Color(hex: "#ffd27a")
    static let success = Color(hex: "#3ddc97")
    static let defaultAccent = Color(hex: "#7c5cff")

    static let spectrum: [Color] = ["#ff6b8b", "#ffad6b", "#ffe58a", "#7dffc4", "#6bc8ff", "#8f7bff", "#e57bff"].map(Color.init(hex:))

    @MainActor static let accentChoices: [(name: LocalizedStringKey, hex: String)] = [
        ("Violet", "#7c5cff"), ("Oceaan", "#3d8bff"), ("Turkoois", "#20c9b0"),
        ("Koraal", "#ff6b6b"), ("Amber", "#ffb547"), ("Roze", "#ff5fa2")
    ]

    // Overscan-safe horizontal margin for full-bleed screens (tvOS safe area is 80 pt).
    static let gutter: CGFloat = 80

    // Type scale for 10 feet.
    static let display = Font.system(size: 84, weight: .heavy, design: .default)
    static let title1 = Font.system(size: 56, weight: .bold)
    static let title2 = Font.system(size: 40, weight: .bold)
    static let headline = Font.system(size: 31, weight: .semibold)
    static let body = Font.system(size: 29, weight: .regular)
    static let callout = Font.system(size: 25, weight: .medium)
    static let caption = Font.system(size: 22, weight: .semibold)
    static let eyebrow = Font.system(size: 21, weight: .bold)
}

/// Accent from settings, available everywhere.
private struct AccentKey: EnvironmentKey {
    static let defaultValue: Color = Theme.defaultAccent
}

extension EnvironmentValues {
    var accent: Color {
        get { self[AccentKey.self] }
        set { self[AccentKey.self] = newValue }
    }
}

// MARK: - Reusable text styles

struct Eyebrow: View {
    let text: LocalizedStringKey
    var color: Color = Theme.text3
    init(_ text: LocalizedStringKey, color: Color = Theme.text3) {
        self.text = text
        self.color = color
    }
    var body: some View {
        Text(text)
            .font(Theme.eyebrow)
            .tracking(3)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

struct SectionHeader: View {
    let title: LocalizedStringKey
    var eyebrow: LocalizedStringKey?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let eyebrow { Eyebrow(eyebrow) }
            Text(title)
                .font(Theme.headline.weight(.bold))
                .foregroundStyle(Theme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Spectrum hairline, the prisma signature (used sparingly).
struct SpectrumLine: View {
    var height: CGFloat = 3
    var body: some View {
        LinearGradient(colors: Theme.spectrum, startPoint: .leading, endPoint: .trailing)
            .frame(height: height)
            .clipShape(Capsule())
    }
}

// MARK: - Languages

enum Lang {
    private static let names: [String: (nl: String, en: String)] = [
        "nl": ("Nederlands", "Dutch"), "en": ("Engels", "English"), "de": ("Duits", "German"),
        "fr": ("Frans", "French"), "es": ("Spaans", "Spanish"), "it": ("Italiaans", "Italian"),
        "tr": ("Turks", "Turkish"), "ar": ("Arabisch", "Arabic"), "pl": ("Pools", "Polish"),
        "pt": ("Portugees", "Portuguese"), "ru": ("Russisch", "Russian"), "ja": ("Japans", "Japanese"),
        "ko": ("Koreaans", "Korean"), "zh": ("Chinees", "Chinese"), "hi": ("Hindi", "Hindi"),
        "sv": ("Zweeds", "Swedish"), "da": ("Deens", "Danish"), "no": ("Noors", "Norwegian"),
        "fi": ("Fins", "Finnish"), "el": ("Grieks", "Greek"), "ro": ("Roemeens", "Romanian"),
        "und": ("Onbekend", "Unknown")
    ]

    static let known: [String] = ["nl", "en", "de", "fr", "es", "it", "tr", "ar", "pl", "pt", "ru", "ja", "ko", "zh", "hi", "sv", "da", "no", "fi", "el", "ro"]

    static var uiIsDutch: Bool {
        (Bundle.main.preferredLocalizations.first ?? "nl").hasPrefix("nl")
    }

    static func name(_ code: String) -> String {
        guard let n = names[code] else { return code.uppercased() }
        return uiIsDutch ? n.nl : n.en
    }

    /// Poster badge: "EN NL FR +7" with the profile's languages first.
    static func badge(_ langs: [String], preferred: [String], max: Int = 3) -> String {
        let known = langs.filter { $0 != "und" }
        guard !known.isEmpty else { return "" }
        let ordered = preferred.filter(known.contains) + known.filter { !preferred.contains($0) }
        let head = ordered.prefix(max).map { $0.uppercased() }.joined(separator: " ")
        return ordered.count > max ? "\(head) +\(ordered.count - max)" : head
    }
}

enum Format {
    static func runtime(_ minutes: Double?) -> String? {
        guard let m = minutes, m > 0 else { return nil }
        let total = Int(m.rounded())
        let h = total / 60, mm = total % 60
        if h == 0 { return String(localized: "\(mm) min") }
        return mm == 0 ? String(localized: "\(h) u") : String(localized: "\(h) u \(mm) min")
    }

    /// "2025-02-16" → "16 februari 2025" (falls back to the input).
    static func date(_ iso: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: String(iso.prefix(10))) else { return iso }
        return d.formatted(.dateTime.day().month(.wide).year())
    }

    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }

    static func qualityName(_ q: Quality) -> String {
        switch q {
        case .uhd: "4K Ultra HD"
        case .fhd: "Full HD"
        case .hd: "HD"
        case .sd: "SD"
        case .unknown: String(localized: "Standaard")
        }
    }

    static func qualityShort(_ q: Quality) -> String {
        switch q {
        case .uhd: "4K"
        case .fhd: "FHD"
        case .hd: "HD"
        case .sd: "SD"
        case .unknown: ""
        }
    }
}
