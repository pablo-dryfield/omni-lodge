/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { BOOKING_BARCODE_OPTIONS, type BookingBarcodeRequest, type BookingBarcodeResponse } from '../utils/bookingBarcodeProtocol';

declare const self: DedicatedWorkerGlobalScope;

const reply = (message: BookingBarcodeResponse) => self.postMessage(message);
// Webpack emits this pinned binary with the release. No CDN or external image
// service is used: camera pixels only move between this tab and its worker.
const wasmUrl = new URL('zxing-wasm/reader/zxing_reader.wasm', import.meta.url).href;
const ready = Promise.resolve(prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path },
  fireImmediately: true,
}));

void ready.then(() => reply({ type: 'ready' }), () => reply({ type: 'error', message: 'The barcode reader could not load. Please try again.' }));

self.onmessage = async (event: MessageEvent<BookingBarcodeRequest>) => {
  const { id, width, height, buffer } = event.data;
  try {
    await ready;
    const results = await readBarcodes(new ImageData(new Uint8ClampedArray(buffer), width, height), BOOKING_BARCODE_OPTIONS);
    reply({ type: 'result', id, codes: results.filter(result => result.isValid && result.format === 'Code128').map(result => result.text) });
  } catch {
    reply({ type: 'error', message: 'The barcode reader was interrupted. Please try again.' });
  }
};

export {};
