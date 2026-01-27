import Foundation

enum DateUtils {
  static let apiFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter
  }()

  static func apiDateString(from date: Date) -> String {
    apiFormatter.string(from: date)
  }
}
