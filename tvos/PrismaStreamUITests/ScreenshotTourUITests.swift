import XCTest

/// Walks through the main screens with the remote and saves screenshots (to $SCREENSHOT_DIR when
/// set, always as test attachments). Run: TEST_RUNNER_SCREENSHOT_DIR=… xcodebuild test -only-testing:PrismaStreamUITests/ScreenshotTourUITests
final class ScreenshotTourUITests: XCTestCase {
    @MainActor var remote: XCUIRemote { XCUIRemote.shared }

    override func setUp() {
        continueAfterFailure = true
    }

    @MainActor
    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !dir.isEmpty {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    @MainActor
    private func launch(_ args: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(nl)", "-AppleLocale", "nl_NL"] + args
        app.launch()
        return app
    }

    @MainActor
    private func focused(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
    }

    @MainActor
    private func press(_ button: XCUIRemote.Button, _ times: Int = 1, wait: TimeInterval = 0.7) {
        for _ in 0..<times {
            remote.press(button)
            Thread.sleep(forTimeInterval: wait)
        }
    }

    @MainActor
    func testTourHomeDetail() throws {
        let app = launch()
        XCTAssertTrue(app.buttons["hero.play"].waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 2)
        shot("01-home")

        for _ in 0..<6 where !focused(app).identifier.hasPrefix("card.") { press(.down) }
        press(.right)
        Thread.sleep(forTimeInterval: 1)
        shot("02-home-shelves")

        press(.select)
        XCTAssertTrue(app.buttons["detail.play"].waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 2)
        shot("03-detail")

        press(.down, 2)
        Thread.sleep(forTimeInterval: 1)
        shot("04-detail-versions")
        press(.down, 3)
        Thread.sleep(forTimeInterval: 1)
        shot("05-detail-more")

    }

    @MainActor
    func testTourLiveAndSearch() throws {
        var app = launch(["-startTab", "live"])
        XCTAssertTrue(app.buttons["live.watch"].waitForExistence(timeout: 30))
        press(.down, 2)
        Thread.sleep(forTimeInterval: 1)
        shot("09-live")
        press(.select, wait: 3)
        shot("10-live-player")
        press(.down, wait: 2.5)
        shot("10b-live-zap")
        press(.select, wait: 1.5)
        shot("11-live-zenderlijst")
        app.terminate()

        app = launch(["-startTab", "live", "-liveMode", "guide"])
        Thread.sleep(forTimeInterval: 6)
        press(.down, 3)
        Thread.sleep(forTimeInterval: 1)
        shot("12-epg")
        app.terminate()

        app = launch(["-startTab", "search", "-searchQuery", "licht"])
        Thread.sleep(forTimeInterval: 6)
        shot("13-search")
        app.terminate()

        app = launch(["-startTab", "movies"])
        Thread.sleep(forTimeInterval: 5)
        press(.down, 2)
        shot("14-films")
        app.terminate()

        app = launch(["-openTitle", "tmdb-s-920012"])
        XCTAssertTrue(app.buttons["detail.play"].waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 2)
        for _ in 0..<12 where !focused(app).identifier.hasPrefix("episode.") { press(.down) }
        Thread.sleep(forTimeInterval: 1)
        shot("05b-series-episodes")
        app.terminate()

        app = launch(["-startTab", "settings"])
        Thread.sleep(forTimeInterval: 4)
        press(.down)
        shot("15-settings")
    }
}
