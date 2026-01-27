import Foundation

enum AppConfig {
  static var baseURL: URL {
    if let raw = Bundle.main.object(forInfoDictionaryKey: "OMNI_BASE_URL") as? String,
       let url = URL(string: raw) {
      return url
    }
    return URL(string: "http://localhost:3001/api")!
  }
}
