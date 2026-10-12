// Title detail: backdrop, poster, titles and metadata, the versions panel, seasons and episodes
// (lazy for Xtream), cast and similar titles.

import SwiftUI

struct TitleDetailView: View {
    let titleId: String
    @Environment(AppModel.self) private var app

    @State private var selection = VersionSelection()
    @State private var groups: [LanguageGroup] = []
    @State private var season: Int?
    @State private var prepared = false

    var body: some View {
        Group {
            if let title = app.catalog.title(titleId) {
                content(title)
            } else {
                ErrorState(title: "Titel niet gevonden", message: String(localized: "Deze titel staat niet (meer) in je catalogus."))
            }
        }
        .background(Theme.bg)
        .task(id: titleId) { await prepare() }
    }

    private func versionVariants(_ title: Title) -> [StreamVariant] {
        guard title.isSeries else { return title.variants }
        // One representative per source/language/quality across all episodes.
        var seen = Set<String>()
        return title.allEpisodes.flatMap(\.variants).filter { seen.insert("\($0.sourceId)|\($0.primaryLang)|\($0.quality.rawValue)|\($0.subtitleLangs.joined())").inserted }
    }

    private func prepare() async {
        var title = app.catalog.title(titleId)
        if title?.isSeries == true, title?.seasons == nil {
            title = await app.catalog.loadSeasons(for: titleId, sources: app.sources, profile: app.profile)
        }
        guard let title else { return }
        let variants = versionVariants(title)
        groups = (try? await app.engine.groupVariantsByLanguage(variants, audioLangs: app.profile.audioLangs)) ?? []
        if groups.isEmpty {
            groups = Dictionary(grouping: variants, by: \.primaryLang).map { LanguageGroup(lang: $0.key, variants: $0.value) }.sorted { $0.lang < $1.lang }
        }
        if !prepared, let best = try? await app.engine.pickVariant(variants, prefs: app.profile.langPrefs, title: title) ?? variants.first {
            selection = VersionSelection(variant: best, prefs: app.profile.langPrefs)
        }
        if season == nil {
            let p = app.user.latestProgress(forTitle: titleId)
            season = p.flatMap { pr in title.allEpisodes.first { $0.id == pr.episodeId }?.season } ?? title.seasons?.first?.number
        }
        prepared = true
    }

    @ViewBuilder
    private func content(_ title: Title) -> some View {
        let display = app.catalog.displayTitle(title)
        let variants = versionVariants(title)
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 64) {
                header(title, display: display, variants: variants)

                HStack(alignment: .top, spacing: 56) {
                    if !variants.isEmpty {
                        VersionsPanel(variants: variants, groups: groups, selection: $selection, isSeries: title.isSeries)
                            .frame(width: 1120)
                    } else if title.isSeries && app.catalog.isLoadingSeasons(title.id) {
                        ProgressView("Afleveringen laden…").frame(width: 1120, height: 300)
                    }
                    InfoColumn(title: title)
                }
                .padding(.horizontal, Theme.gutter)

                if title.isSeries { episodes(title) }

                if !title.cast.isEmpty {
                    Shelf(title: "Cast", items: title.cast) { person in
                        NavigationLink(value: Route.person(person.name)) {
                            VStack(spacing: 14) {
                                PersonBubble(person: person)
                                VStack(spacing: 2) {
                                    Text(person.name).font(.system(size: 22, weight: .semibold)).foregroundStyle(Theme.text)
                                    if let c = person.character { Text(c).font(.system(size: 19)).foregroundStyle(Theme.text3) }
                                }
                                .lineLimit(1)
                                .frame(width: 200)
                            }
                            .padding(10)
                        }
                        .buttonStyle(.borderless)
                    }
                }

                Shelf(title: "Vergelijkbare titels", items: app.catalog.similar(to: title)) { PosterCard(title: $0) }
            }
            .padding(.bottom, 90)
        }
        .scrollClipDisabled()
        .ignoresSafeArea(edges: [.top, .horizontal])
        .accessibilityIdentifier("detail.root")
    }

    // MARK: Header

    private func header(_ title: Title, display: String, variants: [StreamVariant]) -> some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(url: title.backdropUrl, seed: title.id, title: display, genres: title.genres, poster: false, showsText: false)
                .frame(width: 1920, height: 960)
                .clipped()
                .overlay(LinearGradient(stops: [.init(color: Theme.bg.opacity(0.95), location: 0), .init(color: Theme.bg.opacity(0.6), location: 0.5), .init(color: Theme.bg.opacity(0.2), location: 1)], startPoint: .leading, endPoint: .trailing))
                .overlay(LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: Theme.bg, location: 1)], startPoint: .top, endPoint: .bottom))

            HStack(alignment: .bottom, spacing: 70) {
                VStack(alignment: .leading, spacing: 20) {
                    Eyebrow(title.isSeries ? "Serie" : "Film")
                    Text(display)
                        .font(Theme.display)
                        .tracking(-1.5)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                    if let original = title.originalTitle ?? (display != title.title ? title.title : nil), original != display {
                        Text("Originele titel: \(original)").font(Theme.callout).foregroundStyle(Theme.text3)
                    }
                    MetaRow(title: title)
                    HStack(spacing: 12) {
                        Image(systemName: "globe")
                        Text(app.catalog.languageSummary(title))
                    }
                    .font(Theme.callout)
                    .foregroundStyle(Theme.text2)
                    if let overview = title.overview {
                        Text(overview)
                            .font(Theme.body)
                            .foregroundStyle(Theme.text2)
                            .lineLimit(4)
                            .frame(maxWidth: 1080, alignment: .leading)
                    }
                    actions(title, variants: variants)
                        .padding(.top, 16)
                }
                .frame(maxWidth: 1200, alignment: .leading)

                Spacer(minLength: 0)

                Artwork(url: title.posterUrl, seed: title.id, title: display, subtitle: title.artCaption, genres: title.genres)
                    .frame(width: 340, height: 510)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.1)))
                    .shadow(color: .black.opacity(0.6), radius: 40, y: 20)
            }
            .padding(.horizontal, Theme.gutter + 40)
            .padding(.bottom, 20)
        }
        .frame(width: 1920, height: 960, alignment: .bottomLeading)
    }

    private func actions(_ title: Title, variants: [StreamVariant]) -> some View {
        let resolved = selection.resolve(in: variants)
        let progress = title.isSeries ? app.user.latestProgress(forTitle: title.id) : app.user.progress(title.id)
        let resuming = progress?.isResumable == true
        return HStack(spacing: 28) {
            Button {
                Task { await playMain(title) }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "play.fill")
                    VStack(alignment: .leading, spacing: 0) {
                        Text(resuming ? "Verder kijken" : "Afspelen")
                        if let resolved {
                            Text("\(Lang.name(selection.audio)) · \(Format.qualityShort(resolved.quality).isEmpty ? Format.qualityName(resolved.quality) : Format.qualityShort(resolved.quality))")
                                .font(.system(size: 20, weight: .semibold))
                                .opacity(0.7)
                        }
                    }
                }
            }
            .buttonStyle(PillStyle(prominent: true))
            .disabled(variants.isEmpty && !title.isSeries)
            .accessibilityIdentifier("detail.play")

            Button {
                app.user.toggleFavorite(title.id)
            } label: {
                Label(app.user.isFavorite(title.id) ? "In Mijn lijst" : "Mijn lijst", systemImage: app.user.isFavorite(title.id) ? "checkmark" : "plus")
            }
            .buttonStyle(PillStyle())
            .accessibilityIdentifier("detail.list")

            if let trailer = title.trailerUrl, URL(string: trailer) != nil {
                Button {
                    let v = StreamVariant(id: "trailer:\(title.id)", sourceId: "trailer", url: trailer, audioLangs: [title.originalLang ?? "und"], label: "Trailer")
                    app.playback = PlaybackSession(title: title, episode: nil, variant: v, startAt: 0, upcoming: [], prefs: app.profile.langPrefs)
                } label: {
                    Label("Trailer", systemImage: "film.stack")
                }
                .buttonStyle(PillStyle())
            }
        }
    }

    private func playMain(_ title: Title) async {
        if title.isSeries {
            let episodes = title.allEpisodes
            let p = app.user.latestProgress(forTitle: title.id)
            guard let ep = episodes.first(where: { $0.id == p?.episodeId }) ?? episodes.first else {
                app.toast = String(localized: "Geen afleveringen gevonden.")
                return
            }
            await playEpisode(title, ep)
        } else {
            await app.play(title, variant: selection.resolve(in: title.variants), prefs: selection.prefs(base: app.profile.langPrefs))
        }
    }

    private func playEpisode(_ title: Title, _ ep: Episode) async {
        let prefs = selection.prefs(base: app.profile.langPrefs)
        let match = selection.candidates(in: ep.variants).first { $0.audioLangs.contains(selection.audio) }
        await app.play(title, episode: ep, variant: match, prefs: prefs)
    }

    // MARK: Episodes

    @ViewBuilder
    private func episodes(_ title: Title) -> some View {
        let seasons = title.seasons ?? []
        VStack(alignment: .leading, spacing: 26) {
            HStack(alignment: .center, spacing: 30) {
                Text("Afleveringen").font(Theme.headline.weight(.bold))
                if seasons.count > 1 {
                    ScrollView(.horizontal) {
                        HStack(spacing: 16) {
                            ForEach(seasons) { s in
                                Chip(label: String(localized: "Seizoen \(s.number)"), selected: season == s.number) { season = s.number }
                            }
                        }
                        .padding(.vertical, 14)
                        .padding(.horizontal, 10)
                    }
                    .scrollClipDisabled()
                }
            }
            .padding(.horizontal, Theme.gutter)
            .focusSection()

            if seasons.isEmpty {
                if app.catalog.isLoadingSeasons(title.id) {
                    ProgressView().padding(.horizontal, Theme.gutter)
                } else {
                    Text("Geen afleveringen gevonden.").font(Theme.body).foregroundStyle(Theme.text3).padding(.horizontal, Theme.gutter)
                }
            } else {
                let current = seasons.first { $0.number == season } ?? seasons[0]
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 40) {
                        ForEach(current.episodes) { ep in
                            EpisodeCard(title: title, episode: ep, progress: app.user.progress(title.id, ep.id)) {
                                Task { await playEpisode(title, ep) }
                            }
                        }
                    }
                    .padding(.horizontal, Theme.gutter)
                    .padding(.vertical, 24)
                }
                .scrollClipDisabled()
                .focusSection()
            }
        }
    }
}

struct EpisodeCard: View {
    let title: Title
    let episode: Episode
    let progress: WatchProgress?
    let action: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: action) {
                ZStack(alignment: .bottomLeading) {
                    Artwork(url: episode.stillUrl, seed: episode.id, title: episode.title, genres: title.genres, poster: false, showsText: false)
                    LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("A\(episode.episode)")
                            .font(.system(size: 44, weight: .heavy))
                            .foregroundStyle(.white.opacity(0.9))
                        if let p = progress { ProgressLine(fraction: p.fraction, height: 5) }
                    }
                    .padding(18)
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .opacity(focused ? 0.95 : 0)
                }
                .frame(width: 440, height: 248)
                .clipped()
            }
            .buttonStyle(.card)
            .focused($focused)
            .accessibilityIdentifier("episode.\(episode.id)")

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("\(episode.episode). \(episode.title)").font(.system(size: 24, weight: .semibold)).foregroundStyle(focused ? Theme.text : Theme.text2)
                    Spacer()
                    if let r = Format.runtime(episode.runtimeMin) { Text(r).font(.system(size: 20)).foregroundStyle(Theme.text3) }
                }
                .lineLimit(1)
                if let o = episode.overview {
                    Text(o).font(.system(size: 20)).foregroundStyle(Theme.text3).lineLimit(2)
                }
            }
            .frame(width: 440, alignment: .leading)
        }
    }
}

struct InfoColumn: View {
    let title: Title
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            if let d = title.director { item("Regie", d) }
            if let date = title.releaseDate { item("Releasedatum", Format.date(date)) }
            if !title.cast.isEmpty { item("Met", title.cast.prefix(5).map(\.name).joined(separator: ", ")) }
            if !title.languages.isEmpty { item("Audio", title.languages.map(Lang.name).joined(separator: ", ")) }
            if !title.subtitleLanguages.isEmpty { item("Ondertitels", title.subtitleLanguages.map(Lang.name).joined(separator: ", ")) }
            if !title.sourceIds.isEmpty { item("Bronnen", title.sourceIds.map { app.sources.sourceNames[$0] ?? $0 }.joined(separator: ", ")) }
            let display = app.catalog.displayTitle(title)
            let akas = uniqueAkas(title, excluding: display)
            if !akas.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Ook bekend als")
                    Text(akas.joined(separator: "  ·  ")).font(Theme.callout).foregroundStyle(Theme.text2).lineLimit(5)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 20)
    }

    private func uniqueAkas(_ t: Title, excluding: String) -> [String] {
        var seen: Set<String> = [excluding.lowercased()]
        return t.altTitles.compactMap { alt -> String? in
            guard seen.insert(alt.title.lowercased()).inserted else { return nil }
            return alt.lang.map { "\(alt.title) (\($0.uppercased()))" } ?? alt.title
        }
    }

    private func item(_ label: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(label)
            Text(value).font(Theme.callout).foregroundStyle(Theme.text2).lineLimit(3)
        }
    }
}

// MARK: - Person & genre

struct PersonView: View {
    let name: String
    @Environment(AppModel.self) private var app

    var body: some View {
        let titles = app.catalog.titles.filter { $0.cast.contains { $0.name == name } || $0.director == name }
        TitleGrid(header: name, eyebrow: "Acteur", titles: titles)
    }
}

struct GenreView: View {
    let genre: String
    let kind: TitleKind?
    @Environment(AppModel.self) private var app

    var body: some View {
        let titles = app.catalog.titles.filter { ($0.kind == kind || kind == nil) && $0.genres.contains(genre) }.sorted { $0.popularity > $1.popularity }
        TitleGrid(header: genre, eyebrow: "Genre", titles: titles)
    }
}

struct TitleGrid: View {
    let header: String
    var eyebrow: LocalizedStringKey?
    let titles: [Title]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                VStack(alignment: .leading, spacing: 8) {
                    if let eyebrow { Eyebrow(eyebrow) }
                    Text(header).font(Theme.title1)
                }
                PosterGrid(titles: titles)
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 40)
        }
        .scrollClipDisabled()
        .background(AmbientBackground())
    }
}

struct PosterGrid: View {
    let titles: [Title]
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(250), spacing: 48, alignment: .top), count: 6), alignment: .leading, spacing: 60) {
            ForEach(titles) { PosterCard(title: $0) }
        }
    }
}
