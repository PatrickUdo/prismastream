import XCTest

/// Drives the app with the Siri Remote: down / right / select from Home must open a detail page.
final class FocusFlowUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testRemoteNavigatesFromHomeToDetail() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(nl)", "-AppleLocale", "nl_NL"]
        app.launch()
        let remote = XCUIRemote.shared

        // Wait for the catalog: the hero's play button appears.
        XCTAssertTrue(app.buttons["hero.play"].waitForExistence(timeout: 30), "Home met hero verschijnt")

        // Move down until a poster card has focus (from the tab bar or the hero).
        var focusedCard = false
        for _ in 0..<6 {
            remote.press(.down)
            Thread.sleep(forTimeInterval: 0.6)
            let focused = app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
            if focused.exists, focused.identifier.hasPrefix("card.") {
                focusedCard = true
                break
            }
        }
        XCTAssertTrue(focusedCard, "een poster heeft focus na omlaag")

        remote.press(.right)
        Thread.sleep(forTimeInterval: 0.6)
        let focused = app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
        XCTAssertTrue(focused.identifier.hasPrefix("card."), "focus blijft op een poster na rechts")

        remote.press(.select)

        // The detail page with the versions panel opens.
        XCTAssertTrue(app.buttons["detail.play"].waitForExistence(timeout: 10), "detailpagina opent")
        XCTAssertTrue(app.descendants(matching: .any)["detail.versions"].waitForExistence(timeout: 10), "versiepaneel staat op de detailpagina")
    }
}
