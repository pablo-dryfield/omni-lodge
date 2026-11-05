import { bookingBarcodeWorkerClient } from './bookingBarcodeWorkerClient';
import type { BookingBarcodeResponse } from './bookingBarcodeProtocol';

const makeWorker = () => ({ onmessage: null, onerror: null, onmessageerror: null, postMessage: jest.fn(), terminate: jest.fn() } as unknown as Worker);
const send = (worker: Worker, data: BookingBarcodeResponse) => worker.onmessage?.call(worker, { data } as MessageEvent<BookingBarcodeResponse>);
const image = () => ({ width: 3, height: 2, data: new Uint8ClampedArray(24) } as ImageData);

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('transfers pixels to the worker and returns only the matching frame result', async () => {
  const worker = makeWorker();
  const client = bookingBarcodeWorkerClient(worker);
  send(worker, { type: 'ready' });
  await client.ready;
  const frame = image();
  const result = client.decode(frame);
  await Promise.resolve();
  expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, width: 3, height: 2, buffer: frame.data.buffer }, [frame.data.buffer]);
  send(worker, { type: 'result', id: 0, codes: ['wrong-frame'] });
  send(worker, { type: 'result', id: 1, codes: ['11733'] });
  await expect(result).resolves.toEqual(['11733']);
  client.close();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('terminates an unresponsive decoder and rejects the in-flight request', async () => {
  const worker = makeWorker();
  const client = bookingBarcodeWorkerClient(worker);
  send(worker, { type: 'ready' });
  await client.ready;
  const result = client.decode(image());
  await Promise.resolve();
  jest.advanceTimersByTime(10000);
  await expect(result).rejects.toThrow('stopped responding');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('releases a worker closed while it is loading', async () => {
  const worker = makeWorker();
  const client = bookingBarcodeWorkerClient(worker);
  client.close();
  await expect(client.ready).rejects.toThrow('closed');
  expect(worker.onmessage).toBeNull();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('rejects initialization errors and never quietly leaves a live camera without a decoder', async () => {
  const worker = makeWorker();
  const client = bookingBarcodeWorkerClient(worker);
  send(worker, { type: 'error', message: 'The barcode reader could not load' });
  await expect(client.ready).rejects.toThrow('could not load');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('prevents a queue of old camera frames and cancels a pending frame on close', async () => {
  const worker = makeWorker();
  const client = bookingBarcodeWorkerClient(worker);
  send(worker, { type: 'ready' });
  await client.ready;
  const first = client.decode(image());
  await expect(client.decode(image())).rejects.toThrow('already being processed');
  client.close();
  await expect(first).rejects.toThrow('closed');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
