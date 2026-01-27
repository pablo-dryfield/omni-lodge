import SwiftUI

struct ManifestView: View {
  @EnvironmentObject var authStore: AuthStore
  @State private var selectedDate = Date()
  @State private var manifest: ManifestResponse?
  @State private var isLoading = false
  @State private var errorMessage: String?

  var body: some View {
    VStack(spacing: 16) {
      DatePicker("Date", selection: $selectedDate, displayedComponents: .date)
        .datePickerStyle(.compact)
        .padding(.horizontal)
        .onChange(of: selectedDate) { _ in
          Task { await loadManifest() }
        }

      if isLoading {
        ProgressView()
      } else if let errorMessage {
        Text(errorMessage)
          .foregroundColor(.red)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
      } else if let manifest {
        List {
          Section("Summary") {
            HStack {
              Text("Total People")
              Spacer()
              Text("\(manifest.summary.totalPeople)")
            }
            HStack {
              Text("Total Orders")
              Spacer()
              Text("\(manifest.summary.totalOrders)")
            }
          }

          Section("Groups") {
            ForEach(manifest.manifest) { group in
              VStack(alignment: .leading, spacing: 6) {
                Text(group.productName)
                  .font(.headline)
                Text("Time: \(group.time) • People: \(group.totalPeople)")
                  .font(.subheadline)
                  .foregroundColor(.secondary)
                Text("Orders: \(group.orders.count)")
                  .font(.caption)
                  .foregroundColor(.secondary)
              }
              .padding(.vertical, 4)
            }
          }
        }
        .listStyle(.insetGrouped)
      } else {
        Text("No data yet.")
          .foregroundColor(.secondary)
      }
    }
    .navigationTitle("Manifest")
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button("Refresh") {
          Task { await loadManifest() }
        }
      }
    }
    .task {
      await loadManifest()
    }
  }

  @MainActor
  private func loadManifest() async {
    guard let token = authStore.token else { return }
    isLoading = true
    errorMessage = nil
    do {
      let dateString = DateUtils.apiDateString(from: selectedDate)
      let response: ManifestResponse = try await APIClient.request(
        "/bookings/manifest",
        query: ["date": dateString],
        token: token
      )
      manifest = response
    } catch {
      errorMessage = error.localizedDescription
      manifest = nil
    }
    isLoading = false
  }
}

#Preview {
  NavigationStack { ManifestView() }
}
