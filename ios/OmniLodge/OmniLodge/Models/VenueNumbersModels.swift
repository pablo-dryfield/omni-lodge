import Foundation

struct VenueLedgerSnapshot: Decodable {
  let opening: Double
  let due: Double
  let paid: Double
  let closing: Double
}

struct VenuePayoutCurrencyTotals: Decodable, Identifiable {
  var id: String { currency }
  let currency: String
  let receivable: Double
  let receivableCollected: Double
  let receivableOutstanding: Double
  let payable: Double
  let payableCollected: Double
  let payableOutstanding: Double
  let net: Double
  let receivableLedger: VenueLedgerSnapshot
  let payableLedger: VenueLedgerSnapshot
}

struct VenuePayoutVenueDaily: Decodable, Identifiable {
  var id: String { "\(date)-\(reportId ?? 0)-\(direction)" }
  let date: String
  let reportId: Int?
  let totalPeople: Int
  let amount: Double
  let direction: String
  let normalCount: Int
  let cocktailsCount: Int
  let brunchCount: Int
}

struct VenuePayoutVenueBreakdown: Decodable, Identifiable {
  let rowKey: String
  var id: String { rowKey }
  let venueId: Int?
  let venueName: String
  let currency: String
  let allowsOpenBar: Bool?
  let receivable: Double
  let receivableCollected: Double
  let receivableOutstanding: Double
  let payable: Double
  let payableCollected: Double
  let payableOutstanding: Double
  let net: Double
  let totalPeople: Int
  let totalPeopleReceivable: Int
  let totalPeoplePayable: Int
  let daily: [VenuePayoutVenueDaily]
  let receivableLedger: VenueLedgerSnapshot
  let payableLedger: VenueLedgerSnapshot
}

struct VenuePayoutSummary: Decodable {
  let period: String
  let range: VenuePayoutRange
  let totalsByCurrency: [VenuePayoutCurrencyTotals]
  let venues: [VenuePayoutVenueBreakdown]
  let rangeIsCanonical: Bool?
}

struct VenuePayoutRange: Decodable {
  let startDate: String
  let endDate: String
}
