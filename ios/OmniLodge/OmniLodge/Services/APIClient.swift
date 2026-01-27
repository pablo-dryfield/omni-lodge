import Foundation

enum APIError: Error, LocalizedError {
  case invalidURL
  case invalidResponse
  case server(status: Int, message: String)
  case emptyPayload

  var errorDescription: String? {
    switch self {
    case .invalidURL:
      return "Invalid URL"
    case .invalidResponse:
      return "Invalid response"
    case .server(let status, let message):
      return "Server error (\(status)): \(message)"
    case .emptyPayload:
      return "Empty payload"
    }
  }
}

struct APIClient {
  static func request<T: Decodable>(
    _ path: String,
    method: String = "GET",
    query: [String: String?] = [:],
    token: String? = nil
  ) async throws -> T {
    let request = try buildRequest(path: path, method: method, query: query, token: token)
    return try await send(request)
  }

  static func request<T: Decodable, Body: Encodable>(
    _ path: String,
    method: String,
    query: [String: String?] = [:],
    body: Body,
    token: String? = nil
  ) async throws -> T {
    var request = try buildRequest(path: path, method: method, query: query, token: token)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    return try await send(request)
  }

  private static func buildRequest(
    path: String,
    method: String,
    query: [String: String?],
    token: String?
  ) throws -> URLRequest {
    let cleanPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
    var components = URLComponents(url: AppConfig.baseURL.appendingPathComponent(cleanPath), resolvingAgainstBaseURL: false)
    let queryItems = query.compactMap { key, value -> URLQueryItem? in
      guard let value else { return nil }
      return URLQueryItem(name: key, value: value)
    }
    if !queryItems.isEmpty {
      components?.queryItems = queryItems
    }
    guard let url = components?.url else {
      throw APIError.invalidURL
    }

    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    return request
  }

  private static func send<T: Decodable>(_ request: URLRequest) async throws -> T {
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }
    guard (200...299).contains(httpResponse.statusCode) else {
      let message = String(data: data, encoding: .utf8) ?? "Unknown error"
      throw APIError.server(status: httpResponse.statusCode, message: message)
    }

    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(T.self, from: data)
  }
}
