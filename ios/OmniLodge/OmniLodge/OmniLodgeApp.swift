import SwiftUI

@main
struct OmniLodgeApp: App {
  @StateObject private var authStore = AuthStore()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(authStore)
    }
  }
}
