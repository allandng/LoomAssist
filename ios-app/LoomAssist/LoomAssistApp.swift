import SwiftUI

@main
struct LoomAssistApp: App {
    init() {
        #if DEBUG
        LiveAuthProbe.runIfRequested()
        LiveSyncProbe.runIfRequested()
        LiveVoiceProbe.runIfRequested()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
