import SwiftUI

struct ContentView: View {
  @EnvironmentObject var authStore: AuthStore

  var body: some View {
    Group {
      if authStore.isAuthenticated {
        MainTabsView()
      } else {
        LoginView()
      }
    }
  }
}

#Preview {
  ContentView()
}
