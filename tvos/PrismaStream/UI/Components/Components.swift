// Shared building blocks: logo, badges, poster/episode/channel cards, shelves, chips and states.

import SwiftUI

enum Route: Hashable {
    case title(String)
    case person(String)
    case genre(String, TitleKind?)
}

// MARK: - Logo

/// The PrismaStream mark: a glass prism splitting a beam into the spectrum (Logo.svelte, 40×40).
struct LogoMark: View {
    var size: CGFloat = 48

    var body: some View {
        Canvas { ctx, s in
            let k = s.width / 40
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: y * k) }
            var beam = Path()
            beam.move(to: pt(2, 21.5))
            beam.addLine(to: pt(15, 19.6))
            ctx.stroke(beam, with: .color(.white.opacity(0.9)), style: StrokeStyle(lineWidth: 1.6 * k, lineCap: .round))
            var fan = Path()
            fan.move(to: pt(25, 18.5))
            fan.addLine(to: pt(39, 11))
            fan.addLine(to: pt(39, 29))
            fan.closeSubpath()
            ctx.fill(fan, with: .linearGradient(Gradient(colors: ["#ff6b8b", "#ffd36b", "#6dffb8", "#5cc8ff", "#a77bff"].map(Color.init(hex:))),
                                                startPoint: pt(39, 11), endPoint: pt(39, 29)))
            var prism = Path()
            prism.move(to: pt(20, 6))
            prism.addLine(to: pt(30.5, 27))
            prism.addLine(to: pt(9.5, 27))
            prism.closeSubpath()
            ctx.stroke(prism, with: .linearGradient(Gradient(colors: [.white.opacity(0.95), .white.opacity(0.55)]), startPoint: pt(0, 0), endPoint: pt(40, 40)),
                       style: StrokeStyle(lineWidth: 2.2 * k, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct Wordmark: View {
    var size: CGFloat = 34
    var body: some View {
        HStack(spacing: size * 0.35) {
            LogoMark(size: size * 1.4)
            (Text("Prisma").font(.system(size: size, weight: .heavy)) + Text("Stream").font(.system(size: size, weight: .regular)).foregroundColor(Theme.text2))
                .tracking(-0.5)
        }
    }
}

// MARK: - Badges

struct LangBadge: View {
    let text: String
    var body: some View {
        if !text.isEmpty {
            let parts = text.split(separator: "+", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            HStack(spacing: 6) {
                Text(parts.first ?? "")
                if parts.count > 1 { Text("+\(parts[1])").foregroundStyle(Color(hex: "#b9a8ff")) }
            }
            .font(.system(size: 18, weight: .heavy))
            .tracking(1)
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 1))
        }
    }
}

struct QualityBadge: View {
    let quality: Quality?
    var body: some View {
        if let q = quality, !Format.qualityShort(q).isEmpty {
            Text(Format.qualityShort(q))
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(q == .uhd ? AnyShapeStyle(LinearGradient(colors: Theme.spectrum, startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(Color.white.opacity(0.3)), lineWidth: 1.5)
                )
        }
    }
}

struct ProgressLine: View {
    let fraction: Double
    var height: CGFloat = 6
    @Environment(\.accent) private var accent
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.18))
                Capsule().fill(accent).frame(width: max(height, geo.size.width * min(1, max(0, fraction))))
            }
        }
        .frame(height: height)
    }
}

// MARK: - Poster card

struct PosterCard: View {
    let title: Title
    var width: CGFloat = 250
    var progress: Double?
    var subtitle: String?

    @Environment(AppModel.self) private var app
    @FocusState private var focused: Bool

    var body: some View {
        let display = app.catalog.displayTitle(title)
        VStack(alignment: .leading, spacing: 14) {
            NavigationLink(value: Route.title(title.id)) {
                ZStack {
                    Artwork(url: title.posterUrl, seed: title.id, title: display, subtitle: title.artCaption, genres: title.genres)
                    VStack {
                        HStack(alignment: .top) {
                            LangBadge(text: Lang.badge(title.languages, preferred: app.profile.audioLangs))
                            Spacer(minLength: 4)
                            QualityBadge(quality: title.bestQuality)
                        }
                        Spacer()
                        if let progress {
                            ProgressLine(fraction: progress, height: 6)
                        }
                    }
                    .padding(12)
                }
                .frame(width: width, height: width * 1.5)
                .clipped()
            }
            .buttonStyle(.card)
            .focused($focused)
            .accessibilityIdentifier("card.\(title.id)")
            .accessibilityLabel(display)

            VStack(alignment: .leading, spacing: 2) {
                Text(display)
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(focused ? Theme.text : Theme.text2)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle).font(.system(size: 20)).foregroundStyle(Theme.text3).lineLimit(1)
                }
            }
            .frame(width: width, alignment: .leading)
            .offset(y: focused ? 14 : 0)
            .animation(.easeOut(duration: 0.2), value: focused)
        }
    }
}

// MARK: - Shelf

struct Shelf<Item: Identifiable, Content: View>: View {
    let title: LocalizedStringKey
    var eyebrow: LocalizedStringKey?
    let items: [Item]
    var spacing: CGFloat = 40
    @ViewBuilder let content: (Item) -> Content

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 22) {
                SectionHeader(title: title, eyebrow: eyebrow)
                    .padding(.horizontal, Theme.gutter)
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: spacing) {
                        ForEach(items) { content($0) }
                    }
                    .padding(.horizontal, Theme.gutter)
                    .padding(.vertical, 24)
                }
                .scrollClipDisabled()
                .scrollIndicators(.hidden)
            }
            .focusSection()
        }
    }
}

// MARK: - Chips

/// Capsule chip used in the versions panel, filters and pickers.
struct ChipStyle: ButtonStyle {
    var selected: Bool
    @Environment(\.accent) private var accent
    @Environment(\.isFocused) private var isFocused

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 25, weight: .semibold))
            .padding(.horizontal, 26)
            .padding(.vertical, 13)
            .foregroundStyle(isFocused ? Color.black : (selected ? Color.white : Theme.text2))
            .background(
                Capsule().fill(isFocused ? Color.white : (selected ? accent.opacity(0.35) : Color.white.opacity(0.07)))
            )
            .overlay(Capsule().strokeBorder(selected && !isFocused ? accent : Color.white.opacity(isFocused ? 0 : 0.1), lineWidth: 2))
            .scaleEffect(isFocused ? 1.08 : (configuration.isPressed ? 0.97 : 1))
            .shadow(color: .black.opacity(isFocused ? 0.45 : 0), radius: 16, y: 8)
            .animation(.easeOut(duration: 0.18), value: isFocused)
    }
}

struct Chip: View {
    let label: String
    var detail: String?
    var selected: Bool = false
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if selected { Image(systemName: "checkmark").font(.system(size: 20, weight: .bold)) }
                else if let systemImage { Image(systemName: systemImage).font(.system(size: 20, weight: .semibold)) }
                Text(label)
                if let detail { Text(detail).font(.system(size: 19, weight: .bold)).opacity(0.6) }
            }
        }
        .buttonStyle(ChipStyle(selected: selected))
    }
}

/// Big pill action button (hero, detail).
struct PillStyle: ButtonStyle {
    var prominent: Bool = false
    @Environment(\.accent) private var accent
    @Environment(\.isFocused) private var isFocused

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 29, weight: .bold))
            .padding(.horizontal, 40)
            .padding(.vertical, 20)
            .foregroundStyle(isFocused ? Color.black : (prominent ? Color.white : Theme.text))
            .background(Capsule().fill(isFocused ? Color.white : (prominent ? accent : Color.white.opacity(0.12))))
            .overlay(Capsule().strokeBorder(.white.opacity(isFocused || prominent ? 0 : 0.14), lineWidth: 1.5))
            .scaleEffect(isFocused ? 1.08 : (configuration.isPressed ? 0.96 : 1))
            .shadow(color: (isFocused ? Color.black : accent).opacity(isFocused ? 0.5 : (prominent ? 0.35 : 0)), radius: 24, y: 12)
            .animation(.easeOut(duration: 0.18), value: isFocused)
    }
}

struct RoundIconStyle: ButtonStyle {
    @Environment(\.isFocused) private var isFocused
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 30, weight: .bold))
            .frame(width: 78, height: 78)
            .foregroundStyle(isFocused ? Color.black : Theme.text)
            .background(Circle().fill(isFocused ? Color.white : Color.white.opacity(0.12)))
            .overlay(Circle().strokeBorder(.white.opacity(isFocused ? 0 : 0.14), lineWidth: 1.5))
            .scaleEffect(isFocused ? 1.1 : 1)
            .shadow(color: .black.opacity(isFocused ? 0.5 : 0), radius: 20, y: 10)
            .animation(.easeOut(duration: 0.18), value: isFocused)
    }
}

/// Lift + glow for flat tiles (EPG blocks, channel rows, list rows).
struct TileStyle: ButtonStyle {
    var cornerRadius: CGFloat = 18
    var selected: Bool = false
    var scale: CGFloat = 1.04
    @Environment(\.accent) private var accent
    @Environment(\.isFocused) private var isFocused

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(isFocused ? Color.white.opacity(0.95) : (selected ? accent.opacity(0.22) : Color.white.opacity(0.05)))
            )
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(selected && !isFocused ? accent.opacity(0.8) : .white.opacity(isFocused ? 0 : 0.06), lineWidth: 1.5))
            .environment(\.colorScheme, isFocused ? .light : .dark)
            .foregroundStyle(isFocused ? Color.black : Theme.text)
            .scaleEffect(isFocused ? scale : (configuration.isPressed ? 0.98 : 1))
            .shadow(color: .black.opacity(isFocused ? 0.5 : 0), radius: 22, y: 12)
            .animation(.easeOut(duration: 0.16), value: isFocused)
    }
}

// MARK: - Avatars

enum AvatarPalette {
    static let presets: [(id: String, colors: [Color])] = [
        ("aurora", ["#3ddc97", "#6bc8ff", "#8f7bff"].map(Color.init(hex:))),
        ("ember", ["#ff6b3d", "#ff3b5c", "#ffb547"].map(Color.init(hex:))),
        ("tide", ["#20c9b0", "#3d8bff", "#1b3a8a"].map(Color.init(hex:))),
        ("moss", ["#9bc53d", "#3f8f5a", "#1f3d2b"].map(Color.init(hex:))),
        ("nova", ["#ffe58a", "#ff9bc0", "#8f5cff"].map(Color.init(hex:))),
        ("dusk", ["#ff8fa3", "#7c5cff", "#2a1f5c"].map(Color.init(hex:))),
        ("koi", ["#ff7a45", "#ffffff", "#ff3b3b"].map(Color.init(hex:))),
        ("pixel", ["#4fd1c5", "#e57bff", "#ffd36b"].map(Color.init(hex:)))
    ]

    static func colors(_ id: String) -> [Color] {
        presets.first { $0.id == id }?.colors ?? presets[0].colors
    }
}

struct AvatarView: View {
    let name: String
    let preset: String
    var size: CGFloat = 80

    var body: some View {
        ZStack {
            Circle().fill(AngularGradient(colors: AvatarPalette.colors(preset) + [AvatarPalette.colors(preset)[0]], center: .center))
            Circle().fill(RadialGradient(colors: [.white.opacity(0.35), .clear], center: .topLeading, startRadius: 0, endRadius: size))
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.42, weight: .heavy))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.35), radius: 4)
        }
        .frame(width: size, height: size)
    }
}

/// Person circle with initials on a seeded gradient.
struct PersonBubble: View {
    let person: Person
    var size: CGFloat = 170

    var body: some View {
        let spec = ArtSpec(seed: person.name, genres: [])
        let initials = person.name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        ZStack {
            if let url = person.profileUrl, let u = URL(string: url) {
                AsyncImage(url: u) { img in img.resizable().scaledToFill() } placeholder: { Color.clear }
            }
            Circle().fill(LinearGradient(colors: [spec.palette.tones[0], spec.palette.tones[2], spec.palette.tones[1]], startPoint: .topLeading, endPoint: .bottomTrailing))
                .opacity(person.profileUrl == nil ? 1 : 0)
            Text(initials.uppercased())
                .font(.system(size: size * 0.26, weight: .heavy))
                .foregroundStyle(.white)
                .opacity(person.profileUrl == nil ? 1 : 0)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

// MARK: - Channel tile

struct ChannelLogo: View {
    let channel: Channel
    var size: CGFloat = 84

    var body: some View {
        let spec = ArtSpec(seed: channel.id, genres: [channel.group])
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(LinearGradient(colors: [spec.palette.tones[0].opacity(0.85), spec.palette.bg.1], startPoint: .topLeading, endPoint: .bottomTrailing))
            if let url = channel.logoUrl, let u = URL(string: url) {
                AsyncImage(url: u) { img in
                    img.resizable().scaledToFit().padding(size * 0.14)
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: size * 1.35, height: size)
    }

    private var initials: some View {
        Text(channel.initials)
            .font(.system(size: size * 0.36, weight: .heavy))
            .foregroundStyle(.white)
    }
}

// MARK: - States

struct LoadingState: View {
    let message: String
    @State private var spin = false
    var body: some View {
        VStack(spacing: 30) {
            LogoMark(size: 120)
                .scaleEffect(spin ? 1.06 : 0.94)
                .opacity(spin ? 1 : 0.7)
                .animation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: spin)
            Text(message).font(Theme.callout).foregroundStyle(Theme.text2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { spin = true }
    }
}

struct ErrorState: View {
    let title: LocalizedStringKey
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 28) {
            ZStack {
                Circle().fill(Theme.live.opacity(0.14)).frame(width: 150, height: 150)
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 62)).foregroundStyle(Theme.live)
            }
            Text(title).font(Theme.title2).foregroundStyle(Theme.text)
            Text(message)
                .font(Theme.body)
                .foregroundStyle(Theme.text2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 1100)
            if let retry {
                Button(action: retry) { Label("Opnieuw proberen", systemImage: "arrow.clockwise") }
                    .buttonStyle(PillStyle(prominent: true))
                    .padding(.top, 10)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Theme.gutter)
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: systemImage).font(.system(size: 76, weight: .light)).foregroundStyle(Theme.text3)
            Text(title).font(Theme.title2).foregroundStyle(Theme.text)
            Text(message).font(Theme.body).foregroundStyle(Theme.text2).multilineTextAlignment(.center).frame(maxWidth: 1000)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 120)
    }
}

/// Soft prisma backdrop for screens without artwork.
struct AmbientBackground: View {
    @Environment(\.accent) private var accent
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [accent.opacity(0.22), .clear], center: UnitPoint(x: 0.85, y: -0.1), startRadius: 0, endRadius: 1100)
            RadialGradient(colors: [Color(hex: "#4fd1c5").opacity(0.08), .clear], center: UnitPoint(x: 0.0, y: 1.1), startRadius: 0, endRadius: 900)
        }
        .ignoresSafeArea()
    }
}
