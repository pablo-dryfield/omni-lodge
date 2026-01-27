import SwiftUI

struct LoginView: View {
  @EnvironmentObject var authStore: AuthStore
  @State private var email = ""
  @State private var password = ""
  @State private var errorMessage: String?
  @State private var isLoading = false

  var body: some View {
    NavigationStack {
      VStack(spacing: 16) {
        Spacer()

        Text("Omni-Lodge")
          .font(.largeTitle)
          .fontWeight(.bold)

        VStack(spacing: 12) {
          TextField("Email", text: $email)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
            .autocorrectionDisabled()
            .textFieldStyle(.roundedBorder)

          SecureField("Password", text: $password)
            .textFieldStyle(.roundedBorder)
        }

        if let errorMessage {
          Text(errorMessage)
            .foregroundColor(.red)
            .multilineTextAlignment(.center)
        }

        Button {
          Task { await handleLogin() }
        } label: {
          if isLoading {
            ProgressView()
          } else {
            Text("Sign In")
              .frame(maxWidth: .infinity)
          }
        }
        .buttonStyle(.borderedProminent)
        .disabled(isLoading || email.isEmpty || password.isEmpty)

        Spacer()
      }
      .padding(24)
      .navigationTitle("Login")
    }
  }

  @MainActor
  private func handleLogin() async {
    errorMessage = nil
    isLoading = true
    do {
      try await authStore.login(email: email, password: password)
    } catch {
      errorMessage = error.localizedDescription
    }
    isLoading = false
  }
}

#Preview {
  LoginView()
}
