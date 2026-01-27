import Foundation

typealias ServerResponse<T: Decodable> = [ServerResponseItem<T>]

struct ServerResponseItem<T: Decodable>: Decodable {
  let data: T
}
