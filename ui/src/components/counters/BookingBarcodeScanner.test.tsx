import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BookingBarcodeScanner from './BookingBarcodeScanner';

const mockDecode = jest.fn();
const mockReader = { ready: Promise.resolve(), decode: jest.fn(), close: jest.fn() };
jest.mock('../../utils/createBookingBarcodeReader', () => ({
  createBookingBarcodeReader: () => mockReader,
}));
jest.mock('../../utils/bookingBarcodeCapture', () => ({
  scanBookingBarcodeVideo: (...args: unknown[]) => mockDecode(...args),
}));

type DecodeCallback = (result: { getText: () => string } | undefined, error: unknown, controls: { stop: jest.Mock }) => void;
let decode: DecodeCallback;
let controls: { stop: jest.Mock };
let now: number;
const getUserMedia = jest.fn();
const tracks: Array<{ stop: jest.Mock; addEventListener: jest.Mock; removeEventListener: jest.Mock; getCapabilities: jest.Mock; applyConstraints: jest.Mock }> = [];
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

const newStream = () => {
  const track = { stop: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), getCapabilities: jest.fn(() => ({})), applyConstraints: jest.fn().mockResolvedValue(undefined) };
  tracks.push(track);
  return { getTracks: () => [track], getVideoTracks: () => [track] };
};
const scan = (code: string) => act(() => decode({ getText: () => code }, undefined, controls));

beforeEach(() => {
  jest.clearAllMocks();
  mockReader.ready = Promise.resolve();
  tracks.length = 0;
  now = 1000;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  controls = { stop: jest.fn() };
  mockDecode.mockImplementation((_video, _reader, callback) => { decode = callback; return controls; });
  getUserMedia.mockImplementation(() => Promise.resolve(newStream()));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
  if (originalSecureContext) Object.defineProperty(window, 'isSecureContext', originalSecureContext);
  else Reflect.deleteProperty(window, 'isSecureContext');
});

it('keeps scanning new tickets without restarting the camera or repeating a held ticket', async () => {
  const onScan = jest.fn();
  const props = { onScan, onClose: jest.fn(), result: null };
  const view = render(<BookingBarcodeScanner {...props} />);
  await waitFor(() => expect(mockDecode).toHaveBeenCalledTimes(1));
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
    audio: false, video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
  }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  scan('41001');
  now += 500;
  scan('41001');
  expect(onScan.mock.calls).toEqual([['41001']]);
  view.rerender(<BookingBarcodeScanner {...props} result={{ bookingId: '41001', kind: 'found' }} />);
  now += 500;
  scan('41002');
  expect(onScan.mock.calls).toEqual([['41001'], ['41002']]);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(controls.stop).not.toHaveBeenCalled();
  expect(tracks[0].stop).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /scan next|switch camera/i })).not.toBeInTheDocument();
  now += 2100;
  scan('41002');
  expect(onScan).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(controls.stop).toHaveBeenCalled();
  expect(tracks[0].stop).toHaveBeenCalled();
});

it('blocks new search updates during a warning or save, then resumes automatically', async () => {
  const props = { onScan: jest.fn(), onClose: jest.fn(), result: null };
  const view = render(<BookingBarcodeScanner {...props} />);
  await waitFor(() => expect(mockDecode).toHaveBeenCalled());
  view.rerender(<BookingBarcodeScanner {...props} disabled />);
  scan('41002');
  expect(props.onScan).not.toHaveBeenCalled();
  view.rerender(<BookingBarcodeScanner {...props} />);
  scan('41002');
  expect(props.onScan).toHaveBeenCalledWith('41002');
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});

it('does not accept an unrelated or invalid barcode as a booking ID', async () => {
  const props = { onScan: jest.fn(), onClose: jest.fn(), result: null };
  render(<BookingBarcodeScanner {...props} />);
  await waitFor(() => expect(mockDecode).toHaveBeenCalled());
  ['https://example.com/41001', '0', '-1', '1.5', '9007199254740992'].forEach(scan);
  expect(props.onScan).not.toHaveBeenCalled();
  scan('0041001');
  expect(props.onScan).toHaveBeenCalledWith('41001');
});

it('offers only the close control during scanning, even when the camera supports a flash', async () => {
  const stream = newStream();
  tracks[0].getCapabilities.mockReturnValue({ torch: true });
  getUserMedia.mockResolvedValue(stream);
  const onClose = jest.fn();
  render(<BookingBarcodeScanner onScan={jest.fn()} onClose={onClose} result={null} />);
  await waitFor(() => expect(mockDecode).toHaveBeenCalled());
  expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: 'Close scanner' })]);
  fireEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('releases a camera permission result that arrives after the scanner closes', async () => {
  let grantPermission!: (stream: ReturnType<typeof newStream>) => void;
  getUserMedia.mockImplementation(() => new Promise(resolve => { grantPermission = resolve; }));
  const view = render(<BookingBarcodeScanner onScan={jest.fn()} onClose={jest.fn()} result={null} />);
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  view.unmount();
  await act(async () => { grantPermission(newStream()); });
  expect(tracks[0].stop).toHaveBeenCalled();
  expect(mockDecode).not.toHaveBeenCalled();
});

it('keeps manual search available when camera permission is refused', async () => {
  getUserMedia.mockRejectedValue(new DOMException('Permission refused', 'NotAllowedError'));
  const onClose = jest.fn();
  render(<BookingBarcodeScanner onScan={jest.fn()} onClose={onClose} result={null} />);
  expect(await screen.findByText(/Camera access was blocked/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('requests continuous autofocus when supported and continues if the optional setting is rejected', async () => {
  const stream = newStream();
  tracks[0].getCapabilities.mockReturnValue({ focusMode: ['manual', 'continuous'] });
  tracks[0].applyConstraints.mockRejectedValue(new Error('Unsupported focus setting'));
  getUserMedia.mockResolvedValue(stream);
  const onScan = jest.fn();
  render(<BookingBarcodeScanner onScan={onScan} onClose={jest.fn()} result={null} />);
  await waitFor(() => expect(mockDecode).toHaveBeenCalled());
  expect(tracks[0].applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] });
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
    video: expect.objectContaining({ width: { ideal: 1920 }, height: { ideal: 1080 } }),
  }));
  scan('41001');
  expect(onScan).toHaveBeenCalledWith('41001');
});

it('releases the stream on a processing failure', async () => {
  render(<BookingBarcodeScanner onScan={jest.fn()} onClose={jest.fn()} result={null} />);
  await waitFor(() => expect(mockDecode).toHaveBeenCalled());
  act(() => decode(undefined, new Error('Canvas unavailable'), controls));
  expect(await screen.findByText(/camera preview was interrupted/i)).toBeInTheDocument();
  expect(controls.stop).toHaveBeenCalled();
  expect(tracks[0].stop).toHaveBeenCalled();
});

it('releases the decoder and never opens the camera if closed while loading', async () => {
  let ready!: () => void;
  mockReader.ready = new Promise<void>(resolve => { ready = resolve; });
  const view = render(<BookingBarcodeScanner onScan={jest.fn()} onClose={jest.fn()} result={null} />);
  await act(async () => { await Promise.resolve(); });
  view.unmount();
  await act(async () => { ready(); });
  expect(mockReader.close).toHaveBeenCalled();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(mockDecode).not.toHaveBeenCalled();
});
