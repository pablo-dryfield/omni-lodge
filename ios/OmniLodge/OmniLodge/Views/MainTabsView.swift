import SwiftUI

struct MainTabsView: View {
  var body: some View {
    TabView {
      NavigationStack {
        ManifestView()
      }
      .tabItem {
        Label("Manifest", systemImage: "list.bullet.rectangle")
      }

      NavigationStack {
        CountersView()
      }
      .tabItem {
        Label("Counters", systemImage: "chart.bar")
      }

      NavigationStack {
        VenueNumbersView()
      }
      .tabItem {
        Label("Venues", systemImage: "building.2")
      }

      NavigationStack {
        SettingsView()
      }
      .tabItem {
        Label("Settings", systemImage: "gear")
      }
    }
  }
}

#Preview {
  MainTabsView()
}
