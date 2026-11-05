/** @jest-environment node */
import { readFileSync } from 'fs';
import path from 'path';
import { BOOKING_BARCODE_OPTIONS } from './bookingBarcodeProtocol';

// Jest 27 cannot resolve conditional package exports; use the pinned package's
// CommonJS build while exercising the real decoder and its local WASM binary.
const packageRoot = path.join(__dirname, '../..', 'node_modules/zxing-wasm');
const { prepareZXingModule, readBarcodes } = require(path.join(packageRoot, 'dist/cjs/reader/index.js')) as typeof import('zxing-wasm/reader');
beforeAll(() => {
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(path.join(packageRoot, 'dist/reader/zxing_reader.wasm')) } });
});

it('finds the barcode in the reported camera scene without a manual crop around its bars', async () => {
  // Camera preview only: names and the rest of the customer reservation UI have
  // been removed from this fixture. The dark surrounding screen and guide remain.
  const bytes = readFileSync(path.join(__dirname, '__fixtures__/code128-camera-scene.png'));
  const results = await readBarcodes(new Uint8Array(bytes), BOOKING_BARCODE_OPTIONS);
  expect(results.filter(result => result.isValid).map(result => result.text)).toEqual(['11733']);
  expect(results[0].format).toBe('Code128');
  expect(results[0].lineCount).toBeGreaterThanOrEqual(2);
});

it('does not manufacture a booking from an empty camera frame', async () => {
  const data = new Uint8ClampedArray(400 * 300 * 4).fill(255);
  const results = await readBarcodes({ data, width: 400, height: 300 } as ImageData, BOOKING_BARCODE_OPTIONS);
  expect(results).toEqual([]);
  expect(BOOKING_BARCODE_OPTIONS.returnErrors).toBe(false);
  expect(BOOKING_BARCODE_OPTIONS.tryRotate).toBe(true);
});
