// App shell: the standard tvOS top tab bar, one NavigationStack per tab, and the full-screen
// players. The resume question ("Hervat vanaf 12:34 / Opnieuw beginnen") lives here too.

import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            TabStack(deepLink: true) { HomeView() }
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(AppTab.home)
            TabStack { LibraryView(kind: .movie) }
                .tabItem { Label("Films", systemImage: "film") }
                .tag(AppTab.movies)
            TabStack { LibraryView(kind: .series) }
                .tabItem { Label("Series", systemImage: "tv") }
                .tag(AppTab.series)
            TabStack { LiveTVView() }
                .tabItem { Label("Live TV", systemImage: "dot.radiowaves.left.and.right") }
                .tag(AppTab.live)
            TabStack { SearchView() }
                .tabItem { Label("Zoeken", systemImage: "magnifyingglass").labelStyle(.iconOnly) }
                .tag(AppTab.search)
            TabStack { MyListView() }
                .tabItem { Label("Mijn lijst", systemImage: "bookmark.fill") }
                .tag(AppTab.myList)
            TabStack(gated: false) { SettingsView() }
                .tabItem { Label("Instellingen", systemImage: "gearshape.fill").labelStyle(.iconOnly) }
                .tag(AppTab.settings)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await app.start() }
        .fullScreenCover(item: $app.playback) { session in
            PlayerScreen(session: session)
                .environment(app)
                .ignoresSafeArea()
        }
        .fullScreenCover(item: $app.live) { session in
            LivePlayerScreen(session: session)
                .environment(app)
                .environment(\.accent, Color(hex: app.user.settings.accent))
                .preferredColorScheme(.dark)
        }
        .confirmationDialog(resumeTitle, isPresented: resumeBinding, titleVisibility: .visible, presenting: app.resumeOffer) { offer in
            Button("Hervat vanaf \(Format.clock(offer.position))") { app.resume(offer, fromStart: false) }
            Button("Opnieuw beginnen") { app.resume(offer, fromStart: true) }
            Button("Annuleren", role: .cancel) { app.resumeOffer = nil }
        }
        .overlay(alignment: .bottom) {
            if let toast = app.toast {
                Text(toast)
                    .font(Theme.callout)
                    .padding(.horizontal, 36)
                    .padding(.vertical, 20)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 70)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(3))
                        app.toast = nil
                    }
            }
        }
        .animation(.easeOut, value: app.toast)
    }

    private var resumeTitle: String {
        guard let offer = app.resumeOffer else { return "" }
        let name = app.catalog.displayTitle(offer.session.title)
        if let ep = offer.session.episode { return "\(name) · S\(ep.season) A\(ep.episode)" }
        return name
    }

    private var resumeBinding: Binding<Bool> {
        Binding(get: { app.resumeOffer != nil }, set: { if !$0 { app.resumeOffer = nil } })
    }
}

/// NavigationStack with the app's routes, optionally gated on the catalog being ready.
struct TabStack<Content: View>: View {
    var gated: Bool = true
    /// Debug/screenshot hook: `-openTitle <id>` pushes that title once the catalog is ready.
    var deepLink: Bool = false
    @ViewBuilder let content: () -> Content
    @Environment(AppModel.self) private var app
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if gated { CatalogGate(content: content) } else { content() }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .title(let id): TitleDetailView(titleId: id)
                case .person(let name): PersonView(name: name)
                case .genre(let name, let kind): GenreView(genre: name, kind: kind)
                }
            }
        }
        .onChange(of: app.catalog.phase) { _, phase in
            guard deepLink, phase == .ready, path.isEmpty,
                  let id = UserDefaults.standard.string(forKey: "openTitle"), app.catalog.title(id) != nil else { return }
            path = [.title(id)]
        }
    }
}

/// Shows loading / error states until the catalog is ready.
struct CatalogGate<Content: View>: View {
    @Environment(AppModel.self) private var app
    @ViewBuilder let content: () -> Content

    var body: some View {
        switch app.catalog.phase {
        case .ready:
            content()
        case .idle:
            LoadingState(message: String(localized: "Even geduld…"))
        case .loading(let message):
            if app.catalog.titles.isEmpty && app.catalog.channels.isEmpty {
                LoadingState(message: message)
            } else {
                content()
            }
        case .failed(let message):
            ErrorState(title: "Er ging iets mis", message: message) {
                Task { await app.start(force: true) }
            }
        }
    }
}
