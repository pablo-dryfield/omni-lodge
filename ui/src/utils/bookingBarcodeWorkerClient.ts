import type { BookingBarcodeReader, BookingBarcodeRequest, BookingBarcodeResponse } from './bookingBarcodeProtocol';

/** One frame at a time: no backlog, main-thread decoding, or late results after close. */
export function bookingBarcodeWorkerClient(worker: Worker): BookingBarcodeReader {
  let closed = false;
  let nextId = 0;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let pending: { id: number; resolve: (codes: string[]) => void; reject: (error: Error) => void } | null = null;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let timer: ReturnType<typeof setTimeout>;
  const close = (error: Error) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    rejectReady(error);
    pending?.reject(error);
    pending = null;
  };
  timer = setTimeout(() => close(new Error('The barcode reader took too long to load. Please try again.')), 20000);
  worker.onerror = () => close(new Error('The barcode reader could not start. Please try again.'));
  worker.onmessageerror = () => close(new Error('The barcode reader was interrupted. Please try again.'));
  worker.onmessage = (event: MessageEvent<BookingBarcodeResponse>) => {
    if (closed) return;
    const message = event.data;
    if (message.type === 'ready') {
      clearTimeout(timer);
      resolveReady();
    } else if (message.type === 'error') {
      close(new Error(message.message));
    } else if (message.type === 'result' && pending?.id === message.id) {
      clearTimeout(timer);
      pending.resolve(message.codes);
      pending = null;
    }
  };
  return {
    ready,
    async decode(image) {
      await ready;
      if (closed) throw new Error('Barcode reader is closed');
      if (pending) throw new Error('A camera frame is already being processed');
      const id = ++nextId;
      return new Promise<string[]>((resolve, reject) => {
        pending = { id, resolve, reject };
        timer = setTimeout(() => close(new Error('The barcode reader stopped responding. Please try again.')), 10000);
        // ImageData is created exclusively for this frame; transfer instead of
        // copying its pixels and immediately release it on the UI thread.
        const request: BookingBarcodeRequest = { id, width: image.width, height: image.height, buffer: image.data.buffer as ArrayBuffer };
        try { worker.postMessage(request, [request.buffer]); }
        catch { close(new Error('The camera frame could not be processed. Please try again.')); }
      });
    },
    close: () => close(new Error('Barcode reader is closed')),
  };
}
