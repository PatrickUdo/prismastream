import XCTest
@testable import PrismaStream

final class CoreEngineTests: XCTestCase {
    func testLoadsBundleAndReportsVersion() async throws {
        let engine = CoreEngine()
        let error = await engine.load()
        XCTAssertNil(error, "prisma-core.js moet laden: \(String(describing: error))")
        let version = try await engine.version()
        XCTAssertFalse(version.isEmpty)
        XCTAssertFalse(version.hasPrefix("\""), "plain string, geen JSON")
    }

    func testMissingBundleGivesFriendlyError() async {
        let engine = CoreEngine(scriptURL: nil)
        let error = await engine.load()
        XCTAssertEqual(error, .bundleMissing)
        do {
            _ = try await engine.version()
            XCTFail("verwacht een fout")
        } catch let e as CoreError {
            XCTAssertEqual(e, .bundleMissing)
            XCTAssertNotNil(e.errorDescription)
        } catch {
            XCTFail("onverwachte fout \(error)")
        }
    }

    func testBuildCatalogOnSampleData() async throws {
        let engine = CoreEngine()
        let bySource = try await engine.sampleCatalogsBySource()
        XCTAssertEqual(bySource.count, 3)
        let catalog = try await engine.buildCatalog(rawJSON: Array(bySource.values), options: .init(preferLang: "nl"))
        XCTAssertGreaterThan(catalog.titles.count, 50)
        XCTAssertGreaterThan(catalog.channels.count, 10)
        XCTAssertFalse(catalog.epg.isEmpty)
        // Every title once.
        XCTAssertEqual(Set(catalog.titles.map(\.id)).count, catalog.titles.count)
        // Movies have variants in several languages.
        let multi = catalog.titles.filter { $0.kind == .movie && Set($0.variants.map(\.primaryLang)).count > 2 }
        XCTAssertFalse(multi.isEmpty)
    }

    func testDisplayTitleDutchAndPickVariant() async throws {
        let engine = CoreEngine()
        let raws = try await engine.sampleCatalogsBySource()
        let catalog = try await engine.buildCatalog(rawJSON: Array(raws.values), options: .init(preferLang: "nl"))
        // A title with a distinct Dutch alternative title.
        let title = try XCTUnwrap(catalog.titles.first { t in
            t.altTitles.contains { $0.lang == "nl" && $0.title != t.title }
        })
        let dutch = try XCTUnwrap(title.altTitles.first { $0.lang == "nl" }?.title)
        let display = try await engine.displayTitle(title, prefs: DisplayPrefs(uiLang: "nl", audioLangs: ["nl"]))
        XCTAssertEqual(display, dutch)

        let movie = try XCTUnwrap(catalog.titles.first { $0.kind == .movie && $0.variants.contains { $0.audioLangs.contains("nl") } })
        let picked = try await engine.pickVariant(movie.variants, prefs: LangPrefs(audioLangs: ["nl", "en"], subtitleLangs: [], subtitlesOn: false), title: movie)
        XCTAssertEqual(picked?.audioLangs.first, "nl")
        let none = try await engine.pickVariant([], prefs: LangPrefs(audioLangs: ["nl"], subtitleLangs: [], subtitlesOn: false))
        XCTAssertNil(none)

        let summary = try await engine.summarizeLanguages(movie)
        XCTAssertFalse(summary.isEmpty)
        let groups = try await engine.groupVariantsByLanguage(movie.variants)
        XCTAssertFalse(groups.isEmpty)

        let texts = try await engine.batchTitleTexts(prefs: DisplayPrefs(uiLang: "nl", audioLangs: ["nl"]))
        XCTAssertEqual(texts.display.count, catalog.titles.count)
        XCTAssertEqual(texts.display[title.id], dutch)
    }

    func testSearchAndRecommend() async throws {
        let engine = CoreEngine()
        let raws = try await engine.sampleCatalogsBySource()
        let catalog = try await engine.buildCatalog(rawJSON: Array(raws.values), options: .init(preferLang: "nl"))
        let first = try XCTUnwrap(catalog.titles.first)
        let word = String(first.title.split(separator: " ").first ?? "")
        let results = try await engine.search(word, limit: 20)
        XCTAssertFalse(results.isEmpty)
        let ids = (results.movies + results.series).map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "elke titel één keer")
        let recommended = try await engine.recommend(history: [], favorites: [])
        XCTAssertFalse(recommended.isEmpty)
    }

    func testJSErrorsBecomeCoreErrors() async {
        let engine = CoreEngine()
        do {
            // An Xtream account with auth 0 makes the core throw an HttpError.
            let ctx = CoreEngine.XtreamContext(sourceId: "x", serverUrl: "http://x.tv", username: "u", password: "p")
            _ = try await engine.xtreamMap(kind: "account", json: #"{"user_info":{"auth":0}}"#, context: ctx)
            XCTFail("verwacht een fout")
        } catch let e as CoreError {
            if case .js = e {} else { XCTFail("verwacht .js, kreeg \(e)") }
        } catch {
            XCTFail("onverwachte fout \(error)")
        }
    }

    func testParseM3U() async throws {
        let engine = CoreEngine()
        let m3u = """
        #EXTM3U url-tvg="http://epg.example/guide.xml.gz"
        #EXTINF:-1 tvg-id="npo1.nl" tvg-name="NPO 1" group-title="NL | Algemeen",NL: NPO 1 HD
        http://example.com/live/1.m3u8
        #EXTINF:-1 group-title="NL | Films",NL - De Matrix (1999)
        http://example.com/movie/2.mp4
        """
        let parsed = try await engine.parseM3U(text: m3u, sourceId: "m3u-test")
        XCTAssertEqual(parsed.epgUrl, "http://epg.example/guide.xml.gz")
        let raw = try JSONDecoder().decode(RawCatalog.self, from: Data(parsed.catalogJSON.utf8))
        XCTAssertEqual(raw.channels.count, 1)
        XCTAssertEqual(raw.movies.count, 1)
    }
}
