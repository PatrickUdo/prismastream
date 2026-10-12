// Loads one source into a RawCatalog JSON string: Swift does the networking, the JS core does
// the parsing and mapping. Raw JSON is passed through untouched so nothing gets lost between
// the core's output and buildCatalog's input.

import Foundation
import os

public struct SourceLoader: Sendable {
    static let log = Logger(subsystem: "nl.patrickudo.prismastream.tv", category: "sources")

    let engine: CoreEngine
    let fetcher: Fetcher

    public init(engine: CoreEngine, fetcher: Fetcher = Fetcher()) {
        self.engine = engine
        self.fetcher = fetcher
    }

    /// EPG window: 2 hours back, 36 hours ahead.
    static func epgWindow(now: Date = Date()) -> CoreEngine.XmltvOptions {
        let ms = now.timeIntervalSince1970 * 1000
        return .init(windowStart: ms - 2 * 3600_000, windowEnd: ms + 36 * 3600_000)
    }

    // MARK: Xtream

    public struct XtreamAccountInfo: Decodable, Sendable {
        public var status: String?
        public var expiresAt: Double?
        public var maxConnections: Int?
        public var isTrial: Bool?
    }

    /// Checks the credentials: returns the account info or throws (auth errors are explicit).
    public func testXtream(_ creds: XtreamCredentials, sourceId: String) async throws -> XtreamAccountInfo {
        guard let url = Xtream.apiURL(creds) else { throw FetchError.invalidURL }
        let data = try await fetcher.data(url, timeout: 15)
        let json = String(decoding: data, as: UTF8.self)
        if json.contains("\"auth\":0") || json.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw FetchError.auth }
        let ctx = CoreEngine.XtreamContext(sourceId: sourceId, serverUrl: creds.serverUrl, username: creds.username, password: creds.password)
        let mapped = try await engine.xtreamMap(kind: "account", json: json, context: ctx)
        return (try? JSONDecoder.core.decode(XtreamAccountInfo.self, from: Data(mapped.utf8))) ?? XtreamAccountInfo()
    }

    public func loadXtream(_ creds: XtreamCredentials, source: SourceConfig) async throws -> String {
        _ = try await testXtream(creds, sourceId: source.id)
        let base = CoreEngine.XtreamContext(sourceId: source.id, serverUrl: creds.serverUrl, username: creds.username, password: creds.password)

        async let vodCats = categories("get_vod_categories", kind: "vodCategories", creds, base)
        async let seriesCats = categories("get_series_categories", kind: "seriesCategories", creds, base)
        async let liveCats = categories("get_live_categories", kind: "liveCategories", creds, base)
        let (vc, sc, lc) = await (vodCats, seriesCats, liveCats)

        async let movies = list("get_vod_streams", kind: "vod", creds, base, categories: vc)
        async let series = list("get_series", kind: "series", creds, base, categories: sc)
        async let channels = list("get_live_streams", kind: "live", creds, base, categories: lc)
        let (m, s, c) = await (movies, series, channels)
        if m == nil, s == nil, c == nil { throw FetchError.network(String(localized: "Geen enkele lijst kon worden geladen.")) }

        let channelsJSON = c ?? "[]"
        var epgJSON = "[]"
        let epgURL = source.epgUrl.flatMap { URL(string: $0) } ?? Xtream.xmltvURL(creds)
        if let epgURL {
            epgJSON = await loadEpg(epgURL, channelsJSON: channelsJSON)
        }
        return Self.assemble(sourceId: source.id, movies: m ?? "[]", series: s ?? "[]", channels: channelsJSON, epg: epgJSON)
    }

    private func categories(_ action: String, kind: String, _ creds: XtreamCredentials, _ ctx: CoreEngine.XtreamContext) async -> String? {
        guard let url = Xtream.apiURL(creds, action: action),
              let data = try? await fetcher.data(url, timeout: 30) else { return nil }
        return try? await engine.xtreamMap(kind: kind, json: String(decoding: data, as: UTF8.self), context: ctx)
    }

    private func list(_ action: String, kind: String, _ creds: XtreamCredentials, _ base: CoreEngine.XtreamContext, categories: String?) async -> String? {
        do {
            guard let url = Xtream.apiURL(creds, action: action) else { return nil }
            let data = try await fetcher.data(url, timeout: 90)
            var ctx = base
            ctx.categoriesJSON = categories
            return try await engine.xtreamMap(kind: kind, json: String(decoding: data, as: UTF8.self), context: ctx)
        } catch {
            Self.log.error("Xtream \(action, privacy: .public) mislukt: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    /// get_series_info → xtreamMap('seriesDetails') JSON (`{ info, episodes }`) for one raw series.
    public func xtreamSeriesDetails(_ creds: XtreamCredentials, sourceId: String, seriesId: String) async throws -> String {
        guard let url = Xtream.apiURL(creds, action: "get_series_info", params: ["series_id": seriesId]) else { throw FetchError.invalidURL }
        let data = try await fetcher.data(url, timeout: 30)
        var ctx = CoreEngine.XtreamContext(sourceId: sourceId, serverUrl: creds.serverUrl, username: creds.username, password: creds.password)
        ctx.seriesId = seriesId
        return try await engine.xtreamMap(kind: "seriesDetails", json: String(decoding: data, as: UTF8.self), context: ctx)
    }

    // MARK: M3U

    public func loadM3U(_ source: SourceConfig) async throws -> String {
        guard let s = source.playlistUrl, let url = URL(string: s.trimmingCharacters(in: .whitespaces)) else { throw FetchError.invalidURL }
        let text = try await fetcher.text(url, timeout: 90)
        guard text.contains("#EXTINF") || text.contains("#EXTM3U") else { throw FetchError.decoding }
        let parsed = try await engine.parseM3U(text: text, sourceId: source.id)
        let epgString = source.epgUrl?.isEmpty == false ? source.epgUrl : parsed.epgUrl
        guard let epgString, let epgURL = URL(string: epgString) else { return parsed.catalogJSON }
        let epg = await loadEpg(epgURL, channelsJSON: nil, catalogJSON: parsed.catalogJSON)
        return (try? await engine.spliceEpg(catalogJSON: parsed.catalogJSON, epgJSON: epg)) ?? parsed.catalogJSON
    }

    // MARK: EPG

    /// Downloads (gzip-aware) and parses XMLTV for the given channels. Failures only lose the guide.
    func loadEpg(_ url: URL, channelsJSON: String?, catalogJSON: String? = nil) async -> String {
        do {
            let text = try await fetcher.text(url, timeout: 120)
            var options = Self.epgWindow()
            var ids: [String] = []
            if let channelsJSON, let channels = try? JSONDecoder.core.decode([Lossy<RawChannel>].self, from: Data(channelsJSON.utf8)) {
                ids = channels.compactMap { $0.value?.tvgId }.filter { !$0.isEmpty }
            } else if let catalogJSON, let raw = try? JSONDecoder.core.decode(RawCatalog.self, from: Data(catalogJSON.utf8)) {
                ids = raw.channels.compactMap(\.tvgId).filter { !$0.isEmpty }
            }
            if !ids.isEmpty { options.channelIds = Array(Set(ids)) }
            return try await engine.parseXmltv(text: text, options: options)
        } catch {
            let host = url.host() ?? "?"
            Self.log.error("EPG van \(host, privacy: .public) mislukt: \(error.localizedDescription, privacy: .public)")
            return "[]"
        }
    }

    static func assemble(sourceId: String, movies: String, series: String, channels: String, epg: String) -> String {
        let id = (try? String(decoding: JSONEncoder.core.encode(sourceId), as: UTF8.self)) ?? "\"\""
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return "{\"sourceId\":\(id),\"movies\":\(movies),\"series\":\(series),\"channels\":\(channels),\"epg\":\(epg),\"fetchedAt\":\(now)}"
    }
}
