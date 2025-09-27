// This interface is a union of fields needed by your app, regardless of platform.
export interface UnifiedProduct {
  id: string;
  name: string;
  platform: 'ecwid' | 'viator' | 'getyourguide' | string;
  [key: string]: any;
}

export interface OrderExtras {
  tshirts: number;
  cocktails: number;
  photos: number;
}

export interface UnifiedOrder {
  id: string;
  productId: string;
  productName: string;
  date: string; // pickup date in YYYY-MM-DD (UTC-normalized)
  timeslot: string; // pickup time in HH:mm (24h)
  quantity: number; // total participants represented by this line item
  menCount: number;
  womenCount: number;
  customerName: string;
  customerPhone?: string;
  platform: 'ecwid' | 'viator' | 'getyourguide' | string;
  pickupDateTime?: string;
  extras?: OrderExtras;
  rawData?: any;
}

export type UnifiedOrderMap = {
  [orderId: string]: UnifiedOrder;
};
