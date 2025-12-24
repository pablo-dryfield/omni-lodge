import type { BookingStatus } from '../constants/bookings.js';

export type UnifiedProduct = {
  id: string;
  name: string;
  platform: 'ecwid' | 'fareharbor' | 'viator' | 'getyourguide' | 'freetour' | 'xperiencepoland' | 'airbnb' | string;
  [key: string]: unknown;
};

export type OrderExtras = {
  tshirts: number;
  cocktails: number;
  photos: number;
};

export type PlatformBreakdownEntry = {
  platform: string;
  totalPeople: number;
  men: number;
  women: number;
  orderCount: number;
};

export type UnifiedOrder = {
  id: string;
  platformBookingId: string;
  platformBookingUrl?: string | null;
  productId: string;
  productName: string;
  date: string;
  timeslot: string;
  quantity: number;
  menCount: number;
  womenCount: number;
  customerName: string;
  customerPhone?: string;
  platform: 'ecwid' | 'fareharbor' | 'viator' | 'getyourguide' | 'freetour' | 'xperiencepoland' | 'airbnb' | string;
  pickupDateTime?: string;
  extras?: OrderExtras;
  status: BookingStatus;
  rawData?: unknown;
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
