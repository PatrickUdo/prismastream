// The merged catalog the UI renders. Loads raw catalogs per source in parallel (with a 12 h disk
// cache), merges them with PrismaCore.buildCatalog, and offers lookups, home rows, lazy series
// episodes and now/next per channel.

import Foundation
import Observation
import os

@MainActor
@Observable
public final class CatalogStore {
    public enum Phase: Equatable {
        case idle
        case loading(String)
        case ready
        case failed(String)
    }

    static let log = Logger(subsystem: "nl.patrickudo.prismastream.tv", category: "catalog")

    public private(set) var phase: Phase = .idle
    public private(set) var catalog = Catalog()
    public private(set) var titlesById: [String: Title] = [:]
    public private(set) var channelsById: [String: Channel] = [:]
    /// PrismaCore.displayTitle per title for the active profile.
    public private(set) var displayTitles: [String: String] = [:]
    /// PrismaCore.summarizeLanguages per title.
    public private(set) var languageSummaries: [String: String] = [:]
    public private(set) var sourceErrors: [String: String] = [:]
    public private(set) var coreVersion: String?
    public private(set) var recommendedIds: [String] = []

    let engine: CoreEngine
    let loader: SourceLoader
    let cache = RawCatalogCache()
    private var loadingSeries: Set<String> = []

    public init(engine: CoreEngine) {
        self.engine = engine
        self.loader = SourceLoader(engine: engine)
    }

    public var isReady: Bool { phase == .ready }
    public var titles: [Title] { catalog.titles }
    public var channels: [Channel] { catalog.channels }

    // MARK: Loading

    /// Loads every enabled source (cache first unless `force`) and rebuilds the catalog.
    public func load(sources: SourceStore, profile: Profile, force: Bool = false) async {
        phase = .loading(String(localized: "Kern laden…"))
        if let error = await engine.load() {
            phase = .failed(error.localizedDescription)
            return
        }
        coreVersion = try? await engine.version()
        if let samples = try? await engine.sampleSources() { sources.seedSampleSources(samples) }

        let enabled = sources.enabledSources
        guard !enabled.isEmpty else {
            apply(Catalog())
            phase = .ready
            return
        }
        phase = .loading(String(localized: "Bronnen ophalen…"))

        // Resolve credentials on the main actor; the work itself runs in parallel tasks.
        struct Job: Sendable {
            var source: SourceConfig
            var creds: XtreamCredentials?
        }
        let jobs = enabled.map { Job(source: $0, creds: sources.credentials(for: $0)) }
        let loader = self.loader
        let cache = self.cache
        let engine = self.engine

        var raws: [String: String] = [:]
        var errors: [String: String] = [:]
        let needsSamples = jobs.contains { $0.source.type == .sample }
        let samples = needsSamples ? ((try? await engine.sampleCatalogsBySource()) ?? [:]) : [:]

        await withTaskGroup(of: (String, String?, String?).self) { group in
            for job in jobs {
                group.addTask {
                    let id = job.source.id
                    switch job.source.type {
                    case .sample:
                        if let raw = samples[id] { return (id, raw, nil) }
                        return (id, nil, String(localized: "Demobron niet gevonden in de kern."))
                    case .xtream, .m3u:
                        if !force, let entry = cache.read(id), entry.isFresh { return (id, entry.json, nil) }
                        do {
                            let json: String
                            if job.source.type == .xtream {
                                guard let creds = job.creds else {
                                    return (id, cache.read(id)?.json, String(localized: "Wachtwoord ontbreekt in de sleutelhanger."))
                                }
                                json = try await loader.loadXtream(creds, source: job.source)
                            } else {
                                json = try await loader.loadM3U(job.source)
                            }
                            cache.write(id, json: json)
                            return (id, json, nil)
                        } catch {
                            // Fall back to a stale cache rather than an empty catalog.
                            return (id, cache.read(id)?.json, error.localizedDescription)
                        }
                    }
                }
            }
            for await (id, raw, error) in group {
                if let raw { raws[id] = raw }
                if let error { errors[id] = error }
            }
        }
        for job in jobs where job.source.type != .sample {
            sources.markSynced(job.source.id, error: errors[job.source.id])
        }
        sourceErrors = errors

        phase = .loading(String(localized: "Catalogus samenvoegen…"))
        let ordered = enabled.compactMap { raws[$0.id] }
        do {
            let options = CoreEngine.BuildOptions(sourceNames: sources.sourceNames, preferLang: profile.audioLangs.first)
            let built = try await engine.buildCatalog(rawJSON: ordered, options: options)
            apply(built)
            await refreshTexts(for: profile)
            phase = .ready
            if built.titles.isEmpty, built.channels.isEmpty, let first = errors.values.first {
                phase = .failed(first)
            }
        } catch {
            Self.log.error("buildCatalog faalde: \(error.localizedDescription, privacy: .public)")
            phase = .failed(error.localizedDescription)
        }
    }

    private func apply(_ built: Catalog) {
        catalog = built
        titlesById = Dictionary(built.titles.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        channelsById = Dictionary(built.channels.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// Recomputes display titles, language summaries and recommendations for a profile.
    public func refreshTexts(for profile: Profile, history: [String] = [], favorites: [String] = []) async {
        if let texts = try? await engine.batchTitleTexts(prefs: profile.displayPrefs) {
            displayTitles = texts.display
            languageSummaries = texts.languages
        }
        await refreshRecommendations(history: history, favorites: favorites)
    }

    public func refreshRecommendations(history: [String], favorites: [String]) async {
        recommendedIds = (try? await engine.recommend(history: history, favorites: favorites)) ?? []
    }

    // MARK: Lookups

    public func title(_ id: String) -> Title? { titlesById[id] }
    public func channel(_ id: String) -> Channel? { channelsById[id] }

    public func displayTitle(_ t: Title) -> String { displayTitles[t.id] ?? t.title }
    public func languageSummary(_ t: Title) -> String {
        languageSummaries[t.id] ?? t.languages.prefix(3).map { $0.uppercased() }.joined(separator: " · ")
    }

    // MARK: Series episodes (lazy)

    public func isLoadingSeasons(_ id: String) -> Bool { loadingSeries.contains(id) }

    /// Ensures a series has seasons (Xtream loads them lazily via get_series_info).
    @discardableResult
    public func loadSeasons(for id: String, sources: SourceStore, profile: Profile) async -> Title? {
        guard let title = titlesById[id] else { return nil }
        if title.kind != .series || title.seasons != nil { return title }
        guard !loadingSeries.contains(id) else { return title }
        loadingSeries.insert(id)
        defer { loadingSeries.remove(id) }

        var items: [String] = []
        for ref in title.rawRefs {
            guard let source = sources.sources.first(where: { $0.id == ref.sourceId }),
                  let creds = sources.credentials(for: source) else { continue }
            do {
                let details = try await loader.xtreamSeriesDetails(creds, sourceId: ref.sourceId, seriesId: ref.providerId)
                items.append(try await engine.seriesSourceItem(ref: ref, detailsJSON: details))
            } catch {
                Self.log.error("Afleveringen laden mislukt: \(error.localizedDescription, privacy: .public)")
            }
        }
        guard !items.isEmpty else {
            var empty = title
            empty.seasons = []
            titlesById[id] = empty
            return empty
        }
        do {
            let merged = try await engine.mergeSeasons(title: title, sourcesJSON: items, preferLang: profile.audioLangs.first)
            titlesById[id] = merged
            if let i = catalog.titles.firstIndex(where: { $0.id == id }) { catalog.titles[i] = merged }
            return merged
        } catch {
            Self.log.error("mergeSeasons faalde: \(error.localizedDescription, privacy: .public)")
            return title
        }
    }

    // MARK: EPG

    public func programmes(for channel: Channel) -> [EpgProgramme] {
        guard let key = channel.epgId else { return [] }
        return catalog.epg[key] ?? []
    }

    public func nowNext(_ channel: Channel, at date: Date = Date()) -> (now: EpgProgramme?, next: EpgProgramme?) {
        let list = programmes(for: channel)
        guard let i = list.firstIndex(where: { $0.isOn(at: date) }) else {
            return (nil, list.first(where: { $0.startDate > date }))
        }
        return (list[i], i + 1 < list.count ? list[i + 1] : nil)
    }

    // MARK: Home rows (cheap Swift-side sorts; recommendations come from the core)

    public func featured(limit: Int = 5) -> [Title] {
        let withArt = titles.filter { $0.overview != nil }
        return Array(withArt.sorted { ($0.popularity, $0.addedAt) > ($1.popularity, $1.addedAt) }.prefix(limit))
    }

    public func popular(_ kind: TitleKind, limit: Int = 24) -> [Title] {
        Array(titles.filter { $0.kind == kind }.sorted { $0.popularity > $1.popularity }.prefix(limit))
    }

    /// Trending: popularity weighted by recency.
    public func trending(_ kind: TitleKind, limit: Int = 24) -> [Title] {
        let now = Date().timeIntervalSince1970 * 1000
        func score(_ t: Title) -> Double {
            let days = max(0, (now - t.addedAt) / 86_400_000)
            return t.popularity * exp(-days / 30)
        }
        return Array(titles.filter { $0.kind == kind }.sorted { score($0) > score($1) }.prefix(limit))
    }

    public func recent(limit: Int = 24) -> [Title] {
        Array(titles.sorted { $0.addedAt > $1.addedAt }.prefix(limit))
    }

    public func recommended(limit: Int = 24) -> [Title] {
        let list = recommendedIds.compactMap { titlesById[$0] }
        return list.isEmpty ? popular(.movie, limit: limit) : Array(list.prefix(limit))
    }

    public func genres(_ kind: TitleKind? = nil) -> [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for t in titles where kind == nil || t.kind == kind {
            for g in t.genres { counts[g, default: 0] += 1 }
        }
        return counts.map { ($0.key, $0.value) }.sorted { $0.count != $1.count ? $0.count > $1.count : $0.name < $1.name }
    }

    public func similar(to title: Title, limit: Int = 16) -> [Title] {
        let genres = Set(title.genres)
        return Array(titles
            .filter { $0.id != title.id && !genres.isDisjoint(with: $0.genres) }
            .sorted { (genres.intersection($0.genres).count, $0.popularity) > (genres.intersection($1.genres).count, $1.popularity) }
            .prefix(limit))
    }
}
