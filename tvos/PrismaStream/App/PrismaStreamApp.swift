import SwiftUI

@main
struct PrismaStreamApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(\.accent, Color(hex: app.user.settings.accent))
                .tint(Color(hex: app.user.settings.accent))
                .preferredColorScheme(.dark)
        }
    }
}
