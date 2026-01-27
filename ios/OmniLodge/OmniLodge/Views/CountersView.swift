import SwiftUI

struct CounterCreateRequest: Encodable {
  let date: String
}

struct CountersView: View {
  @EnvironmentObject var authStore: AuthStore
  @State private var selectedDate = Date()
  @State private var payload: CounterRegistryPayload?
  @State private var isLoading = false
  @State private var errorMessage: String?

  var body: some View {
    VStack(spacing: 16) {
      DatePicker("Date", selection: $selectedDate, displayedComponents: .date)
        .datePickerStyle(.compact)
        .padding(.horizontal)
        .onChange(of: selectedDate) { _ in
          Task { await loadCounter() }
        }

      if isLoading {
        ProgressView()
      } else if let errorMessage {
        Text(errorMessage)
          .foregroundColor(.red)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
      } else if let payload {
        List {
          Section("Counter") {
            HStack {
              Text("Status")
              Spacer()
              Text(payload.counter.status.capitalized)
            }
            HStack {
              Text("Manager")
              Spacer()
              Text(payload.counter.manager?.fullName ?? "-")
            }
            HStack {
              Text("Product")
              Spacer()
              Text(payload.counter.product?.name ?? "-")
            }
          }

          Section("Totals") {
            let totals = payload.derivedSummary.totals.people
            HStack {
              Text("Booked (Before)")
              Spacer()
              Text("\(totals.bookedBefore)")
            }
            HStack {
              Text("Booked (After)")
              Spacer()
              Text("\(totals.bookedAfter)")
            }
            HStack {
              Text("Attended")
              Spacer()
              Text("\(totals.attended)")
            }
            HStack {
              Text("No Show")
              Spacer()
              Text("\(totals.nonShow)")
            }
          }
        }
        .listStyle(.insetGrouped)
      } else {
        Text("No counter loaded.")
          .foregroundColor(.secondary)
      }
    }
    .navigationTitle("Counters")
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button("Refresh") {
          Task { await loadCounter() }
        }
      }
    }
    .task {
      await loadCounter()
    }
  }

  @MainActor
  private func loadCounter() async {
    guard let token = authStore.token else { return }
    isLoading = true
    errorMessage = nil
    do {
      let dateString = DateUtils.apiDateString(from: selectedDate)
      let body = CounterCreateRequest(date: dateString)
      let response: CounterRegistryPayload = try await APIClient.request(
        "/counters",
        method: "POST",
        query: ["format": "registry"],
        body: body,
        token: token
      )
      payload = response
    } catch {
      errorMessage = error.localizedDescription
      payload = nil
    }
    isLoading = false
  }
}

#Preview {
  NavigationStack { CountersView() }
}
