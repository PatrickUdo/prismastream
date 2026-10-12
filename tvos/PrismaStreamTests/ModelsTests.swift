import XCTest
@testable import PrismaStream

final class ModelsTests: XCTestCase {
    func testTitleDecodingIsTolerant() throws {
        let json = """
        {"id":"tmdb-m-1","kind":"movie","title":"De Matrix","unknownField":{"x":1},
         "altTitles":[{"title":"The Matrix","lang":"en"},"Matrix"],
         "year":"1999","genres":["Sciencefiction"],"rating":"8.7",
         "cast":["Keanu Reeves",{"name":"Carrie-Anne Moss","character":"Trinity"},42],
         "addedAt":1,"popularity":90,
         "variants":[{"id":"a:1","sourceId":"a","url":"http://x/1.m3u8","audioLangs":["nl"],"subtitleLangs":[],"quality":"8K","label":"NL"},
                     {"broken":true}],
         "languages":["nl","en"],"subtitleLanguages":[],"qualities":["4K","HD","weird"],"sourceIds":["a"],"rawRefs":[]}
        """
        let t = try JSONDecoder().decode(Title.self, from: Data(json.utf8))
        XCTAssertEqual(t.year, 1999)
        XCTAssertEqual(t.rating, 8.7)
        XCTAssertEqual(t.altTitles.count, 2)
        XCTAssertEqual(t.cast.map(\.name), ["Keanu Reeves", "Carrie-Anne Moss"])
        XCTAssertEqual(t.variants.count, 1, "kapotte variant wordt overgeslagen")
        XCTAssertEqual(t.variants[0].quality, .unknown)
        XCTAssertEqual(t.bestQuality, .uhd)
        XCTAssertNil(t.seasons)
        XCTAssertNil(t.overview)
    }

    func testMissingOptionalArraysDefaultToEmpty() throws {
        let t = try JSONDecoder().decode(Title.self, from: Data(#"{"id":"x","kind":"series","title":"Y"}"#.utf8))
        XCTAssertEqual(t.kind, .series)
        XCTAssertTrue(t.genres.isEmpty)
        XCTAssertTrue(t.variants.isEmpty)
        XCTAssertNil(t.seasons)
    }

    func testCatalogWithEpgAndChannels() throws {
        let json = """
        {"titles":[],"channels":[{"id":"c1","name":"Prisma 1","group":"Ent","number":"1","languages":["nl"],"variants":[]}],
         "epg":{"p1":[{"channelId":"p1","start":1000,"stop":2000,"title":"Nieuws"},{"bad":1}]},"builtAt":5}
        """
        let c = try JSONDecoder().decode(Catalog.self, from: Data(json.utf8))
        XCTAssertEqual(c.channels.first?.number, 1)
        XCTAssertEqual(c.channels.first?.initials, "P1")
        XCTAssertEqual(c.epg["p1"]?.count, 2)
        let p = EpgProgramme(channelId: "p1", start: 0, stop: 10_000, title: "x")
        XCTAssertEqual(p.progress(at: Date(timeIntervalSince1970: 5)), 0.5, accuracy: 0.001)
    }

    func testTitleRoundTripKeepsContractShape() throws {
        var t = Title(id: "k-1", kind: .movie, title: "A")
        t.variants = [StreamVariant(id: "s:1", sourceId: "s", url: "http://x", audioLangs: ["nl"], quality: .fhd)]
        let data = try JSONEncoder().encode(t)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["kind"] as? String, "movie")
        let v = try XCTUnwrap((obj["variants"] as? [[String: Any]])?.first)
        XCTAssertEqual(v["quality"] as? String, "FHD")
        let back = try JSONDecoder().decode(Title.self, from: data)
        XCTAssertEqual(back, t)
    }

    func testSearchResultsAcceptIdsOrObjects() throws {
        let json = #"{"movies":[{"id":"a","title":"A"}],"series":["b"],"people":[{"name":"P","titles":[{"id":"a"}]}],"channels":[],"genres":["Drama"],"akas":{"a":"Alpha"}}"#
        let r = try JSONDecoder().decode(SearchResults.self, from: Data(json.utf8))
        XCTAssertEqual(r.movies.first?.id, "a")
        XCTAssertEqual(r.series.first?.id, "b")
        XCTAssertEqual(r.people.first?.titles.first?.id, "a")
        XCTAssertEqual(r.akas["a"], "Alpha")
    }

    func testWatchProgressResumable() {
        let p = WatchProgress(titleId: "t", episodeId: nil, variantId: "v", positionSec: 754, durationSec: 3600, updatedAt: 0)
        XCTAssertTrue(p.isResumable)
        XCTAssertEqual(Format.clock(754), "12:34")
        XCTAssertFalse(WatchProgress(titleId: "t", episodeId: nil, variantId: "v", positionSec: 3500, durationSec: 3600, updatedAt: 0).isResumable)
    }

    func testLanguageBadge() {
        XCTAssertEqual(Lang.badge(["en", "nl", "fr", "de", "es"], preferred: ["nl"]), "NL EN FR +2")
        XCTAssertEqual(Lang.badge(["und"], preferred: ["nl"]), "")
    }

    func testGzipDecoding() throws {
        // "hello prisma\n" gzipped (python: gzip.compress(b"hello prisma\n", mtime=0)).
        let bytes: [UInt8] = [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x57, 0x28, 0x28, 0xca, 0x2c, 0xce, 0x4d, 0xe4, 0x02, 0x00, 0xaf, 0x15, 0xda, 0x9b, 0x0d, 0x00, 0x00, 0x00]
        XCTAssertTrue(Gzip.isGzip(Data(bytes)))
        XCTAssertEqual(try Fetcher.decodeText(Data(bytes)), "hello prisma\n")
        XCTAssertEqual(try Fetcher.decodeText(Data("plain".utf8)), "plain")
    }

    func testXtreamServerNormalisation() {
        XCTAssertEqual(Xtream.normalizeServer("panel.example:8080/player_api.php"), "http://panel.example:8080")
        XCTAssertEqual(Xtream.normalizeServer("https://x.tv/"), "https://x.tv")
        let url = Xtream.apiURL(XtreamCredentials(serverUrl: "x.tv", username: "u", password: "p&w"), action: "get_vod_streams")
        XCTAssertEqual(url?.absoluteString, "http://x.tv/player_api.php?username=u&password=p%26w&action=get_vod_streams")
    }
}
