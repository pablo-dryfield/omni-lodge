import SwiftUI

struct SettingsView: View {
  @EnvironmentObject var authStore: AuthStore

  var body: some View {
    Form {
      Section("Account") {
        HStack {
          Text("User ID")
          Spacer()
          Text(authStore.userId.map(String.init) ?? "-")
            .foregroundColor(.secondary)
        }
      }

      Section {
        Button(role: .destructive) {
          Task { await authStore.logout() }
        } label: {
          Text("Sign Out")
        }
      }
    }
    .navigationTitle("Settings")
  }
}

#Preview {
  NavigationStack { SettingsView() }
}
