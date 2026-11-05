import type { BookingBarcodeReader } from './bookingBarcodeProtocol';

export type BookingScannerControls = { stop(): void };
type BarcodeResult = { getText(): string };

const captureContext = (canvas: HTMLCanvasElement) => {
  try { return canvas.getContext('2d', { willReadFrequently: true }); }
  catch { return canvas.getContext('2d'); }
};

/** Scan every pixel of the camera frame; the on-screen guide is only visual. */
export function scanBookingBarcodeVideo(
  video: HTMLVideoElement,
  reader: BookingBarcodeReader,
  callback: (result: BarcodeResult | undefined, error: unknown, controls: BookingScannerControls) => void,
): BookingScannerControls {
  const canvas = document.createElement('canvas');
  const context = captureContext(canvas);
  if (!context) throw new Error('Camera frame processing is unavailable.');
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controls: BookingScannerControls = { stop: () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    reader.close();
    canvas.width = canvas.height = 0;
  } };
  const loop = async () => {
    if (stopped) return;
    let success = false;
    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (video.readyState >= 2 && width > 0 && height > 0) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const codes = await reader.decode(context.getImageData(0, 0, width, height));
        if (stopped) return;
        if (codes.length) {
          success = true;
          callback({ getText: () => codes[0] }, undefined, controls);
        }
      }
    } catch (error) {
      if (stopped) return;
      callback(undefined, error, controls);
      controls.stop();
    }
    if (!stopped) timeout = setTimeout(() => { void loop(); }, success ? 500 : 200);
  };
  timeout = setTimeout(() => { void loop(); }, 0);
  return controls;
}
