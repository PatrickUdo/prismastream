// App-wide state: the stores, the selected tab and playback requests (resume prompt included).

import Foundation
import Observation
import SwiftUI

public enum AppTab: String, Hashable, CaseIterable, Sendable {
    case home, movies, series, live, search, myList, settings
}

/// Everything the VOD player needs to start, switch versions and continue with the next episode.
public struct PlaybackSession: Identifiable, Sendable {
    public let id = UUID()
    public var title: Title
    public var episode: Episode?
    public var variant: StreamVariant
    public var startAt: Double
    /// Episodes after `episode`, in order (for "Volgende aflevering").
    public var upcoming: [Episode]
    public var prefs: LangPrefs

    public var variants: [StreamVariant] { episode?.variants ?? title.variants }
}

public struct LiveSession: Identifiable, Sendable {
    public let id = UUID()
    public var channelId: String
    public var channelIds: [String]
}

public struct ResumeOffer: Identifiable, Sendable {
    public let id = UUID()
    public var session: PlaybackSession
    public var position: Double
}

@MainActor
@Observable
public final class AppModel {
    public let engine: CoreEngine
    public let sources: SourceStore
    public let catalog: CatalogStore
    public let user: UserStore

    public var selectedTab: AppTab = .home
    public var playback: PlaybackSession?
    public var live: LiveSession?
    public var resumeOffer: ResumeOffer?
    public var toast: String?

    public init(engine: CoreEngine = .shared) {
        self.engine = engine
        sources = SourceStore()
        catalog = CatalogStore(engine: engine)
        user = UserStore()
        // Debug/screenshot hook: `-startTab live` (launch arguments land in UserDefaults).
        if let tab = UserDefaults.standard.string(forKey: "startTab").flatMap(AppTab.init(rawValue:)) { selectedTab = tab }
    }

    public var profile: Profile { user.activeProfile }

    public func start(force: Bool = false) async {
        await catalog.load(sources: sources, profile: profile, force: force)
        await catalog.refreshRecommendations(history: user.historyIds, favorites: user.data.favorites)
    }

    public func profileChanged() async {
        await catalog.refreshTexts(for: profile, history: user.historyIds, favorites: user.data.favorites)
    }

    // MARK: Playback

    /// Starts a movie or episode; asks "Hervatten?" when there is meaningful progress.
    public func play(_ title: Title, episode: Episode? = nil, variant: StreamVariant? = nil, prefs: LangPrefs? = nil, askResume: Bool = true) async {
        let prefs = prefs ?? profile.langPrefs
        let variants = episode?.variants ?? title.variants
        var chosen = variant
        if chosen == nil {
            chosen = (try? await engine.pickVariant(variants, prefs: prefs, title: title)) ?? variants.first
        }
        guard let chosen else {
            toast = String(localized: "Geen afspeelbare versie gevonden.")
            return
        }
        var upcoming: [Episode] = []
        if let episode, let all = catalog.title(title.id)?.allEpisodes ?? title.seasons.map({ $0.flatMap(\.episodes) }),
           let i = all.firstIndex(where: { $0.id == episode.id }) {
            upcoming = Array(all.dropFirst(i + 1))
        }
        let session = PlaybackSession(title: title, episode: episode, variant: chosen, startAt: 0, upcoming: upcoming, prefs: prefs)
        if askResume, let p = user.progress(title.id, episode?.id), p.isResumable {
            resumeOffer = ResumeOffer(session: session, position: p.positionSec)
        } else {
            playback = session
        }
    }

    public func resume(_ offer: ResumeOffer, fromStart: Bool) {
        var s = offer.session
        s.startAt = fromStart ? 0 : offer.position
        resumeOffer = nil
        playback = s
    }

    /// Continue an item from "Verder kijken" (no prompt: resuming is the point).
    public func continueWatching(_ progress: WatchProgress) async {
        guard var title = catalog.title(progress.titleId) else { return }
        if title.kind == .series, title.seasons == nil {
            title = await catalog.loadSeasons(for: title.id, sources: sources, profile: profile) ?? title
        }
        let episode = progress.episodeId.flatMap { id in title.allEpisodes.first { $0.id == id } }
        let variants = episode?.variants ?? title.variants
        let variant = variants.first { $0.id == progress.variantId }
        await play(title, episode: episode, variant: variant, askResume: false)
        playback?.startAt = progress.positionSec
    }

    public func playChannel(_ channel: Channel, in list: [Channel]? = nil) {
        let ids = (list ?? catalog.channels).map(\.id)
        user.setLastChannel(channel.id)
        live = LiveSession(channelId: channel.id, channelIds: ids.isEmpty ? [channel.id] : ids)
    }
}
