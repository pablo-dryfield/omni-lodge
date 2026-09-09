import type { UnifiedOrder } from "../store/bookingPlatformsTypes";
import {
  canUseStripeRefundActions,
  getBookingPaymentMethod,
  getBookingPaymentStatus,
  isBankTransferBooking,
  isExplicitlyUnpaidBooking,
} from "./bookingPayment";

const buildOrder = (overrides: Partial<UnifiedOrder> = {}): UnifiedOrder => ({
  id: "1",
  platformBookingId: "ORDER-1",
  productId: "product-1",
  productName: "Pub Crawl",
  date: "2026-09-07",
  timeslot: "21:00",
  quantity: 2,
  menCount: 1,
  womenCount: 1,
  customerName: "Test Guest",
  platform: "omnilodge",
  status: "confirmed",
  ...overrides,
});

describe("booking payment policy", () => {
  it("prefers typed payment fields and normalizes their values", () => {
    const order = buildOrder({
      paymentStatus: "Awaiting Transfer",
      paymentMethod: "Bank Transfer",
      rawData: { paymentStatus: "paid", paymentMethod: "stripe" },
    });

    expect(getBookingPaymentStatus(order)).toBe("awaiting_transfer");
    expect(getBookingPaymentMethod(order)).toBe("bank_transfer");
    expect(isExplicitlyUnpaidBooking(order)).toBe(true);
    expect(isBankTransferBooking(order)).toBe(true);
  });

  it("supports legacy raw payment fields", () => {
    const order = buildOrder({
      rawData: { payment_status: "UNPAID", payment_method: "bank-transfer" },
    });

    expect(isExplicitlyUnpaidBooking(order)).toBe(true);
    expect(isBankTransferBooking(order)).toBe(true);
  });

  it("hides Stripe refund actions for paid bank transfers and unpaid Stripe bookings", () => {
    expect(canUseStripeRefundActions(buildOrder({ paymentStatus: "paid", paymentMethod: "bank_transfer" }))).toBe(false);
    expect(canUseStripeRefundActions(buildOrder({ paymentStatus: "unpaid", paymentMethod: "stripe" }))).toBe(false);
    expect(canUseStripeRefundActions(buildOrder({ paymentStatus: "paid", paymentMethod: "stripe" }))).toBe(true);
  });
});
