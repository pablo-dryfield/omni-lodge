export type BookingBarcodeRequest = { id: number; width: number; height: number; buffer: ArrayBuffer };
export type BookingBarcodeResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; codes: string[] }
  | { type: 'error'; message: string };

export type BookingBarcodeReader = {
  ready: Promise<void>;
  decode(image: ImageData): Promise<string[]>;
  close(): void;
};

// Code 128's mandatory checksum remains enabled. Require agreement between at
// least two scan lines, and never return damaged/invalid symbols as bookings.
export const BOOKING_BARCODE_OPTIONS = {
  formats: ['Code128' as const],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  minLineCount: 2,
  maxNumberOfSymbols: 1,
  returnErrors: false,
};
