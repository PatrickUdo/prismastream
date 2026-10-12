import XCTest
@testable import PrismaStream

final class KeychainTests: XCTestCase {
    let keychain = Keychain(service: "nl.tuwi.prismastream.tv.tests")

    override func tearDown() {
        keychain.delete("acc")
        super.tearDown()
    }

    func testSetGetUpdateDelete() throws {
        XCTAssertNil(keychain.get("acc"))
        try keychain.set("geheim", for: "acc")
        XCTAssertEqual(keychain.get("acc"), "geheim")
        try keychain.set("nieuw", for: "acc")
        XCTAssertEqual(keychain.get("acc"), "nieuw")
        XCTAssertTrue(keychain.delete("acc"))
        XCTAssertNil(keychain.get("acc"))
        XCTAssertTrue(keychain.delete("acc"), "verwijderen van iets dat niet bestaat is geen fout")
    }

    @MainActor
    func testSourceStoreKeepsPasswordOutOfFile() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "sources-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: file) }
        let store = SourceStore(keychain: keychain, fileURL: file)
        let src = SourceConfig(id: "acc", name: "Test", type: .xtream, serverUrl: "http://x.tv", username: "u")
        try store.add(src, password: "supergeheim")
        let disk = try String(contentsOf: file, encoding: .utf8)
        XCTAssertFalse(disk.contains("supergeheim"))
        XCTAssertEqual(store.credentials(for: src)?.password, "supergeheim")
        store.remove("acc")
        XCTAssertNil(keychain.get("acc"))
    }
}
