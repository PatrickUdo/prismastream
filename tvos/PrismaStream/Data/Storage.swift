// File locations and small JSON persistence helpers (Application Support).

import Foundation
import os

public enum AppPaths {
    /// Application Support/PrismaStream (created on demand). tvOS may purge Caches, so the
    /// catalog cache lives in Application Support too.
    public static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dir = base.appending(path: "PrismaStream", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    public static var cache: URL {
        let dir = root.appending(path: "cache", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

public enum JSONStore {
    static let log = Logger(subsystem: "nl.patrickudo.prismastream.tv", category: "storage")

    public static func load<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            log.error("Kon \(url.lastPathComponent, privacy: .public) niet lezen: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    public static func save<T: Encodable>(_ value: T, to url: URL) {
        do {
            let data = try JSONEncoder().encode(value)
            try data.write(to: url, options: .atomic)
        } catch {
            log.error("Kon \(url.lastPathComponent, privacy: .public) niet opslaan: \(error.localizedDescription, privacy: .public)")
        }
    }
}

/// Raw catalog cache: one JSON file per source plus its fetch time; TTL 12 hours.
public struct RawCatalogCache: Sendable {
    public static let ttl: TimeInterval = 12 * 3600
    let directory: URL

    public init(directory: URL = AppPaths.cache) {
        self.directory = directory
    }

    private func file(_ sourceId: String) -> URL {
        let safe = sourceId.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" }
        return directory.appending(path: "raw-\(String(safe)).json")
    }

    public struct Entry: Sendable {
        public var json: String
        public var fetchedAt: Date
        public var isFresh: Bool { Date().timeIntervalSince(fetchedAt) < RawCatalogCache.ttl }
    }

    public func read(_ sourceId: String) -> Entry? {
        let url = file(sourceId)
        guard let data = try? Data(contentsOf: url), !data.isEmpty,
              let attrs = try? FileManager.default.attributesOfItem(atPath: url.path()),
              let date = attrs[.modificationDate] as? Date else { return nil }
        return Entry(json: String(decoding: data, as: UTF8.self), fetchedAt: date)
    }

    public func write(_ sourceId: String, json: String) {
        try? Data(json.utf8).write(to: file(sourceId), options: [.atomic])
    }

    public func remove(_ sourceId: String) {
        try? FileManager.default.removeItem(at: file(sourceId))
    }
}
