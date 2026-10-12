import XCTest

/// Opens a movie, starts playback and opens the "Taal en bron" transport-bar menu.
final class PlayerMenuUITests: XCTestCase {
    @MainActor
    func testTaalEnBronMenu() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(nl)", "-AppleLocale", "nl_NL"]
        app.launch()
        let remote = XCUIRemote.shared
        func shot(_ name: String) {
            let s = XCUIScreen.main.screenshot()
            let a = XCTAttachment(screenshot: s)
            a.name = name
            a.lifetime = .keepAlways
            add(a)
            if let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !dir.isEmpty {
                try? s.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
            }
        }
        XCTAssertTrue(app.buttons["hero.play"].waitForExistence(timeout: 30))
        // Hero "Nu kijken" plays the featured movie directly.
        for _ in 0..<4 where !app.buttons["hero.play"].hasFocus { remote.press(.down); Thread.sleep(forTimeInterval: 0.6) }
        remote.press(.select)
        Thread.sleep(forTimeInterval: 12)
        shot("06-player")
        remote.press(.select) // pause → transport bar
        Thread.sleep(forTimeInterval: 1.5)
        shot("07-player-transport")
        // The custom menu sits with the audio/subtitle buttons above the scrubber.
        func focusedLabel() -> String {
            let f = app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
            return f.exists ? f.label + "|" + f.identifier : ""
        }
        remote.press(.up)
        Thread.sleep(forTimeInterval: 0.8)
        var steps = 0
        while !focusedLabel().localizedCaseInsensitiveContains("taal") && steps < 6 {
            print("focus:", focusedLabel())
            remote.press(.left)
            Thread.sleep(forTimeInterval: 0.8)
            steps += 1
        }
        print("focus final:", focusedLabel())
        XCTAssertTrue(focusedLabel().localizedCaseInsensitiveContains("taal"), "knop Taal en bron heeft focus")
        remote.press(.select)
        Thread.sleep(forTimeInterval: 1.5)
        shot("08-player-taal-en-bron")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Demo'")).count > 0, "menu toont versies met bronnamen")

        // Switch to the English version; playback continues at the same position.
        remote.press(.down)
        Thread.sleep(forTimeInterval: 0.6)
        remote.press(.select)
        Thread.sleep(forTimeInterval: 5)
        remote.press(.up)
        Thread.sleep(forTimeInterval: 1)
        shot("08b-player-switched")
    }
}
