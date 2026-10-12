// Generative artwork for titles without images: deterministic per id (FNV-1a + mulberry32, like
// components/art.ts), a genre palette, one motif (prism, eclipse, orbits, bloom, horizon) drawn
// with Canvas, and big title typography on posters.

import SwiftUI

struct SeededRandom {
    private var state: UInt32

    init(seed: UInt32) { state = seed }

    init(_ key: String) {
        var h: UInt32 = 0x811c9dc5
        for u in key.utf16 {
            h ^= UInt32(u)
            h = h &* 0x01000193
        }
        state = h
    }

    /// mulberry32 in [0, 1).
    mutating func next() -> Double {
        state = state &+ 0x6d2b79f5
        var t = state
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }

    mutating func between(_ a: Double, _ b: Double) -> Double { a + (b - a) * next() }
    mutating func int(_ n: Int) -> Int { min(n - 1, Int(next() * Double(n))) }
    mutating func pick<T>(_ list: [T]) -> T { list[int(list.count)] }
}

struct ArtPalette {
    var bg: (Color, Color)
    var tones: [Color]
    var glow: Color
    var ink: Color

    init(_ bg0: String, _ bg1: String, _ tones: [String], _ glow: String, _ ink: String) {
        bg = (Color(hex: bg0), Color(hex: bg1))
        self.tones = tones.map(Color.init(hex:))
        self.glow = Color(hex: glow)
        self.ink = Color(hex: ink)
    }
}

enum GenreFamily: String {
    case scifi, horror, comedy, drama, action, thriller, romance, fantasy, animation, documentary, music, western, prisma

    private static let keywords: [(GenreFamily, [String])] = [
        (.horror, ["horror", "griezel", "eng"]),
        (.scifi, ["sci", "science", "ruimte", "space", "cyber", "toekomst"]),
        (.animation, ["anim", "famil", "kind", "kids", "jeugd", "tekenfilm"]),
        (.fantasy, ["fantasy", "fantas", "avontuur", "adventure", "sprookje", "magie"]),
        (.music, ["muziek", "music", "musical", "concert"]),
        (.comedy, ["komed", "comed", "humor", "sitcom"]),
        (.romance, ["roman", "liefde", "love"]),
        (.thriller, ["thriller", "misdaad", "crime", "myster", "spanning", "detective", "noir"]),
        (.action, ["actie", "action", "superheld", "superhero", "martial"]),
        (.western, ["western", "oorlog", "war"]),
        (.documentary, ["docu", "histor", "geschied", "natuur", "nature", "biogra", "reality"]),
        (.drama, ["drama", "soap"])
    ]

    static func from(_ genres: [String]) -> GenreFamily {
        let lower = genres.map { $0.lowercased() }
        for (family, keys) in keywords where lower.contains(where: { g in keys.contains { g.contains($0) } }) {
            return family
        }
        return .prisma
    }

    var palettes: [ArtPalette] {
        switch self {
        case .scifi: [ArtPalette("#05071a", "#0c0826", ["#3b5bff", "#8f5cff", "#28d7ff"], "#9ff0ff", "#eef4ff"),
                      ArtPalette("#03060c", "#06192a", ["#1f9dff", "#5b4bff", "#7ff2ff"], "#d2f8ff", "#eaf7ff")]
        case .horror: [ArtPalette("#050102", "#160306", ["#6e0913", "#c8162a", "#3a0710"], "#ff5a44", "#f6e9e6"),
                       ArtPalette("#030303", "#0d0a0a", ["#4f0b10", "#8d877e", "#220406"], "#ebe5d6", "#efe9df")]
        case .comedy: [ArtPalette("#1c0b06", "#2b1305", ["#ff8a3d", "#ffd166", "#ff5d8f"], "#fff1c2", "#fff8ee"),
                       ArtPalette("#120b22", "#2a1040", ["#ffb547", "#ff6f91", "#7ad7ff"], "#fff3d6", "#fff7f0")]
        case .drama: [ArtPalette("#0b0c10", "#15171d", ["#4b5568", "#b08f86", "#d8c7a8"], "#f3e9d6", "#f4f0e9"),
                      ArtPalette("#090c0c", "#121a1a", ["#3f5a5a", "#9fb3a6", "#c9a68a"], "#eef0e2", "#f1f2ec")]
        case .action: [ArtPalette("#0a0604", "#170b05", ["#ff6a13", "#ffb347", "#2a3b4f"], "#ffdcaa", "#fff6ea"),
                       ArtPalette("#05070a", "#0c1119", ["#ff3d2e", "#ffae00", "#3a4d63"], "#ffe1b0", "#fff4ea")]
        case .thriller: [ArtPalette("#03080a", "#071416", ["#0e4a4c", "#2fb3a2", "#bfe8e1"], "#a9f7ea", "#ecfbf8"),
                         ArtPalette("#06070a", "#0d1118", ["#1d2b45", "#d4a24c", "#5d7ea8"], "#ffe2a6", "#f5efe2")]
        case .romance: [ArtPalette("#13060c", "#220a17", ["#e2557a", "#ffb4a2", "#9b6bff"], "#ffe3e8", "#fff2f4"),
                        ArtPalette("#100812", "#1f0d22", ["#c0587e", "#f5c2a8", "#6e5bd6"], "#fff0ea", "#fff4f1")]
        case .fantasy: [ArtPalette("#03100c", "#06201a", ["#1f7a63", "#d4af37", "#7fd1b9"], "#ffeeb3", "#f6f4e6"),
                        ArtPalette("#070a18", "#0f1830", ["#2f5bb3", "#c79bff", "#e7c873"], "#fff3cf", "#f4f1ff")]
        case .animation: [ArtPalette("#0b1030", "#16194c", ["#4f8cff", "#ffcf5c", "#ff6fb5"], "#ffffff", "#ffffff"),
                          ArtPalette("#08222a", "#0c3340", ["#2ad4b0", "#ffd65c", "#ff7a59"], "#ffffff", "#ffffff")]
        case .documentary: [ArtPalette("#0d0c0a", "#1a1712", ["#6b5b45", "#c8a96a", "#e8e0d0"], "#fff6e0", "#f7f2e8"),
                            ArtPalette("#070c0b", "#0f1a17", ["#3b5e52", "#a7c4a0", "#e1d9b8"], "#f5f7e6", "#f2f5ec")]
        case .music: [ArtPalette("#0b0614", "#1a0a2a", ["#d946ef", "#22d3ee", "#f472b6"], "#fbe7ff", "#fdf5ff")]
        case .western: [ArtPalette("#0d0a06", "#1c1309", ["#7a5a2e", "#c2763a", "#e8c48c"], "#ffe4b5", "#fbf1e2")]
        case .prisma: [ArtPalette("#07070d", "#110c24", ["#5b45d6", "#4fd1c5", "#e57bff"], "#ece8ff", "#f6f4ff"),
                       ArtPalette("#06080d", "#0b1424", ["#3f6bd8", "#9a7bff", "#ff9bc0"], "#f0f4ff", "#f4f6ff")]
        }
    }

    var motifs: [ArtMotif] {
        switch self {
        case .scifi: [.prism, .orbits, .eclipse]
        case .horror: [.eclipse, .horizon]
        case .comedy, .animation, .music: [.bloom, .orbits]
        case .drama, .romance: [.bloom, .horizon, .eclipse]
        case .action, .western: [.horizon, .prism]
        case .thriller: [.eclipse, .horizon, .prism]
        case .fantasy: [.orbits, .bloom, .horizon]
        case .documentary: [.horizon, .bloom]
        case .prisma: [.prism, .orbits, .bloom]
        }
    }
}

enum ArtMotif { case prism, eclipse, orbits, bloom, horizon }

struct ArtSpec {
    var palette: ArtPalette
    var motif: ArtMotif
    var seed: String

    init(seed: String, genres: [String]) {
        var r = SeededRandom(seed)
        let family = GenreFamily.from(genres)
        palette = r.pick(family.palettes)
        motif = r.pick(family.motifs)
        self.seed = seed
    }
}

/// The motif and background. Pure drawing: no text.
struct GenerativeCanvas: View {
    let spec: ArtSpec
    var poster: Bool

    var body: some View {
        Canvas(rendersAsynchronously: false) { ctx, size in
            var r = SeededRandom(spec.seed + (poster ? "p" : "b"))
            let p = spec.palette
            let w = size.width, h = size.height
            let rect = CGRect(origin: .zero, size: size)
            ctx.fill(Path(rect), with: .linearGradient(Gradient(colors: [p.bg.0, p.bg.1]), startPoint: .zero, endPoint: CGPoint(x: w * 0.3, y: h)))
            // Ambient light.
            let ac = CGPoint(x: w * r.between(0.2, 0.8), y: h * r.between(0.15, 0.45))
            radial(&ctx, center: ac, radius: max(w, h) * 0.75, color: p.tones[0].opacity(0.55))

            switch spec.motif {
            case .prism: drawPrism(&ctx, size, &r, p)
            case .eclipse: drawEclipse(&ctx, size, &r, p)
            case .orbits: drawOrbits(&ctx, size, &r, p)
            case .bloom: drawBloom(&ctx, size, &r, p)
            case .horizon: drawHorizon(&ctx, size, &r, p)
            }

            // Vignette for depth.
            ctx.fill(Path(rect), with: .radialGradient(Gradient(colors: [.clear, .black.opacity(0.55)]),
                                                         center: CGPoint(x: w / 2, y: h * 0.45), startRadius: min(w, h) * 0.35, endRadius: max(w, h) * 0.85))
        }
    }

    private func radial(_ ctx: inout GraphicsContext, center: CGPoint, radius: CGFloat, color: Color) {
        let r = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        ctx.fill(Path(ellipseIn: r), with: .radialGradient(Gradient(colors: [color, color.opacity(0)]), center: center, startRadius: 0, endRadius: radius))
    }

    private func drawPrism(_ ctx: inout GraphicsContext, _ size: CGSize, _ r: inout SeededRandom, _ p: ArtPalette) {
        let w = size.width, h = size.height
        let side = min(w, h) * (poster ? r.between(0.5, 0.62) : r.between(0.42, 0.5))
        let cx = poster ? w * 0.5 : w * r.between(0.7, 0.76)
        let cy = poster ? h * 0.36 : h * 0.5
        let top = CGPoint(x: cx, y: cy - side * 0.55)
        let left = CGPoint(x: cx - side * 0.55, y: cy + side * 0.42)
        let right = CGPoint(x: cx + side * 0.55, y: cy + side * 0.42)
        // Incoming white beam.
        let entry = CGPoint(x: (top.x + left.x) / 2, y: (top.y + left.y) / 2 + side * 0.06)
        var beam = Path()
        beam.move(to: CGPoint(x: poster ? -10 : w * 0.56, y: entry.y + side * (poster ? 0.22 : 0.08)))
        beam.addLine(to: entry)
        ctx.stroke(beam, with: .color(.white.opacity(0.75)), style: StrokeStyle(lineWidth: max(2, side * 0.012), lineCap: .round))
        // Outgoing spectrum fan.
        let exit = CGPoint(x: (top.x + right.x) / 2 + side * 0.02, y: (top.y + right.y) / 2 + side * 0.04)
        let fanTop = exit.y - side * r.between(0.35, 0.6)
        let fanBottom = exit.y + side * r.between(0.75, 1.1)
        let bands = Theme.spectrum.count
        ctx.blendMode = .screen
        for (i, color) in Theme.spectrum.enumerated() {
            let y0 = fanTop + (fanBottom - fanTop) * CGFloat(i) / CGFloat(bands)
            let y1 = fanTop + (fanBottom - fanTop) * CGFloat(i + 1) / CGFloat(bands)
            var band = Path()
            band.move(to: exit)
            band.addLine(to: CGPoint(x: w + 10, y: y0))
            band.addLine(to: CGPoint(x: w + 10, y: y1))
            band.closeSubpath()
            ctx.fill(band, with: .linearGradient(Gradient(colors: [color.opacity(0.15), color.opacity(0.6)]), startPoint: exit, endPoint: CGPoint(x: w, y: (y0 + y1) / 2)))
        }
        radial(&ctx, center: exit, radius: side * 0.16, color: .white.opacity(0.85))
        ctx.blendMode = .normal
        // Glass body.
        var tri = Path()
        tri.move(to: top)
        tri.addLine(to: right)
        tri.addLine(to: left)
        tri.closeSubpath()
        ctx.fill(tri, with: .linearGradient(Gradient(colors: [p.tones[1].opacity(0.22), p.tones[0].opacity(0.06)]), startPoint: top, endPoint: CGPoint(x: cx, y: right.y)))
        ctx.stroke(tri, with: .linearGradient(Gradient(colors: [p.glow.opacity(0.95), p.tones[2].opacity(0.7)]), startPoint: top, endPoint: right),
                   style: StrokeStyle(lineWidth: max(2, side * 0.014), lineJoin: .round))
    }

    private func drawEclipse(_ ctx: inout GraphicsContext, _ size: CGSize, _ r: inout SeededRandom, _ p: ArtPalette) {
        let w = size.width, h = size.height
        let radius = min(w, h) * r.between(0.24, 0.32)
        let c = CGPoint(x: poster ? w * 0.5 : w * r.between(0.64, 0.78), y: poster ? h * 0.36 : h * 0.48)
        ctx.blendMode = .screen
        radial(&ctx, center: c, radius: radius * 2.6, color: p.tones[1].opacity(0.7))
        radial(&ctx, center: c, radius: radius * 1.45, color: p.glow.opacity(0.9))
        ctx.blendMode = .normal
        let off = CGPoint(x: c.x + radius * r.between(-0.08, 0.08), y: c.y + radius * r.between(-0.08, 0.08))
        ctx.fill(Path(ellipseIn: CGRect(x: off.x - radius, y: off.y - radius, width: radius * 2, height: radius * 2)), with: .color(p.bg.0))
        ctx.stroke(Path(ellipseIn: CGRect(x: c.x - radius * 1.02, y: c.y - radius * 1.02, width: radius * 2.04, height: radius * 2.04)),
                   with: .color(p.glow.opacity(0.5)), lineWidth: max(1.5, radius * 0.015))
    }

    private func drawOrbits(_ ctx: inout GraphicsContext, _ size: CGSize, _ r: inout SeededRandom, _ p: ArtPalette) {
        let w = size.width, h = size.height
        for _ in 0..<(50 + r.int(30)) {
            let s = r.between(0.6, 2.2) * min(w, h) / 300
            ctx.fill(Path(ellipseIn: CGRect(x: r.next() * w, y: r.next() * h * 0.85, width: s, height: s)), with: .color(.white.opacity(r.between(0.25, 0.85))))
        }
        let c = CGPoint(x: w * (poster ? r.between(0.35, 0.65) : r.between(0.64, 0.76)), y: h * (poster ? r.between(0.3, 0.4) : r.between(0.42, 0.55)))
        let tilt = Angle.degrees(r.between(-22, 22))
        for i in 0..<(4 + r.int(3)) {
            let rx = min(w, h) * (0.22 + Double(i) * r.between(0.1, 0.15))
            let ry = rx * r.between(0.26, 0.38)
            var ring = Path(ellipseIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2))
            ring = ring.applying(CGAffineTransform(rotationAngle: tilt.radians)).applying(CGAffineTransform(translationX: c.x, y: c.y))
            ctx.stroke(ring, with: .color((i % 2 == 0 ? p.glow : p.tones[2]).opacity(r.between(0.2, 0.55))), lineWidth: max(1.2, min(w, h) * 0.004))
        }
        let pr = min(w, h) * r.between(0.1, 0.14)
        radial(&ctx, center: c, radius: pr * 3, color: p.tones[0].opacity(0.6))
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - pr, y: c.y - pr, width: pr * 2, height: pr * 2)),
                 with: .radialGradient(Gradient(colors: [p.glow, p.tones[2], p.bg.0]), center: CGPoint(x: c.x - pr * 0.4, y: c.y - pr * 0.45), startRadius: 0, endRadius: pr * 1.7))
    }

    private func drawBloom(_ ctx: inout GraphicsContext, _ size: CGSize, _ r: inout SeededRandom, _ p: ArtPalette) {
        let w = size.width, h = size.height
        ctx.blendMode = .screen
        for i in 0..<(4 + r.int(3)) {
            let c = CGPoint(x: w * (poster ? r.between(0.05, 0.95) : r.between(0.45, 0.98)), y: h * (poster ? r.between(0.08, 0.6) : r.between(0.1, 0.9)))
            radial(&ctx, center: c, radius: min(w, h) * r.between(0.3, 0.55), color: p.tones[i % 3].opacity(r.between(0.5, 0.8)))
        }
        ctx.blendMode = .normal
        for _ in 0..<(2 + r.int(2)) {
            let c = CGPoint(x: w * (poster ? r.between(0.2, 0.8) : r.between(0.55, 0.85)), y: h * (poster ? r.between(0.15, 0.5) : r.between(0.2, 0.8)))
            let rad = min(w, h) * r.between(0.12, 0.3)
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - rad, y: c.y - rad, width: rad * 2, height: rad * 2)),
                       with: .color(p.glow.opacity(r.between(0.25, 0.55))), lineWidth: max(1.2, min(w, h) * 0.005))
        }
        for _ in 0..<(12 + r.int(14)) {
            let s = r.between(1.5, 5) * min(w, h) / 300
            let color = r.pick([p.glow] + p.tones)
            ctx.fill(Path(ellipseIn: CGRect(x: r.next() * w, y: r.next() * h * (poster ? 0.7 : 1), width: s, height: s)), with: .color(color.opacity(r.between(0.4, 0.9))))
        }
    }

    private func drawHorizon(_ ctx: inout GraphicsContext, _ size: CGSize, _ r: inout SeededRandom, _ p: ArtPalette) {
        let w = size.width, h = size.height
        let horizon = h * (poster ? r.between(0.5, 0.58) : r.between(0.6, 0.7))
        let sunR = min(w, h) * r.between(0.18, 0.26)
        let sun = CGPoint(x: poster ? w * 0.5 : w * r.between(0.64, 0.78), y: horizon - sunR * r.between(0.2, 0.6))
        ctx.blendMode = .screen
        radial(&ctx, center: sun, radius: sunR * 3, color: p.tones[1].opacity(0.7))
        ctx.blendMode = .normal
        var clipped = ctx
        clipped.clip(to: Path(CGRect(x: 0, y: 0, width: w, height: horizon)))
        clipped.fill(Path(ellipseIn: CGRect(x: sun.x - sunR, y: sun.y - sunR, width: sunR * 2, height: sunR * 2)),
                     with: .linearGradient(Gradient(colors: [p.glow, p.tones[1], p.tones[0]]), startPoint: CGPoint(x: sun.x, y: sun.y - sunR), endPoint: CGPoint(x: sun.x, y: sun.y + sunR)))
        // Mountains.
        for layer in 0..<2 {
            var m = Path()
            m.move(to: CGPoint(x: 0, y: h))
            var x: CGFloat = 0
            m.addLine(to: CGPoint(x: 0, y: horizon - CGFloat(r.between(0, 0.08)) * h))
            while x < w {
                x += w * r.between(0.08, 0.2)
                m.addLine(to: CGPoint(x: min(x, w), y: horizon - h * r.between(0.0, layer == 0 ? 0.12 : 0.06)))
            }
            m.addLine(to: CGPoint(x: w, y: h))
            m.closeSubpath()
            ctx.fill(m, with: .color(layer == 0 ? p.tones[2].opacity(0.35) : p.bg.0.opacity(0.95)))
        }
        ctx.fill(Path(CGRect(x: 0, y: horizon, width: w, height: h - horizon)), with: .color(p.bg.0.opacity(0.9)))
        // Reflection lines.
        for i in 0..<6 {
            let y = horizon + CGFloat(i + 1) * (h - horizon) / 9
            let half = sunR * (1.1 - Double(i) * 0.14)
            ctx.fill(Path(CGRect(x: sun.x - half, y: y, width: half * 2, height: max(1.5, h * 0.004))), with: .color(p.glow.opacity(0.35 - Double(i) * 0.05)))
        }
    }
}

/// A complete generative poster (2:3) or backdrop (16:9) with typography.
struct GenerativeArt: View {
    let seed: String
    let title: String
    var subtitle: String?
    var genres: [String] = []
    var poster: Bool = true
    var showsText: Bool = true

    var body: some View {
        let spec = ArtSpec(seed: seed, genres: genres)
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                GenerativeCanvas(spec: spec, poster: poster)
                if showsText && poster {
                    LinearGradient(colors: [.clear, spec.palette.bg.0.opacity(0.9)], startPoint: .center, endPoint: .bottom)
                    VStack(spacing: geo.size.width * 0.03) {
                        Text(title.uppercased())
                            .font(.system(size: geo.size.width * 0.15, weight: .heavy))
                            .tracking(geo.size.width * 0.002)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .minimumScaleFactor(0.45)
                            .foregroundStyle(spec.palette.ink)
                            .shadow(color: .black.opacity(0.4), radius: 8, y: 2)
                        if let subtitle, !subtitle.isEmpty {
                            Text(subtitle.uppercased())
                                .font(.system(size: geo.size.width * 0.045, weight: .bold))
                                .tracking(geo.size.width * 0.008)
                                .foregroundStyle(spec.palette.ink.opacity(0.75))
                                .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, geo.size.width * 0.08)
                    .padding(.bottom, geo.size.height * 0.07)
                }
            }
        }
    }
}

/// Remote artwork with the generative art as placeholder and fallback.
struct Artwork: View {
    let url: String?
    let seed: String
    let title: String
    var subtitle: String?
    var genres: [String] = []
    var poster: Bool = true
    var showsText: Bool = true

    var body: some View {
        let fallback = GenerativeArt(seed: seed, title: title, subtitle: subtitle, genres: genres, poster: poster, showsText: showsText)
        if let url, let u = URL(string: url), u.scheme?.hasPrefix("http") == true {
            AsyncImage(url: u, transaction: Transaction(animation: .easeOut(duration: 0.3))) { phase in
                switch phase {
                case .success(let image): image.resizable().aspectRatio(contentMode: .fill)
                default: fallback
                }
            }
        } else {
            fallback
        }
    }
}

extension Title {
    /// "2023 · Sciencefiction" for poster captions.
    var artCaption: String {
        [year.map(String.init), genres.first].compactMap { $0 }.joined(separator: " · ")
    }
}
