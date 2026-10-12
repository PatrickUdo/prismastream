// Profiles and personal data (favorites, progress, history) plus app settings, persisted as one
// Codable JSON file in Application Support.

import Foundation
import Observation

public struct AppSettings: Codable, Sendable, Hashable {
    /// Accent colour as hex.
    public var accent: String = "#7c5cff"
    public var autoplayNext: Bool = true
    public var updatedAt: Double = 0

    public init() {}

    enum CodingKeys: String, CodingKey { case accent, autoplayNext, updatedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accent = c.value(.accent, default: "#7c5cff")
        autoplayNext = c.value(.autoplayNext, default: true)
        updatedAt = c.flexibleDouble(.updatedAt) ?? 0
    }
}

struct UserFile: Codable {
    var profiles: [Profile]
    var activeProfileId: String?
    var data: [String: ProfileData]
    var settings: AppSettings
}

@MainActor
@Observable
public final class UserStore {
    public private(set) var profiles: [Profile]
    public private(set) var activeProfileId: String
    private var dataByProfile: [String: ProfileData]
    public var settings: AppSettings { didSet { persist() } }

    private let fileURL: URL

    public init(fileURL: URL = AppPaths.root.appending(path: "user.json")) {
        self.fileURL = fileURL
        let file = JSONStore.load(UserFile.self, from: fileURL)
        var profiles = file?.profiles ?? []
        if profiles.isEmpty {
            profiles = [Profile(name: String(localized: "Ik"), avatar: "aurora", audioLangs: ["nl", "en"], subtitleLangs: ["nl"])]
        }
        self.profiles = profiles
        let active = file?.activeProfileId.flatMap { id in profiles.first { $0.id == id }?.id } ?? profiles[0].id
        activeProfileId = active
        dataByProfile = file?.data ?? [:]
        settings = file?.settings ?? AppSettings()
    }

    // MARK: Profiles

    public var activeProfile: Profile {
        profiles.first { $0.id == activeProfileId } ?? profiles.first ?? Profile(name: "Ik")
    }

    public func selectProfile(_ id: String) {
        guard profiles.contains(where: { $0.id == id }) else { return }
        activeProfileId = id
        persist()
    }

    @discardableResult
    public func createProfile(name: String, avatar: String, audioLangs: [LangCode], isKids: Bool = false) -> Profile {
        let p = Profile(name: name.isEmpty ? String(localized: "Profiel") : name, avatar: avatar, isKids: isKids,
                        audioLangs: audioLangs.isEmpty ? ["nl"] : audioLangs, subtitleLangs: [audioLangs.first ?? "nl"])
        profiles.append(p)
        persist()
        return p
    }

    public func updateProfile(_ p: Profile) {
        guard let i = profiles.firstIndex(where: { $0.id == p.id }) else { return }
        profiles[i] = p
        persist()
    }

    public func deleteProfile(_ id: String) {
        guard profiles.count > 1 else { return }
        profiles.removeAll { $0.id == id }
        dataByProfile[id] = nil
        if activeProfileId == id { activeProfileId = profiles[0].id }
        persist()
    }

    // MARK: Personal data (active profile)

    public var data: ProfileData { dataByProfile[activeProfileId] ?? ProfileData() }

    private func mutate(_ change: (inout ProfileData) -> Void) {
        var d = data
        change(&d)
        d.updatedAt = Date().timeIntervalSince1970 * 1000
        dataByProfile[activeProfileId] = d
        persist()
    }

    public func isFavorite(_ titleId: String) -> Bool { data.favorites.contains(titleId) }

    public func toggleFavorite(_ titleId: String) {
        mutate { d in
            if let i = d.favorites.firstIndex(of: titleId) { d.favorites.remove(at: i) } else { d.favorites.insert(titleId, at: 0) }
        }
    }

    public func isFavoriteChannel(_ id: String) -> Bool { data.favoriteChannels.contains(id) }

    public func toggleFavoriteChannel(_ id: String) {
        mutate { d in
            if let i = d.favoriteChannels.firstIndex(of: id) { d.favoriteChannels.remove(at: i) } else { d.favoriteChannels.append(id) }
        }
    }

    public func setLastChannel(_ id: String) {
        mutate { $0.lastChannelId = id }
    }

    public func progress(_ titleId: String, _ episodeId: String? = nil) -> WatchProgress? {
        data.progress[WatchProgress.key(titleId, episodeId)]
    }

    /// Latest progress of any episode of a series (for "Verder kijken").
    public func latestProgress(forTitle titleId: String) -> WatchProgress? {
        data.progress.values.filter { $0.titleId == titleId }.max { $0.updatedAt < $1.updatedAt }
    }

    public func saveProgress(titleId: String, episodeId: String?, variantId: String, position: Double, duration: Double) {
        guard position.isFinite, duration.isFinite, duration > 0 else { return }
        let entry = WatchProgress(titleId: titleId, episodeId: episodeId, variantId: variantId, positionSec: position,
                                  durationSec: duration, updatedAt: Date().timeIntervalSince1970 * 1000)
        mutate { d in d.progress[WatchProgress.key(titleId, episodeId)] = entry }
    }

    public func addHistory(titleId: String, episodeId: String?) {
        mutate { d in
            d.history.removeAll { $0.titleId == titleId && $0.episodeId == episodeId }
            d.history.insert(HistoryEntry(titleId: titleId, episodeId: episodeId, at: Date().timeIntervalSince1970 * 1000), at: 0)
            if d.history.count > 200 { d.history.removeLast(d.history.count - 200) }
        }
    }

    /// Unfinished items, newest first, one per title.
    public func continueWatching() -> [WatchProgress] {
        var seen = Set<String>()
        return data.progress.values
            .filter(\.isResumable)
            .sorted { $0.updatedAt > $1.updatedAt }
            .filter { seen.insert($0.titleId).inserted }
    }

    public var historyIds: [String] {
        var seen = Set<String>()
        return data.history.map(\.titleId).filter { seen.insert($0).inserted }
    }

    // MARK: Persistence

    private func persist() {
        let file = UserFile(profiles: profiles, activeProfileId: activeProfileId, data: dataByProfile, settings: settings)
        let url = fileURL
        guard let encoded = try? JSONEncoder().encode(file) else { return }
        // A serial queue keeps writes in order without blocking the main thread.
        Self.writeQueue.async {
            try? encoded.write(to: url, options: .atomic)
        }
    }

    private static let writeQueue = DispatchQueue(label: "nl.tuwi.prismastream.user-store", qos: .utility)
}
