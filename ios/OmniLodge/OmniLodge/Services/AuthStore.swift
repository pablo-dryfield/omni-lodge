import Foundation

@MainActor
final class AuthStore: ObservableObject {
  @Published private(set) var token: String?
  @Published private(set) var userId: Int?
  @Published private(set) var isAuthenticated: Bool = false

  private let keychain = KeychainStore()
  private let userDefaultsKey = "omni.userId"

  init() {
    loadFromStorage()
  }

  func loadFromStorage() {
    token = keychain.readToken()
    if let storedId = UserDefaults.standard.object(forKey: userDefaultsKey) as? Int {
      userId = storedId
    }
    isAuthenticated = (token?.isEmpty == false)
  }

  func login(email: String, password: String) async throws {
    let response = try await AuthService.login(email: email, password: password)
    guard let token = response.token, !token.isEmpty else {
      throw APIError.emptyPayload
    }
    keychain.saveToken(token)
    tokenDidUpdate(token: token, userId: response.userId)
  }

  func logout() async {
    do {
      try await AuthService.logout(token: token)
    } catch {
      // Ignore logout errors; we still clear local auth.
    }
    clear()
  }

  private func tokenDidUpdate(token: String, userId: Int) {
    self.token = token
    self.userId = userId
    UserDefaults.standard.set(userId, forKey: userDefaultsKey)
    isAuthenticated = true
  }

  private func clear() {
    keychain.deleteToken()
    token = nil
    userId = nil
    UserDefaults.standard.removeObject(forKey: userDefaultsKey)
    isAuthenticated = false
  }
}
