// Codable mirrors of src/lib/types.ts. The JS core produces these JSON shapes; Swift decodes them
// tolerantly: unknown fields are ignored, optional fields stay optional, required arrays default
// to empty and individual broken array elements are skipped instead of failing the whole payload.

import Foundation

public typealias LangCode = String

// MARK: - Tolerant decoding helpers

/// Decodes any value but never throws; used to skip broken elements in arrays.
struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

extension KeyedDecodingContainer {
    /// Optional value; a missing key, `null` or a value of the wrong type all yield `nil`.
    func opt<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(type, forKey: key)) ?? nil
    }

    /// Value with a default for missing / null / mistyped data.
    func value<T: Decodable>(_ key: Key, default def: T) -> T {
        opt(T.self, key) ?? def
    }

    /// Array that skips elements which fail to decode.
    func lossy<T: Decodable>(_ type: T.Type, _ key: Key) -> [T] {
        guard let items = opt([Lossy<T>].self, key) else { return [] }
        return items.compactMap(\.value)
    }

    /// Optional array (nil when absent) that skips broken elements.
    func lossyOptional<T: Decodable>(_ type: T.Type, _ key: Key) -> [T]? {
        guard contains(key), let items = opt([Lossy<T>].self, key) else { return nil }
        return items.compactMap(\.value)
    }

    /// Number that may arrive as a string ("8.2").
    func flexibleDouble(_ key: Key) -> Double? {
        if let d = opt(Double.self, key) { return d }
        if let s = opt(String.self, key) { return Double(s) }
        return nil
    }

    func flexibleInt(_ key: Key) -> Int? {
        if let i = opt(Int.self, key) { return i }
        if let d = opt(Double.self, key), d.isFinite { return Int(d) }
        if let s = opt(String.self, key) { return Int(s) }
        return nil
    }
}

// MARK: - Quality

public enum Quality: String, Codable, Sendable, CaseIterable, Comparable {
    case uhd = "4K"
    case fhd = "FHD"
    case hd = "HD"
    case sd = "SD"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? "unknown"
        self = Quality(rawValue: raw) ?? .unknown
    }

    /// 0 = best.
    public var rank: Int {
        switch self {
        case .uhd: 0
        case .fhd: 1
        case .hd: 2
        case .sd: 3
        case .unknown: 4
        }
    }

    public static func < (lhs: Quality, rhs: Quality) -> Bool { lhs.rank < rhs.rank }
}

public enum TitleKind: String, Codable, Sendable {
    case movie, series

    public init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? "movie"
        self = TitleKind(rawValue: raw) ?? .movie
    }
}

// MARK: - Raw provider output

public struct RawEpisode: Codable, Sendable, Hashable {
    public var providerId: String
    public var season: Int
    public var episode: Int
    public var title: String?
    public var plot: String?
    public var durationSec: Double?
    public var stillUrl: String?
    public var airDate: String?
    public var url: String
    public var containerExt: String?

    enum CodingKeys: String, CodingKey {
        case providerId, season, episode, title, plot, durationSec, stillUrl, airDate, url, containerExt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        providerId = c.opt(String.self, .providerId) ?? c.flexibleInt(.providerId).map(String.init) ?? ""
        season = c.flexibleInt(.season) ?? 0
        episode = c.flexibleInt(.episode) ?? 0
        title = c.opt(String.self, .title)
        plot = c.opt(String.self, .plot)
        durationSec = c.flexibleDouble(.durationSec)
        stillUrl = c.opt(String.self, .stillUrl)
        airDate = c.opt(String.self, .airDate)
        url = try c.decode(String.self, forKey: .url)
        containerExt = c.opt(String.self, .containerExt)
    }
}

/// Shared shape of RawMovie and RawSeries (kept minimal: Swift mostly passes raw JSON through).
public struct RawItem: Codable, Sendable {
    public var kind: String
    public var sourceId: String
    public var providerId: String
    public var rawTitle: String
    public var category: String?
    public var year: Int?
    public var url: String?
    public var episodes: [RawEpisode]?

    enum CodingKeys: String, CodingKey {
        case kind, sourceId, providerId, rawTitle, category, year, url, episodes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.value(.kind, default: "movie")
        sourceId = c.value(.sourceId, default: "")
        providerId = c.opt(String.self, .providerId) ?? c.flexibleInt(.providerId).map(String.init) ?? ""
        rawTitle = c.value(.rawTitle, default: "")
        category = c.opt(String.self, .category)
        year = c.flexibleInt(.year)
        url = c.opt(String.self, .url)
        episodes = c.lossyOptional(RawEpisode.self, .episodes)
    }
}

public struct RawChannel: Codable, Sendable {
    public var kind: String
    public var sourceId: String
    public var providerId: String
    public var rawName: String
    public var tvgId: String?
    public var tvgName: String?
    public var logoUrl: String?
    public var group: String?
    public var number: Int?
    public var url: String
    public var altUrls: [String]?
    public var langHint: LangCode?
    public var catchupDays: Int?

    enum CodingKeys: String, CodingKey {
        case kind, sourceId, providerId, rawName, tvgId, tvgName, logoUrl, group, number, url, altUrls, langHint, catchupDays
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.value(.kind, default: "live")
        sourceId = c.value(.sourceId, default: "")
        providerId = c.opt(String.self, .providerId) ?? c.flexibleInt(.providerId).map(String.init) ?? ""
        rawName = c.value(.rawName, default: "")
        tvgId = c.opt(String.self, .tvgId)
        tvgName = c.opt(String.self, .tvgName)
        logoUrl = c.opt(String.self, .logoUrl)
        group = c.opt(String.self, .group)
        number = c.flexibleInt(.number)
        url = try c.decode(String.self, forKey: .url)
        altUrls = c.lossyOptional(String.self, .altUrls)
        langHint = c.opt(String.self, .langHint)
        catchupDays = c.flexibleInt(.catchupDays)
    }
}

public struct EpgProgramme: Codable, Sendable, Hashable, Identifiable {
    public var channelId: String
    /// Epoch milliseconds.
    public var start: Double
    public var stop: Double
    public var title: String
    public var desc: String?
    public var category: String?
    public var icon: String?

    public var id: String { "\(channelId)@\(Int64(start))" }
    public var startDate: Date { Date(timeIntervalSince1970: start / 1000) }
    public var stopDate: Date { Date(timeIntervalSince1970: stop / 1000) }

    public func isOn(at date: Date) -> Bool { startDate <= date && date < stopDate }

    /// 0...1 elapsed fraction at `date`.
    public func progress(at date: Date) -> Double {
        let total = stop - start
        guard total > 0 else { return 0 }
        return min(1, max(0, (date.timeIntervalSince1970 * 1000 - start) / total))
    }

    enum CodingKeys: String, CodingKey { case channelId, start, stop, title, desc, category, icon }

    public init(channelId: String, start: Double, stop: Double, title: String, desc: String? = nil, category: String? = nil, icon: String? = nil) {
        self.channelId = channelId
        self.start = start
        self.stop = stop
        self.title = title
        self.desc = desc
        self.category = category
        self.icon = icon
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        channelId = c.value(.channelId, default: "")
        start = c.flexibleDouble(.start) ?? 0
        stop = c.flexibleDouble(.stop) ?? 0
        title = c.value(.title, default: "")
        desc = c.opt(String.self, .desc)
        category = c.opt(String.self, .category)
        icon = c.opt(String.self, .icon)
    }
}

/// Everything one source produced in one refresh. Swift normally keeps this as raw JSON and
/// only decodes it for inspection (tests, counts).
public struct RawCatalog: Codable, Sendable {
    public var sourceId: String
    public var movies: [RawItem]
    public var series: [RawItem]
    public var channels: [RawChannel]
    public var epg: [EpgProgramme]
    public var fetchedAt: Double

    enum CodingKeys: String, CodingKey { case sourceId, movies, series, channels, epg, fetchedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sourceId = c.value(.sourceId, default: "")
        movies = c.lossy(RawItem.self, .movies)
        series = c.lossy(RawItem.self, .series)
        channels = c.lossy(RawChannel.self, .channels)
        epg = c.lossy(EpgProgramme.self, .epg)
        fetchedAt = c.flexibleDouble(.fetchedAt) ?? 0
    }
}

// MARK: - Merged catalog

public struct StreamVariant: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var sourceId: String
    public var url: String
    public var audioLangs: [LangCode]
    public var subtitleLangs: [LangCode]
    public var quality: Quality
    public var label: String
    public var containerExt: String?
    public var altUrls: [String]?

    enum CodingKeys: String, CodingKey { case id, sourceId, url, audioLangs, subtitleLangs, quality, label, containerExt, altUrls }

    public init(id: String, sourceId: String, url: String, audioLangs: [LangCode], subtitleLangs: [LangCode] = [], quality: Quality = .unknown, label: String = "", containerExt: String? = nil, altUrls: [String]? = nil) {
        self.id = id
        self.sourceId = sourceId
        self.url = url
        self.audioLangs = audioLangs
        self.subtitleLangs = subtitleLangs
        self.quality = quality
        self.label = label
        self.containerExt = containerExt
        self.altUrls = altUrls
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try c.decode(String.self, forKey: .url)
        sourceId = c.value(.sourceId, default: "")
        id = c.opt(String.self, .id) ?? "\(sourceId):\(url)"
        audioLangs = c.lossy(String.self, .audioLangs)
        subtitleLangs = c.lossy(String.self, .subtitleLangs)
        quality = c.value(.quality, default: .unknown)
        label = c.value(.label, default: "")
        containerExt = c.opt(String.self, .containerExt)
        altUrls = c.lossyOptional(String.self, .altUrls)
    }

    /// Primary audio language ('und' when unknown).
    public var primaryLang: LangCode { audioLangs.first ?? "und" }
}

public struct Person: Codable, Sendable, Hashable, Identifiable {
    public var name: String
    public var character: String?
    public var profileUrl: String?
    public var id: String { name }

    enum CodingKeys: String, CodingKey { case name, character, profileUrl }

    public init(name: String, character: String? = nil, profileUrl: String? = nil) {
        self.name = name
        self.character = character
        self.profileUrl = profileUrl
    }

    public init(from decoder: Decoder) throws {
        // Some payloads carry cast as plain strings.
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            name = s
            character = nil
            profileUrl = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.value(.name, default: "")
        character = c.opt(String.self, .character)
        profileUrl = c.opt(String.self, .profileUrl)
    }
}

public struct Episode: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var season: Int
    public var episode: Int
    public var title: String
    public var overview: String?
    public var runtimeMin: Double?
    public var stillUrl: String?
    public var airDate: String?
    public var variants: [StreamVariant]

    enum CodingKeys: String, CodingKey { case id, season, episode, title, overview, runtimeMin, stillUrl, airDate, variants }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        season = c.flexibleInt(.season) ?? 0
        episode = c.flexibleInt(.episode) ?? 0
        id = c.opt(String.self, .id) ?? "s\(season)e\(episode)"
        title = c.value(.title, default: "")
        overview = c.opt(String.self, .overview)
        runtimeMin = c.flexibleDouble(.runtimeMin)
        stillUrl = c.opt(String.self, .stillUrl)
        airDate = c.opt(String.self, .airDate)
        variants = c.lossy(StreamVariant.self, .variants)
    }
}

public struct Season: Codable, Sendable, Hashable, Identifiable {
    public var number: Int
    public var episodes: [Episode]
    public var id: Int { number }

    enum CodingKeys: String, CodingKey { case number, episodes }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        number = c.flexibleInt(.number) ?? 0
        episodes = c.lossy(Episode.self, .episodes)
    }
}

public struct AltTitle: Codable, Sendable, Hashable {
    public var title: String
    public var lang: LangCode?

    enum CodingKeys: String, CodingKey { case title, lang }

    public init(title: String, lang: LangCode? = nil) {
        self.title = title
        self.lang = lang
    }

    public init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            title = s
            lang = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.value(.title, default: "")
        lang = c.opt(String.self, .lang)
    }
}

public struct RawRef: Codable, Sendable, Hashable {
    public var sourceId: String
    public var providerId: String
    public var langs: [LangCode]

    enum CodingKeys: String, CodingKey { case sourceId, providerId, langs }

    public init(sourceId: String, providerId: String, langs: [LangCode]) {
        self.sourceId = sourceId
        self.providerId = providerId
        self.langs = langs
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sourceId = c.value(.sourceId, default: "")
        providerId = c.opt(String.self, .providerId) ?? c.flexibleInt(.providerId).map(String.init) ?? ""
        langs = c.lossy(String.self, .langs)
    }
}

public struct Title: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var kind: TitleKind
    public var title: String
    public var originalTitle: String?
    public var altTitles: [AltTitle]
    public var year: Int?
    public var tmdbId: Int?
    public var imdbId: String?
    public var overview: String?
    public var genres: [String]
    public var runtimeMin: Double?
    public var releaseDate: String?
    public var rating: Double?
    public var cast: [Person]
    public var director: String?
    public var trailerUrl: String?
    public var posterUrl: String?
    public var backdropUrl: String?
    public var logoUrl: String?
    public var originalLang: LangCode?
    public var certification: String?
    public var kidsSafe: Bool?
    public var addedAt: Double
    public var popularity: Double
    public var variants: [StreamVariant]
    public var seasons: [Season]?
    public var languages: [LangCode]
    public var subtitleLanguages: [LangCode]
    public var qualities: [Quality]
    public var sourceIds: [String]
    public var rawRefs: [RawRef]

    enum CodingKeys: String, CodingKey {
        case id, kind, title, originalTitle, altTitles, year, tmdbId, imdbId, overview, genres, runtimeMin, releaseDate,
             rating, cast, director, trailerUrl, posterUrl, backdropUrl, logoUrl, originalLang, certification, kidsSafe,
             addedAt, popularity, variants, seasons, languages, subtitleLanguages, qualities, sourceIds, rawRefs
    }

    public init(id: String, kind: TitleKind, title: String) {
        self.id = id
        self.kind = kind
        self.title = title
        altTitles = []
        genres = []
        cast = []
        addedAt = 0
        popularity = 0
        variants = []
        languages = []
        subtitleLanguages = []
        qualities = []
        sourceIds = []
        rawRefs = []
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = c.value(.kind, default: .movie)
        title = c.value(.title, default: id)
        originalTitle = c.opt(String.self, .originalTitle)
        altTitles = c.lossy(AltTitle.self, .altTitles)
        year = c.flexibleInt(.year)
        tmdbId = c.flexibleInt(.tmdbId)
        imdbId = c.opt(String.self, .imdbId)
        overview = c.opt(String.self, .overview)
        genres = c.lossy(String.self, .genres)
        runtimeMin = c.flexibleDouble(.runtimeMin)
        releaseDate = c.opt(String.self, .releaseDate)
        rating = c.flexibleDouble(.rating)
        cast = c.lossy(Person.self, .cast)
        director = c.opt(String.self, .director)
        trailerUrl = c.opt(String.self, .trailerUrl)
        posterUrl = c.opt(String.self, .posterUrl)
        backdropUrl = c.opt(String.self, .backdropUrl)
        logoUrl = c.opt(String.self, .logoUrl)
        originalLang = c.opt(String.self, .originalLang)
        certification = c.opt(String.self, .certification)
        kidsSafe = c.opt(Bool.self, .kidsSafe)
        addedAt = c.flexibleDouble(.addedAt) ?? 0
        popularity = c.flexibleDouble(.popularity) ?? 0
        variants = c.lossy(StreamVariant.self, .variants)
        seasons = c.lossyOptional(Season.self, .seasons)
        languages = c.lossy(String.self, .languages)
        subtitleLanguages = c.lossy(String.self, .subtitleLanguages)
        qualities = c.lossy(Quality.self, .qualities)
        sourceIds = c.lossy(String.self, .sourceIds)
        rawRefs = c.lossy(RawRef.self, .rawRefs)
    }

    public var bestQuality: Quality? { qualities.min() }
    public var isSeries: Bool { kind == .series }

    /// Total playable versions (movies) or episodes (series).
    public var allEpisodes: [Episode] { (seasons ?? []).flatMap(\.episodes) }
}

public struct Channel: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var logoUrl: String?
    public var group: String
    public var number: Int?
    public var epgId: String?
    public var languages: [LangCode]
    public var variants: [StreamVariant]

    enum CodingKeys: String, CodingKey { case id, name, logoUrl, group, number, epgId, languages, variants }

    public init(id: String, name: String, group: String = "", number: Int? = nil, epgId: String? = nil, languages: [LangCode] = [], variants: [StreamVariant] = []) {
        self.id = id
        self.name = name
        self.group = group
        self.number = number
        self.epgId = epgId
        self.languages = languages
        self.variants = variants
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: id)
        logoUrl = c.opt(String.self, .logoUrl)
        group = c.value(.group, default: "")
        number = c.flexibleInt(.number)
        epgId = c.opt(String.self, .epgId)
        languages = c.lossy(String.self, .languages)
        variants = c.lossy(StreamVariant.self, .variants)
    }

    /// "P1" style initials for channels without a logo.
    public var initials: String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "-" }).filter { !$0.isEmpty }
        if words.count >= 2, let a = words[0].first, let b = words[1].first { return "\(a)\(b)".uppercased() }
        return String(name.prefix(2)).uppercased()
    }
}

public struct Catalog: Codable, Sendable {
    public var titles: [Title]
    public var channels: [Channel]
    public var epg: [String: [EpgProgramme]]
    public var builtAt: Double

    enum CodingKeys: String, CodingKey { case titles, channels, epg, builtAt }

    public init(titles: [Title] = [], channels: [Channel] = [], epg: [String: [EpgProgramme]] = [:], builtAt: Double = 0) {
        self.titles = titles
        self.channels = channels
        self.epg = epg
        self.builtAt = builtAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        titles = c.lossy(Title.self, .titles)
        channels = c.lossy(Channel.self, .channels)
        var epg: [String: [EpgProgramme]] = [:]
        if let raw = c.opt([String: [Lossy<EpgProgramme>]].self, .epg) {
            for (k, v) in raw { epg[k] = v.compactMap(\.value) }
        }
        self.epg = epg
        builtAt = c.flexibleDouble(.builtAt) ?? 0
    }
}

// MARK: - Core helper shapes

/// `{ audioLangs, subtitleLangs, subtitlesOn }` for pickVariant.
public struct LangPrefs: Codable, Sendable, Hashable {
    public var audioLangs: [LangCode]
    public var subtitleLangs: [LangCode]
    public var subtitlesOn: Bool

    public init(audioLangs: [LangCode], subtitleLangs: [LangCode], subtitlesOn: Bool) {
        self.audioLangs = audioLangs
        self.subtitleLangs = subtitleLangs
        self.subtitlesOn = subtitlesOn
    }
}

/// `{ uiLang, audioLangs }` for displayTitle.
public struct DisplayPrefs: Codable, Sendable, Hashable {
    public var uiLang: String
    public var audioLangs: [LangCode]

    public init(uiLang: String, audioLangs: [LangCode]) {
        self.uiLang = uiLang
        self.audioLangs = audioLangs
    }
}

public struct LanguageGroup: Codable, Sendable, Hashable, Identifiable {
    public var lang: LangCode
    public var variants: [StreamVariant]
    public var id: String { lang }

    enum CodingKeys: String, CodingKey { case lang, variants }

    public init(lang: LangCode, variants: [StreamVariant]) {
        self.lang = lang
        self.variants = variants
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lang = c.value(.lang, default: "und")
        variants = c.lossy(StreamVariant.self, .variants)
    }
}

public struct SampleSourceInfo: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var type: String
}

/// A reference to a title that may be serialised as an id string or as an object with `id`.
public struct TitleRef: Decodable, Sendable, Hashable {
    public var id: String
    public var title: String?

    enum CodingKeys: String, CodingKey { case id, title }

    public init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            id = s
            title = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.opt(String.self, .title)
    }
}

public struct SearchPerson: Decodable, Sendable, Hashable, Identifiable {
    public var name: String
    public var titles: [TitleRef]
    public var id: String { name }

    enum CodingKeys: String, CodingKey { case name, titles }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.value(.name, default: "")
        titles = c.lossy(TitleRef.self, .titles)
    }
}

public struct SearchResults: Decodable, Sendable {
    public var movies: [TitleRef]
    public var series: [TitleRef]
    public var people: [SearchPerson]
    public var channels: [TitleRef]
    public var genres: [String]
    /// titleId → alternative title that matched ("Ook bekend als").
    public var akas: [String: String]

    enum CodingKeys: String, CodingKey { case movies, series, people, channels, genres, akas }

    public init() {
        akas = [:]
        movies = []
        series = []
        people = []
        channels = []
        genres = []
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        movies = c.lossy(TitleRef.self, .movies)
        series = c.lossy(TitleRef.self, .series)
        people = c.lossy(SearchPerson.self, .people)
        channels = c.lossy(TitleRef.self, .channels)
        genres = c.lossy(String.self, .genres)
        akas = c.value(.akas, default: [:])
    }

    public var isEmpty: Bool { movies.isEmpty && series.isEmpty && people.isEmpty && channels.isEmpty }
}

/// Episodes of one raw series, as passed to mergeSeasons.
public struct RawEpisodesBySource: Codable, Sendable {
    public var sourceId: String
    public var providerId: String
    public var langs: [LangCode]
    public var episodes: [RawEpisode]
}

// MARK: - Profiles & personal data

public struct Profile: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// Avatar preset id ('aurora', 'ember', ...).
    public var avatar: String
    public var isKids: Bool
    public var pinHash: String?
    public var audioLangs: [LangCode]
    public var subtitleLangs: [LangCode]
    public var subtitlesOn: Bool
    public var uiLang: String
    public var createdAt: Double

    enum CodingKeys: String, CodingKey { case id, name, avatar, isKids, pinHash, audioLangs, subtitleLangs, subtitlesOn, uiLang, createdAt }

    public init(id: String = UUID().uuidString.lowercased(), name: String, avatar: String = "aurora", isKids: Bool = false,
                audioLangs: [LangCode] = ["nl", "en"], subtitleLangs: [LangCode] = ["nl"], subtitlesOn: Bool = false,
                uiLang: String = "nl", createdAt: Double = Date().timeIntervalSince1970 * 1000) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.isKids = isKids
        self.audioLangs = audioLangs
        self.subtitleLangs = subtitleLangs
        self.subtitlesOn = subtitlesOn
        self.uiLang = uiLang
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "Profiel")
        avatar = c.value(.avatar, default: "aurora")
        isKids = c.value(.isKids, default: false)
        pinHash = c.opt(String.self, .pinHash)
        audioLangs = c.lossy(String.self, .audioLangs)
        subtitleLangs = c.lossy(String.self, .subtitleLangs)
        subtitlesOn = c.value(.subtitlesOn, default: false)
        uiLang = c.value(.uiLang, default: "nl")
        createdAt = c.flexibleDouble(.createdAt) ?? 0
    }

    public var langPrefs: LangPrefs { LangPrefs(audioLangs: audioLangs, subtitleLangs: subtitleLangs, subtitlesOn: subtitlesOn) }
    public var displayPrefs: DisplayPrefs { DisplayPrefs(uiLang: uiLang, audioLangs: audioLangs) }
}

public struct WatchProgress: Codable, Sendable, Hashable {
    public var titleId: String
    public var episodeId: String?
    public var variantId: String
    public var positionSec: Double
    public var durationSec: Double
    public var updatedAt: Double

    public init(titleId: String, episodeId: String?, variantId: String, positionSec: Double, durationSec: Double, updatedAt: Double) {
        self.titleId = titleId
        self.episodeId = episodeId
        self.variantId = variantId
        self.positionSec = positionSec
        self.durationSec = durationSec
        self.updatedAt = updatedAt
    }

    /// 0...1
    public var fraction: Double { durationSec > 0 ? min(1, max(0, positionSec / durationSec)) : 0 }
    /// Worth offering "resume": past the first 30 s and not (almost) finished.
    public var isResumable: Bool { positionSec > 30 && fraction < 0.95 }

    public static func key(_ titleId: String, _ episodeId: String?) -> String {
        if let episodeId { return "\(titleId)|\(episodeId)" }
        return titleId
    }
}

public struct HistoryEntry: Codable, Sendable, Hashable {
    public var titleId: String
    public var episodeId: String?
    public var at: Double
}

public struct ProfileData: Codable, Sendable {
    public var favorites: [String]
    public var favoriteChannels: [String]
    public var progress: [String: WatchProgress]
    public var history: [HistoryEntry]
    public var lastChannelId: String?
    public var updatedAt: Double

    enum CodingKeys: String, CodingKey { case favorites, favoriteChannels, progress, history, lastChannelId, updatedAt }

    public init() {
        favorites = []
        favoriteChannels = []
        progress = [:]
        history = []
        updatedAt = 0
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        favorites = c.lossy(String.self, .favorites)
        favoriteChannels = c.lossy(String.self, .favoriteChannels)
        progress = c.value(.progress, default: [:])
        history = c.lossy(HistoryEntry.self, .history)
        lastChannelId = c.opt(String.self, .lastChannelId)
        updatedAt = c.flexibleDouble(.updatedAt) ?? 0
    }
}
