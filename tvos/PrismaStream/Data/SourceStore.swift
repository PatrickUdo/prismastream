// User-configured sources (demo, Xtream Codes, M3U). The list is persisted as JSON in
// Application Support WITHOUT secrets; Xtream passwords live in the Keychain keyed by source id.

import Foundation
import Observation

public enum SourceType: String, Codable, Sendable {
    case sample, xtream, m3u
}

public struct SourceConfig: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var type: SourceType
    public var enabled: Bool
    public var addedAt: Double
    public var lastSyncAt: Double?
    public var lastError: String?
    /// Xtream
    public var serverUrl: String?
    public var username: String?
    /// M3U
    public var playlistUrl: String?
    /// Optional XMLTV override (Xtream) or guide url (M3U).
    public var epgUrl: String?

    public init(id: String = UUID().uuidString.lowercased(), name: String, type: SourceType, enabled: Bool = true,
                serverUrl: String? = nil, username: String? = nil, playlistUrl: String? = nil, epgUrl: String? = nil) {
        self.id = id
        self.name = name
        self.type = type
        self.enabled = enabled
        self.addedAt = Date().timeIntervalSince1970 * 1000
        self.serverUrl = serverUrl
        self.username = username
        self.playlistUrl = playlistUrl
        self.epgUrl = epgUrl
    }

    /// Short human description without secrets ("server.tld · gebruiker").
    public var detail: String {
        switch type {
        case .sample: return String(localized: "Ingebouwde demo-inhoud")
        case .xtream:
            let host = serverUrl.flatMap { URL(string: Xtream.normalizeServer($0))?.host() } ?? serverUrl ?? ""
            return [host, username ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        case .m3u:
            return playlistUrl.flatMap { URL(string: $0)?.host() } ?? String(localized: "M3U-afspeellijst")
        }
    }
}

/// Credentials resolved at load time (password from the Keychain).
public struct XtreamCredentials: Sendable {
    public var serverUrl: String
    public var username: String
    public var password: String
}

public enum Xtream {
    /// Mirrors normalizeServerUrl() of the TS core: add http://, strip trailing slashes and
    /// known endpoint paths.
    public static func normalizeServer(_ input: String) -> String {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return s }
        if s.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) == nil { s = "http://" + s }
        guard var comps = URLComponents(string: s) else { return s }
        var path = comps.path
        path = path.replacingOccurrences(of: "/(player_api|get|xmltv|panel_api)\\.php$", with: "", options: [.regularExpression, .caseInsensitive])
        while path.hasSuffix("/") { path.removeLast() }
        comps.path = path
        comps.query = nil
        comps.fragment = nil
        return comps.string ?? s
    }

    public static func apiURL(_ c: XtreamCredentials, action: String? = nil, params: [String: String] = [:]) -> URL? {
        var comps = URLComponents(string: normalizeServer(c.serverUrl) + "/player_api.php")
        var items = [URLQueryItem(name: "username", value: c.username), URLQueryItem(name: "password", value: c.password)]
        if let action { items.append(URLQueryItem(name: "action", value: action)) }
        for (k, v) in params.sorted(by: { $0.key < $1.key }) { items.append(URLQueryItem(name: k, value: v)) }
        comps?.queryItems = items
        return comps?.url
    }

    public static func xmltvURL(_ c: XtreamCredentials) -> URL? {
        var comps = URLComponents(string: normalizeServer(c.serverUrl) + "/xmltv.php")
        comps?.queryItems = [URLQueryItem(name: "username", value: c.username), URLQueryItem(name: "password", value: c.password)]
        return comps?.url
    }
}

@MainActor
@Observable
public final class SourceStore {
    public private(set) var sources: [SourceConfig] = []
    let keychain: Keychain
    private let fileURL: URL

    public init(keychain: Keychain = Keychain(), fileURL: URL = AppPaths.root.appending(path: "sources.json")) {
        self.keychain = keychain
        self.fileURL = fileURL
        sources = JSONStore.load([SourceConfig].self, from: fileURL) ?? []
    }

    public var enabledSources: [SourceConfig] { sources.filter(\.enabled) }

    /// Adds the built-in demo sources the first time (or when they disappeared from the list).
    public func seedSampleSources(_ samples: [SampleSourceInfo]) {
        var changed = false
        for s in samples where !sources.contains(where: { $0.id == s.id }) {
            sources.append(SourceConfig(id: s.id, name: s.name, type: .sample))
            changed = true
        }
        if changed { persist() }
    }

    public var sampleSourcesEnabled: Bool {
        let samples = sources.filter { $0.type == .sample }
        return !samples.isEmpty && samples.allSatisfy(\.enabled)
    }

    public func setSampleSourcesEnabled(_ on: Bool) {
        for i in sources.indices where sources[i].type == .sample { sources[i].enabled = on }
        persist()
    }

    public func add(_ source: SourceConfig, password: String?) throws {
        if let password, !password.isEmpty { try keychain.set(password, for: source.id) }
        sources.append(source)
        persist()
    }

    public func update(_ source: SourceConfig, password: String? = nil) throws {
        if let password, !password.isEmpty { try keychain.set(password, for: source.id) }
        guard let i = sources.firstIndex(where: { $0.id == source.id }) else { return }
        sources[i] = source
        persist()
    }

    public func setEnabled(_ id: String, _ on: Bool) {
        guard let i = sources.firstIndex(where: { $0.id == id }) else { return }
        sources[i].enabled = on
        persist()
    }

    public func remove(_ id: String) {
        sources.removeAll { $0.id == id }
        keychain.delete(id)
        RawCatalogCache().remove(id)
        persist()
    }

    public func markSynced(_ id: String, error: String?) {
        guard let i = sources.firstIndex(where: { $0.id == id }) else { return }
        if error == nil { sources[i].lastSyncAt = Date().timeIntervalSince1970 * 1000 }
        sources[i].lastError = error
        persist()
    }

    public func credentials(for source: SourceConfig) -> XtreamCredentials? {
        guard source.type == .xtream, let server = source.serverUrl, let user = source.username,
              let password = keychain.get(source.id) else { return nil }
        return XtreamCredentials(serverUrl: Xtream.normalizeServer(server), username: user, password: password)
    }

    public func hasPassword(_ id: String) -> Bool { keychain.get(id) != nil }

    public var sourceNames: [String: String] {
        Dictionary(sources.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
    }

    private func persist() {
        JSONStore.save(sources, to: fileURL)
    }
}
