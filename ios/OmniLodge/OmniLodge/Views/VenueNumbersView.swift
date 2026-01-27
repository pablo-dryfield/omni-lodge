import SwiftUI

struct VenueNumbersView: View {
  @EnvironmentObject var authStore: AuthStore
  @State private var summary: VenuePayoutSummary?
  @State private var isLoading = false
  @State private var errorMessage: String?

  var body: some View {
    VStack(spacing: 16) {
      if isLoading {
        ProgressView()
      } else if let errorMessage {
        Text(errorMessage)
          .foregroundColor(.red)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
      } else if let summary {
        List {
          Section("Range") {
            Text("\(summary.range.startDate) to \(summary.range.endDate)")
              .font(.subheadline)
          }

          Section("Totals by Currency") {
            ForEach(summary.totalsByCurrency) { total in
              VStack(alignment: .leading, spacing: 4) {
                Text(total.currency)
                  .font(.headline)
                Text("Receivable: \(total.receivable, specifier: "%.2f")")
                  .font(.caption)
                  .foregroundColor(.secondary)
                Text("Payable: \(total.payable, specifier: "%.2f")")
                  .font(.caption)
                  .foregroundColor(.secondary)
                Text("Net: \(total.net, specifier: "%.2f")")
                  .font(.caption)
                  .foregroundColor(total.net >= 0 ? .green : .red)
              }
              .padding(.vertical, 4)
            }
          }
        }
        .listStyle(.insetGrouped)
      } else {
        Text("No summary loaded.")
          .foregroundColor(.secondary)
      }
    }
    .navigationTitle("Venue Numbers")
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button("Refresh") {
          Task { await loadSummary() }
        }
      }
    }
    .task {
      await loadSummary()
    }
  }

  @MainActor
  private func loadSummary() async {
    guard let token = authStore.token else { return }
    isLoading = true
    errorMessage = nil
    do {
      let response: ServerResponse<VenuePayoutSummary> = try await APIClient.request(
        "/venueNumbers/summary",
        query: ["period": "this_month"],
        token: token
      )
      summary = response.first?.data
    } catch {
      errorMessage = error.localizedDescription
      summary = nil
    }
    isLoading = false
  }
}

#Preview {
  NavigationStack { VenueNumbersView() }
}
