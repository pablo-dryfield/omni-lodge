// This interface is a union of fields needed by your app, regardless of platform.
export interface UnifiedProduct {
    id: string;
    name: string;
    platform: 'ecwid' | 'viator' | 'getyourguide' | string;
    [key: string]: any; // for future extension
  }
  
  export interface UnifiedOrder {
    id: string;
    productId: string;
    productName: string;
    date: string;
    timeslot: string;
    quantity: number;
    customerName: string;
    platform: 'ecwid' | 'viator' | 'getyourguide' | string;
    rawData?: any; // keep original platform data for edge cases
  }
  