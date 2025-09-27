export type UnifiedProduct = {
  id: string;
  name: string;
  platform: 'ecwid' | string;
  [key: string]: unknown;
};

export type OrderExtras = {
  tshirts: number;
  cocktails: number;
  photos: number;
};

export type UnifiedOrder = {
  id: string;
  productId: string;
  productName: string;
  date: string;
  timeslot: string;
  quantity: number;
  menCount: number;
  womenCount: number;
  customerName: string;
  customerPhone?: string;
  platform: 'ecwid' | string;
  pickupDateTime?: string;
  extras?: OrderExtras;
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
};
