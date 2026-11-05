import { bookingBarcodeWorkerClient } from './bookingBarcodeWorkerClient';

export const createBookingBarcodeReader = () => bookingBarcodeWorkerClient(
  new Worker(new URL('../workers/bookingBarcode.worker.ts', import.meta.url), { name: 'booking-barcode-reader' }),
);
