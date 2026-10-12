// Films / Series grids with a genre filter and sort, and "Mijn lijst".

import SwiftUI

struct LibraryView: View {
    enum Sort: Hashable { case popular, recent, alphabetical }

    let kind: TitleKind
    @Environment(AppModel.self) private var app
    @State private var genre: String?
    @State private var sort: Sort = .popular

    var body: some View {
        let all = app.catalog.titles.filter { $0.kind == kind }
        let filtered = all.filter { genre == nil || $0.genres.contains(genre ?? "") }
        let sorted: [Title] = switch sort {
        case .popular: filtered.sorted { $0.popularity > $1.popularity }
        case .recent: filtered.sorted { $0.addedAt > $1.addedAt }
        case .alphabetical: filtered.sorted { app.catalog.displayTitle($0).localizedCompare(app.catalog.displayTitle($1)) == .orderedAscending }
        }
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 36) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Eyebrow("\(all.count) titels")
                        Text(kind == .movie ? "Films" : "Series").font(Theme.title1)
                    }
                    Spacer()
                    HStack(spacing: 14) {
                        Chip(label: String(localized: "Populair"), selected: sort == .popular) { sort = .popular }
                        Chip(label: String(localized: "Nieuw"), selected: sort == .recent) { sort = .recent }
                        Chip(label: String(localized: "A–Z"), selected: sort == .alphabetical) { sort = .alphabetical }
                    }
                }
                .focusSection()

                ScrollView(.horizontal) {
                    HStack(spacing: 14) {
                        Chip(label: String(localized: "Alle genres"), selected: genre == nil) { genre = nil }
                        ForEach(app.catalog.genres(kind), id: \.name) { g in
                            Chip(label: g.name, detail: "\(g.count)", selected: genre == g.name) { genre = g.name }
                        }
                    }
                    .padding(.vertical, 14)
                    .padding(.horizontal, 6)
                }
                .scrollClipDisabled()
                .focusSection()

                if sorted.isEmpty {
                    EmptyStateView(systemImage: kind == .movie ? "film" : "tv", title: "Niets te zien", message: "Er zijn geen titels in deze selectie.")
                } else {
                    PosterGrid(titles: sorted)
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .background(AmbientBackground())
    }
}

struct MyListView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let titles = app.user.data.favorites.compactMap(app.catalog.title)
        let channels = app.user.data.favoriteChannels.compactMap(app.catalog.channel)
        let continuing = app.user.continueWatching().compactMap { p in app.catalog.title(p.titleId).map { ContinueItem(progress: p, title: $0) } }
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 50) {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("\(app.profile.name)")
                    Text("Mijn lijst").font(Theme.title1)
                }
                .padding(.horizontal, Theme.gutter)

                if titles.isEmpty && channels.isEmpty && continuing.isEmpty {
                    EmptyStateView(systemImage: "bookmark", title: "Je lijst is nog leeg",
                                   message: "Kies + bij een film of serie, of de ster bij een zender, om hem hier te bewaren.")
                }
                Shelf(title: "Verder kijken", items: continuing) { ContinueCard(item: $0) }
                if !titles.isEmpty {
                    VStack(alignment: .leading, spacing: 22) {
                        SectionHeader(title: "Films en series")
                        PosterGrid(titles: titles)
                    }
                    .padding(.horizontal, Theme.gutter)
                }
                Shelf(title: "Favoriete zenders", items: channels) { ChannelCard(channel: $0) }
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .background(AmbientBackground())
    }
}
