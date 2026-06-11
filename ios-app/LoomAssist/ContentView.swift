import SwiftUI
import LoomKit

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "calendar.badge.checkmark")
                .font(.system(size: 56))
                .foregroundStyle(.indigo)
            Text("LoomAssist")
                .font(.largeTitle.bold())
            Text("LoomKit \(LoomKit.version) · sync schema v\(LoomKit.syncSchemaVersion)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
