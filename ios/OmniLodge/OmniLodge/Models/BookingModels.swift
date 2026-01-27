import Foundation

struct ManifestResponse: Decodable {
  let date: String
  let filters: ManifestFilters
  let orders: [UnifiedOrder]
  let manifest: [ManifestGroup]
  let summary: ManifestSummary
}

struct ManifestFilters: Decodable {
  let productId: String?
  let time: String?
  let search: String?
}

struct OrderExtras: Decodable {
  let tshirts: Int
  let cocktails: Int
  let photos: Int
}

struct PlatformBreakdownEntry: Decodable {
  let platform: String
  let totalPeople: Int
  let men: Int
  let women: Int
  let orderCount: Int
}

struct UnifiedOrder: Decodable, Identifiable {
  let id: String
  let platformBookingId: String
  let platformBookingUrl: String?
  let productId: String
  let productName: String
  let date: String
  let timeslot: String
  let quantity: Int
  let menCount: Int
  let womenCount: Int
  let customerName: String
  let customerPhone: String?
  let platform: String
  let pickupDateTime: String?
  let extras: OrderExtras?
  let status: String
}

struct ManifestGroup: Decodable, Identifiable {
  var id: String { "\(productId)-\(date)-\(time)" }
  let productId: String
  let productName: String
  let date: String
  let time: String
  let totalPeople: Int
  let men: Int
  let women: Int
  let extras: OrderExtras
  let orders: [UnifiedOrder]
  let platformBreakdown: [PlatformBreakdownEntry]
}

struct ManifestSummary: Decodable {
  let totalPeople: Int
  let men: Int
  let women: Int
  let totalOrders: Int
  let extras: OrderExtras
  let platformBreakdown: [PlatformBreakdownEntry]
  let statusCounts: [String: Int]
}
