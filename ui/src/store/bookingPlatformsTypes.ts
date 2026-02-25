// This interface is a union of fields needed by your app, regardless of platform.
export interface UnifiedProduct {
  id: string;
  name: string;
  platform: 'ecwid' | 'viator' | 'getyourguide' | 'fareharbor' | 'freetour' | 'xperiencepoland' | 'airbnb' | string;
  [key: string]: any;
}

export interface OrderExtras {
  tshirts: number;
  cocktails: number;
  photos: number;
}

export interface PlatformBreakdownEntry {
  platform: string;
  totalPeople: number;
  men: number;
  women: number;
  orderCount: number;
}

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'amended'
  | 'rebooked'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'unknown';

export type BookingAttendanceStatus =
  | 'pending'
  | 'checked_in_partial'
  | 'checked_in_full'
  | 'no_show';

export interface UnifiedOrder {
  id: string;
  platformBookingId: string;
  platformBookingUrl?: string | null;
  productId: string;
  productName: string;
  date: string; // pickup date in YYYY-MM-DD (UTC-normalized)
  timeslot: string; // pickup time in HH:mm (24h)
  quantity: number; // total participants represented by this line item
  menCount: number;
  womenCount: number;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  platform: 'ecwid' | 'viator' | 'getyourguide' | 'fareharbor' | 'freetour' | 'xperiencepoland' | 'airbnb' | string;
  pickupDateTime?: string;
  extras?: OrderExtras;
  attendedTotal?: number | null;
  attendedExtras?: OrderExtras;
  remainingTotal?: number;
  sourceReceivedAt?: string | null;
  isAfterCutoff?: boolean;
  status: BookingStatus;
  attendanceStatus?: BookingAttendanceStatus;
  rawData?: any;
}

export type UnifiedOrderMap = {
  [orderId: string]: UnifiedOrder;
};

export type ManifestGroup = {
  productId: string;
  productName: string;
  date: string;
  time: string;
  totalPeople: number;
  men: number;
  women: number;
  extras: OrderExtras;
  orders: UnifiedOrder[];
  platformBreakdown: PlatformBreakdownEntry[];
};

export type ManifestSummary = {
  totalPeople: number;
  men: number;
  women: number;
  totalOrders: number;
  extras: OrderExtras;
  platformBreakdown: PlatformBreakdownEntry[];
  statusCounts: Record<BookingStatus, number>;
};
