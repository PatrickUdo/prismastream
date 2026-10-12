// Home: a full-bleed hero with the featured title and horizontal shelves underneath.

import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let catalog = app.catalog
        let user = app.user
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 56) {
                if let hero = catalog.featured(limit: 1).first {
                    HeroView(title: hero)
                } else {
                    EmptyStateView(systemImage: "sparkles.tv", title: "Nog geen inhoud",
                                   message: "Voeg een bron toe in Instellingen, of zet de demobibliotheek aan.")
                        .padding(.top, 200)
                }

                let continuing = user.continueWatching().compactMap { p in catalog.title(p.titleId).map { ContinueItem(progress: p, title: $0) } }
                Shelf(title: "Verder kijken", items: continuing) { item in
                    ContinueCard(item: item)
                }

                let favorites = user.data.favorites.compactMap(catalog.title)
                Shelf(title: "Mijn lijst", items: favorites) { PosterCard(title: $0) }

                Shelf(title: "Aanbevolen voor jou", eyebrow: "Op basis van wat je kijkt", items: catalog.recommended()) { PosterCard(title: $0) }
                Shelf(title: "Nieuw toegevoegd", items: catalog.recent()) { PosterCard(title: $0) }
                Shelf(title: "Populaire films", items: catalog.popular(.movie)) { PosterCard(title: $0) }
                Shelf(title: "Trending series", items: catalog.trending(.series)) { PosterCard(title: $0) }

                let favChannels = Set(user.data.favoriteChannels)
                let channels = catalog.channels.sorted { favChannels.contains($0.id) && !favChannels.contains($1.id) }.prefix(24)
                Shelf(title: "Nu live", items: Array(channels)) { ChannelCard(channel: $0) }

                let genres = catalog.genres().prefix(14).map { GenreItem(name: $0.name, count: $0.count) }
                Shelf(title: "Genres", items: Array(genres), spacing: 32) { GenreTile(item: $0) }
            }
            .padding(.bottom, 80)
        }
        .scrollClipDisabled()
        .background(Theme.bg)
        .ignoresSafeArea(edges: [.top, .horizontal])
    }
}

// MARK: - Hero

struct HeroView: View {
    let title: Title
    @Environment(AppModel.self) private var app
    @Environment(\.accent) private var accent

    var body: some View {
        let display = app.catalog.displayTitle(title)
        ZStack(alignment: .bottomLeading) {
            Artwork(url: title.backdropUrl, seed: title.id, title: display, genres: title.genres, poster: false, showsText: false)
                .frame(width: 1920, height: 1000)
                .clipped()
                .overlay(
                    LinearGradient(stops: [.init(color: Theme.bg.opacity(0.92), location: 0), .init(color: Theme.bg.opacity(0.55), location: 0.45), .init(color: .clear, location: 0.8)],
                                   startPoint: .leading, endPoint: .trailing)
                )
                .overlay(
                    LinearGradient(stops: [.init(color: .clear, location: 0.45), .init(color: Theme.bg, location: 1)], startPoint: .top, endPoint: .bottom)
                )

            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 10) {
                    Image(systemName: "sparkle")
                    Text(title.isSeries ? "Uitgelichte serie" : "Uitgelichte film")
                        .tracking(3)
                        .textCase(.uppercase)
                }
                .font(Theme.eyebrow)
                .foregroundStyle(accent)

                Text(display)
                    .font(Theme.display)
                    .tracking(-1.5)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .shadow(color: .black.opacity(0.4), radius: 20)

                MetaRow(title: title)

                HStack(spacing: 12) {
                    Image(systemName: "globe")
                    Text(app.catalog.languageSummary(title))
                }
                .font(Theme.callout)
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 22)
                .padding(.vertical, 11)
                .background(.white.opacity(0.08), in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(0.12)))

                if let overview = title.overview {
                    Text(overview)
                        .font(Theme.body)
                        .foregroundStyle(Theme.text2)
                        .lineLimit(3)
                        .frame(maxWidth: 1040, alignment: .leading)
                }

                HeroButtons(title: title)
                    .padding(.top, 14)
            }
            .padding(.leading, Theme.gutter + 40)
            .padding(.bottom, 70)
            .frame(maxWidth: 1300, alignment: .leading)
        }
        .frame(width: 1920, height: 1000, alignment: .bottomLeading)
        .focusSection()
    }
}

struct HeroButtons: View {
    let title: Title
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 28) {
            Button {
                Task { await PlayAction.start(title, app: app) }
            } label: {
                Label("Nu kijken", systemImage: "play.fill")
            }
            .buttonStyle(PillStyle(prominent: true))
            .accessibilityIdentifier("hero.play")

            NavigationLink(value: Route.title(title.id)) {
                Label("Meer info", systemImage: "info.circle")
            }
            .buttonStyle(PillStyle())
            .accessibilityIdentifier("hero.info")

            Button {
                app.user.toggleFavorite(title.id)
            } label: {
                Image(systemName: app.user.isFavorite(title.id) ? "checkmark" : "plus")
            }
            .buttonStyle(RoundIconStyle())
            .accessibilityLabel(app.user.isFavorite(title.id) ? Text("Uit Mijn lijst") : Text("Aan Mijn lijst toevoegen"))
            .accessibilityIdentifier("hero.list")
        }
    }
}

enum PlayAction {
    /// Movie: play the best version. Series: continue or start with the first episode.
    @MainActor
    static func start(_ title: Title, app: AppModel) async {
        if title.kind == .series {
            let loaded = await app.catalog.loadSeasons(for: title.id, sources: app.sources, profile: app.profile) ?? title
            let episodes = loaded.allEpisodes
            if let p = app.user.latestProgress(forTitle: title.id), let ep = episodes.first(where: { $0.id == p.episodeId }) {
                await app.play(loaded, episode: ep)
            } else if let first = episodes.first {
                await app.play(loaded, episode: first)
            } else {
                app.toast = String(localized: "Geen afleveringen gevonden.")
            }
        } else {
            await app.play(title)
        }
    }
}

struct MetaRow: View {
    let title: Title
    var body: some View {
        HStack(spacing: 16) {
            let parts: [String] = [
                title.year.map(String.init),
                title.isSeries ? title.seasons.map { String(localized: "\($0.count) seizoenen") } : Format.runtime(title.runtimeMin),
            ].compactMap { $0 } + title.genres.prefix(2)
            ForEach(Array(parts.enumerated()), id: \.offset) { i, part in
                if i > 0 { Text("·").foregroundStyle(Theme.text3) }
                Text(part)
            }
            if let rating = title.rating, rating > 0 {
                Text("·").foregroundStyle(Theme.text3)
                Label(String(format: "%.1f", rating), systemImage: "star.fill")
                    .foregroundStyle(Theme.rating)
            }
            if let cert = title.certification, !cert.isEmpty {
                Text(cert)
                    .font(.system(size: 19, weight: .heavy))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.4), lineWidth: 1.5))
            }
            QualityBadge(quality: title.bestQuality)
        }
        .font(Theme.callout)
        .foregroundStyle(Theme.text2)
        .lineLimit(1)
    }
}

// MARK: - Continue watching

struct ContinueItem: Identifiable {
    let progress: WatchProgress
    let title: Title
    var id: String { WatchProgress.key(progress.titleId, progress.episodeId) }
}

struct ContinueCard: View {
    let item: ContinueItem
    @Environment(AppModel.self) private var app
    @FocusState private var focused: Bool

    var body: some View {
        let display = app.catalog.displayTitle(item.title)
        VStack(alignment: .leading, spacing: 14) {
            Button {
                Task { await app.continueWatching(item.progress) }
            } label: {
                ZStack(alignment: .bottomLeading) {
                    Artwork(url: item.title.backdropUrl, seed: item.title.id, title: display, genres: item.title.genres, poster: false, showsText: false)
                    LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(display).font(.system(size: 28, weight: .heavy)).foregroundStyle(.white).lineLimit(1)
                        ProgressLine(fraction: item.progress.fraction)
                    }
                    .padding(20)
                    Image(systemName: "play.fill")
                        .font(.system(size: 34))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .opacity(focused ? 1 : 0)
                }
                .frame(width: 440, height: 248)
                .clipped()
            }
            .buttonStyle(.card)
            .focused($focused)

            Text(subtitle)
                .font(.system(size: 21))
                .foregroundStyle(focused ? Theme.text2 : Theme.text3)
                .frame(width: 440, alignment: .leading)
                .lineLimit(1)
        }
    }

    private var subtitle: String {
        let left = max(0, item.progress.durationSec - item.progress.positionSec)
        let remaining = String(localized: "nog \(Int((left / 60).rounded())) min")
        if let eid = item.progress.episodeId, let ep = item.title.allEpisodes.first(where: { $0.id == eid }) {
            return "S\(ep.season) A\(ep.episode) · \(remaining)"
        }
        if let eid = item.progress.episodeId, let range = eid.range(of: "/s") {
            return String(eid[range.upperBound...]).uppercased() + " · " + remaining
        }
        return remaining
    }
}

// MARK: - Channel card

struct ChannelCard: View {
    let channel: Channel
    @Environment(AppModel.self) private var app
    @FocusState private var focused: Bool

    var body: some View {
        let nn = app.catalog.nowNext(channel)
        VStack(alignment: .leading, spacing: 14) {
            Button {
                app.playChannel(channel)
            } label: {
                ZStack(alignment: .topLeading) {
                    let spec = ArtSpec(seed: channel.id, genres: [channel.group])
                    LinearGradient(colors: [spec.palette.tones[0].opacity(0.6), spec.palette.bg.1], startPoint: .topLeading, endPoint: .bottomTrailing)
                    ChannelLogo(channel: channel, size: 74)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    LiveDot().padding(14)
                    VStack {
                        Spacer()
                        if let now = nn.now { ProgressLine(fraction: now.progress(at: Date()), height: 5) }
                    }
                    .padding(16)
                }
                .frame(width: 380, height: 214)
                .clipped()
            }
            .buttonStyle(.card)
            .focused($focused)

            VStack(alignment: .leading, spacing: 3) {
                Text(channel.name).font(.system(size: 23, weight: .semibold)).foregroundStyle(focused ? Theme.text : Theme.text2)
                Text(nn.now?.title ?? String(localized: "Geen gids"))
                    .font(.system(size: 20)).foregroundStyle(Theme.text3)
            }
            .lineLimit(1)
            .frame(width: 380, alignment: .leading)
        }
    }
}

struct LiveDot: View {
    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(Theme.live).frame(width: 11, height: 11)
            Text("LIVE").font(.system(size: 17, weight: .heavy)).tracking(1.5)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Genres

struct GenreItem: Identifiable {
    let name: String
    let count: Int
    var id: String { name }
}

struct GenreTile: View {
    let item: GenreItem
    var kind: TitleKind?

    var body: some View {
        NavigationLink(value: Route.genre(item.name, kind)) {
            ZStack(alignment: .bottomLeading) {
                GenerativeCanvas(spec: ArtSpec(seed: "genre-" + item.name, genres: [item.name]), poster: false)
                LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name).font(.system(size: 30, weight: .heavy)).foregroundStyle(.white)
                    Text("\(item.count) titels").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                }
                .padding(22)
            }
            .frame(width: 340, height: 190)
            .clipped()
        }
        .buttonStyle(.card)
    }
}
