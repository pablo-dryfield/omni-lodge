import type {
  BookingEventType,
  BookingPaymentStatus,
  BookingPlatform,
  BookingStatus,
  NormalizedAddonInput,
} from '../../constants/bookings.js';

export type BookingFieldPatch = Partial<{
  channelId: number | null;
  productId: number | null;
  productName: string | null;
  productVariant: string | null;
  guestId: number | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  pickupLocation: string | null;
  hotelName: string | null;
  partySizeTotal: number | null;
  partySizeAdults: number | null;
  partySizeChildren: number | null;
  partySizeTotalDelta: number | null;
  partySizeAdultsDelta: number | null;
  experienceDate: string | null;
  experienceStartAt: Date | null;
  experienceEndAt: Date | null;
  currency: string | null;
  baseAmount: number | string | null;
  addonsAmount: number | string | null;
  discountAmount: number | string | null;
  priceGross: number | string | null;
  priceNet: number | string | null;
  commissionAmount: number | string | null;
  commissionRate: number | string | null;
  paymentMethod: string | null;
  notes: string | null;
  addonsSnapshot: Record<string, unknown> | null;
  addonsExtrasDelta: Record<string, number> | null;
  rawPayloadLocation: string | null;
}>;

export type BookingParserContext = {
  messageId: string;
  threadId?: string | null;
  historyId?: string | null;
  subject?: string | null;
  snippet?: string | null;
  from?: string | null;
  to?: string | null;
  cc?: string | null;
  receivedAt?: Date | null;
  internalDate?: Date | null;
  headers: Record<string, string>;
  textBody: string;
  rawTextBody?: string | null;
  htmlBody?: string | null;
};

export type ParsedBookingEvent = {
  platform: BookingPlatform;
  platformBookingId: string;
  platformOrderId?: string | null;
  status: BookingStatus;
  paymentStatus?: BookingPaymentStatus;
  eventType: BookingEventType;
  bookingFields?: BookingFieldPatch;
  addons?: NormalizedAddonInput[];
  notes?: string | null;
  occurredAt?: Date | null;
  sourceReceivedAt?: Date | null;
  rawPayload?: Record<string, unknown> | null;
  spawnedEvents?: ParsedBookingEvent[];
};

export interface BookingEmailParser {
  name: string;
  canParse(context: BookingParserContext): boolean;
  parse(context: BookingParserContext): Promise<ParsedBookingEvent | null>;
}
