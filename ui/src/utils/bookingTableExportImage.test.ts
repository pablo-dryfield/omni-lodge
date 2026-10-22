import { bookingExportPng, downloadBookingPdf, wrapBookingExportText } from './bookingTableExportImage';
import type { BookingExportModel } from './bookingTableExport';

const mockAddImage = jest.fn();
const mockAddPage = jest.fn();
jest.mock('jspdf', () => ({ jsPDF: jest.fn().mockImplementation(() => ({
  setProperties: jest.fn(), addImage: mockAddImage, addPage: mockAddPage, output: () => new Blob(['%PDF-1.4']),
  internal: { pageSize: { getWidth: () => 1190, getHeight: () => 842 } },
})) }));

const model = (count = 2, columnCount = 2): BookingExportModel => ({
  columns: Array.from({ length: columnCount }, (_, index) => ({ id: String(index), label: `Column ${index}`, width: 240 })),
  rows: Array.from({ length: count }, (_, index) => Array.from({ length: columnCount }, () => ({ value: `Żółć ${index}`, text: `Żółć ${index}` }))),
  details: ['All matching bookings'], filename: 'test',
});

describe('booking image and PDF exports', () => {
  const fillText = jest.fn();
  beforeEach(() => {
    mockAddImage.mockClear(); mockAddPage.mockClear(); fillText.mockClear();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: Array.from(text).length * 7 }), scale: jest.fn(), fillRect: jest.fn(), strokeRect: jest.fn(), fillText,
    } as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['PNG'], { type: 'image/png' })));
    jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H');
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = jest.fn(() => 'blob:pdf'); URL.revokeObjectURL = jest.fn();
  });
  afterEach(() => jest.restoreAllMocks());

  it('wraps without dropping long IDs, Unicode names or explicit newlines', () => {
    const text = 'André Żółć 🧑‍💼 ABCDEFGHIJKLMNOP';
    expect(wrapBookingExportText(text, 5, value => Array.from(value).length).join('')).toBe(text);
    expect(wrapBookingExportText('one\ntwo', 50, value => value.length)).toEqual(['one', 'two']);
  });

  it('renders an actual PNG blob including all rows and Unicode labels', async () => {
    expect((await bookingExportPng(model())).type).toBe('image/png');
    expect(fillText).toHaveBeenCalledWith('Żółć 1', expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith('2 bookings · 2 columns', expect.any(Number), expect.any(Number));
  });

  it('fails oversized images explicitly instead of truncating the results', async () => {
    await expect(bookingExportPng(model(1000))).rejects.toThrow('Choose Current page');
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });

  it('splits all matching rows and wide columns across PDF pages, repeating identifying headers', async () => {
    await downloadBookingPdf(model(60, 10));
    expect(mockAddPage.mock.calls.length).toBeGreaterThan(2);
    expect(mockAddImage).toHaveBeenCalledTimes(mockAddPage.mock.calls.length + 1);
    expect(fillText.mock.calls.filter(args => args[0] === 'Column 0').length).toBe(mockAddImage.mock.calls.length);
    expect(fillText.mock.calls.some(args => String(args[0]).includes('Bookings 60'))).toBe(false);
    expect(fillText.mock.calls.some(args => String(args[0]).includes('–60 of 60'))).toBe(true);
  });
});
