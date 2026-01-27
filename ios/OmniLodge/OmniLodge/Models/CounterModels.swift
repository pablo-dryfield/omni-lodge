import Foundation

struct CounterRegistryPayload: Decodable {
  let counter: CounterPayload
  let staff: [CounterStaff]
  let metrics: [MetricCell]
  let derivedSummary: CounterSummary
  let addons: [AddonConfig]
  let channels: [ChannelConfig]
}

struct CounterPayload: Decodable {
  let id: Int
  let date: String
  let userId: Int
  let status: String
  let notes: String?
  let productId: Int?
  let createdAt: String
  let updatedAt: String
  let manager: CounterManager?
  let product: CounterProduct?
}

struct CounterManager: Decodable {
  let id: Int
  let firstName: String?
  let lastName: String?
  let fullName: String
}

struct CounterProduct: Decodable {
  let id: Int
  let name: String
}

struct CounterStaff: Decodable, Identifiable {
  var id: Int { userId }
  let userId: Int
  let role: String
  let name: String
  let userTypeSlug: String?
  let userTypeName: String?
}

struct MetricCell: Decodable, Identifiable {
  let id: Int?
  let counterId: Int
  let channelId: Int
  let kind: String
  let addonId: Int?
  let tallyType: String
  let period: String?
  let qty: Int

  var stableId: String {
    "\(channelId)-\(kind)-\(addonId ?? 0)-\(tallyType)-\(period ?? "attended")"
  }

  var identity: String {
    id.map { String($0) } ?? stableId
  }
}

struct AddonConfig: Decodable, Identifiable {
  var id: Int { addonId }
  let addonId: Int
  let name: String
  let key: String
  let maxPerAttendee: Int?
  let sortOrder: Int
}

struct ChannelConfig: Decodable, Identifiable {
  let id: Int
  let name: String
  let sortOrder: Int
  let paymentMethodId: Int?
  let paymentMethodName: String?
  let cashPrice: Double?
  let cashPaymentEligible: Bool
}

struct CounterSummary: Decodable {
  let byChannel: [CounterSummaryChannel]
  let totals: CounterSummaryTotals
}

struct CounterSummaryTotals: Decodable {
  let people: CounterSummaryPeopleBucket
  let addons: [String: CounterSummaryAddonBucket]
}

struct CounterSummaryChannel: Decodable, Identifiable {
  var id: Int { channelId }
  let channelId: Int
  let channelName: String
  let people: CounterSummaryPeopleBucket
  let addons: [String: CounterSummaryAddonBucket]
}

struct CounterSummaryPeopleBucket: Decodable {
  let bookedBefore: Int
  let bookedAfter: Int
  let attended: Int
  let nonShow: Int
}

struct CounterSummaryAddonBucket: Decodable {
  let addonId: Int
  let name: String
  let key: String
  let bookedBefore: Int
  let bookedAfter: Int
  let attended: Int
  let nonShow: Int
}
