import { scanBookingBarcodeVideo } from './bookingBarcodeCapture';

let canvas: HTMLCanvasElement;
let drawImage: jest.Mock;
let video: HTMLVideoElement;
const frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData;

beforeEach(() => {
  jest.useFakeTimers();
  drawImage = jest.fn();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvas = this;
    return { drawImage, getImageData: jest.fn(() => frame) } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  video = document.createElement('video');
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
    readyState: { configurable: true, value: 2 },
  });
});

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
const tick = async (time: number) => { jest.advanceTimersByTime(time); await new Promise<void>(resolve => jest.requireActual('timers').setImmediate(resolve)); };
const newReader = () => ({ ready: Promise.resolve(), decode: jest.fn().mockResolvedValue([]), close: jest.fn() });

it('reads the full camera resolution regardless of the displayed guide or preview size', async () => {
  const reader = newReader();
  reader.decode.mockResolvedValue(['41001']);
  const callback = jest.fn();
  const controls = scanBookingBarcodeVideo(video, reader, callback);
  await tick(0);
  expect(canvas.width).toBe(1920);
  expect(canvas.height).toBe(1080);
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  expect(reader.decode).toHaveBeenCalledWith(frame);
  expect(callback.mock.calls[0][0].getText()).toBe('41001');
  controls.stop();
  await tick(2000);
  expect(reader.decode).toHaveBeenCalledTimes(1);
  expect(reader.close).toHaveBeenCalledTimes(1);
});

it('continues through misses and uses updated camera dimensions', async () => {
  const reader = newReader();
  const callback = jest.fn();
  const controls = scanBookingBarcodeVideo(video, reader, callback);
  await tick(0);
  expect(callback).not.toHaveBeenCalled();
  Object.defineProperties(video, { videoWidth: { value: 720 }, videoHeight: { value: 1280 } });
  reader.decode.mockResolvedValue(['41003']);
  await tick(200);
  expect(drawImage).toHaveBeenLastCalledWith(video, 0, 0, 720, 1280);
  expect(callback.mock.calls[0][0].getText()).toBe('41003');
  await tick(500);
  expect(callback).toHaveBeenCalledTimes(2);
  controls.stop();
});

it('does not queue overlapping frames or accept a result after the camera closes', async () => {
  let resolve!: (codes: string[]) => void;
  const reader = newReader();
  reader.decode.mockReturnValue(new Promise<string[]>(done => { resolve = done; }));
  const callback = jest.fn();
  const controls = scanBookingBarcodeVideo(video, reader, callback);
  await tick(0);
  await tick(5000);
  expect(reader.decode).toHaveBeenCalledTimes(1);
  controls.stop();
  resolve(['41004']);
  await tick(0);
  expect(callback).not.toHaveBeenCalled();
});

it('waits for a decoded video frame and stops on unexpected processing errors', async () => {
  Object.defineProperty(video, 'readyState', { value: 1 });
  const failure = new Error('Worker failed');
  const reader = newReader();
  reader.decode.mockRejectedValue(failure);
  const callback = jest.fn();
  const controls = scanBookingBarcodeVideo(video, reader, callback);
  await tick(0);
  expect(reader.decode).not.toHaveBeenCalled();
  Object.defineProperty(video, 'readyState', { value: 2 });
  await tick(200);
  expect(callback).toHaveBeenCalledWith(undefined, failure, controls);
  await tick(2000);
  expect(reader.decode).toHaveBeenCalledTimes(1);
  expect(reader.close).toHaveBeenCalled();
});
