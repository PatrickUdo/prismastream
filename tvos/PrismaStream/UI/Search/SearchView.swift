// Search with the native tvOS search keyboard → PrismaCore.search. Results are grouped (films,
// series, actors, channels); every title appears once, with "Ook bekend als" when an alternative
// title matched.

import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var app
    @State private var query = UserDefaults.standard.string(forKey: "searchQuery") ?? ""
    @State private var results = SearchResults()
    @State private var error: String?

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 50) {
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    suggestions
                } else if let error {
                    ErrorState(title: "Zoeken lukt niet", message: error)
                } else if results.isEmpty {
                    EmptyStateView(systemImage: "magnifyingglass", title: "Niets gevonden",
                                   message: "Probeer een andere titel, een acteur of een zender. Titels in andere talen worden ook gevonden.")
                } else {
                    resultsView
                }
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .searchable(text: $query, prompt: Text("Films, series, acteurs, zenders"))
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else {
                results = SearchResults()
                return
            }
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            do {
                results = try await app.engine.search(q, limit: 48)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 50) {
            Shelf(title: "Populair", eyebrow: "Suggesties", items: app.catalog.popular(.movie, limit: 12)) { PosterCard(title: $0) }
            let genres = app.catalog.genres().prefix(12).map { GenreItem(name: $0.name, count: $0.count) }
            Shelf(title: "Bladeren per genre", items: Array(genres), spacing: 32) { GenreTile(item: $0) }
        }
    }

    @ViewBuilder
    private var resultsView: some View {
        let seen = SeenSet()
        let movies = results.movies.compactMap { ref in seen.insert(ref.id) ? app.catalog.title(ref.id) : nil }
        let series = results.series.compactMap { ref in seen.insert(ref.id) ? app.catalog.title(ref.id) : nil }
        let channels = results.channels.compactMap { app.catalog.channel($0.id) }

        Shelf(title: "Films", eyebrow: LocalizedStringKey(resultCount(movies.count)), items: movies) { t in
            PosterCard(title: t, subtitle: aka(t))
        }
        Shelf(title: "Series", eyebrow: LocalizedStringKey(resultCount(series.count)), items: series) { t in
            PosterCard(title: t, subtitle: aka(t))
        }
        Shelf(title: "Acteurs", items: results.people) { person in
            NavigationLink(value: Route.person(person.name)) {
                VStack(spacing: 14) {
                    PersonBubble(person: Person(name: person.name), size: 150)
                    Text(person.name).font(.system(size: 22, weight: .semibold)).lineLimit(1).frame(width: 190)
                    Text("\(person.titles.count) titels").font(.system(size: 19)).foregroundStyle(Theme.text3)
                }
                .padding(10)
            }
            .buttonStyle(.borderless)
        }
        Shelf(title: "Zenders", items: channels) { ChannelCard(channel: $0) }
    }

    private func resultCount(_ n: Int) -> String {
        n == 1 ? String(localized: "1 resultaat") : String(localized: "\(n) resultaten")
    }

    private func aka(_ t: Title) -> String? {
        guard let alt = results.akas[t.id], alt.lowercased() != app.catalog.displayTitle(t).lowercased() else { return nil }
        return String(localized: "Ook bekend als \(alt)")
    }
}

/// Tiny reference-type set so ViewBuilder code can dedupe across groups.
final class SeenSet {
    private var ids = Set<String>()
    func insert(_ id: String) -> Bool { ids.insert(id).inserted }
}
