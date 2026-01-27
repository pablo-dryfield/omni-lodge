import Foundation

struct LoginRequest: Encodable {
  let email: String
  let password: String
}

struct LoginResponseItem: Decodable {
  let message: String
  let userId: Int
  let token: String?
}

struct MessageResponseItem: Decodable {
  let message: String
}

enum AuthService {
  static func login(email: String, password: String) async throws -> LoginResponseItem {
    let body = LoginRequest(email: email, password: password)
    let response: [LoginResponseItem] = try await APIClient.request(
      "/users/login",
      method: "POST",
      body: body
    )
    guard let first = response.first else {
      throw APIError.emptyPayload
    }
    return first
  }

  static func logout(token: String?) async throws {
    let _: [MessageResponseItem] = try await APIClient.request(
      "/users/logout",
      method: "POST",
      token: token
    )
  }
}
