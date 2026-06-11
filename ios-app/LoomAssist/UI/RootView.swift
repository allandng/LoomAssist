import SwiftUI

struct RootView: View {
    @StateObject private var store = AppStore()
    @State private var tab: Int = {
        #if DEBUG
        // Screenshot-harness preset, not a user-facing setting.
        if ProcessInfo.processInfo.environment["LOOM_START_TAB"] == "tasks" { return 1 }
        #endif
        return 0
    }()

    var body: some View {
        TabView(selection: $tab) {
            // FLAGGED: SF Symbol tab icons approximate the product stroke set
            CalendarScreen()
                .tabItem { Label("Calendar", systemImage: "calendar") }
                .tag(0)
            TasksScreen()
                .tabItem { Label("Tasks", systemImage: "checklist") }
                .tag(1)
        }
        .environmentObject(store)
        .tint(LoomColor.accent)
        .background(LoomColor.bgMain)
    }
}
