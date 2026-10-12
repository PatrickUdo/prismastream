// Minimal Keychain wrapper for source passwords. Secrets never touch UserDefaults, the disk
// cache metadata or logs; they are stored as generic passwords keyed by source id.

import Foundation
import Security

public enum KeychainError: LocalizedError, Equatable {
    case unexpectedStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let s): String(localized: "Sleutelhanger-fout (\(Int(s)))")
        }
    }
}

public struct Keychain: Sendable {
    public let service: String

    public init(service: String = "nl.tuwi.prismastream.tv.sources") {
        self.service = service
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    public func set(_ value: String, for account: String) throws {
        let data = Data(value.utf8)
        let query = baseQuery(account)
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
    }

    public func get(_ account: String) -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public func delete(_ account: String) -> Bool {
        let status = SecItemDelete(baseQuery(account) as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
