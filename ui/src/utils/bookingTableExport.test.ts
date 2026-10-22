import { Workbook } from 'exceljs';
import { bookingExportCell, bookingExportCsv, buildBookingExport, copyBookingExportImage, downloadBookingExport } from './bookingTableExport';
import type { RevenueBookingRow } from '../components/bookings/RevenueBookingsTable';

const row: RevenueBookingRow = {
  bookingId: '1234567890123456789', reference: '=HYPERLINK("https://example.com")', customerName: 'Zoë Łąka / Żółć',
  customerEmail: 'private@example.com', platform: 'OmniLodge', productName: 'Pub Crawl', sourceReceivedAtLabel: '2026-10-22 14:00:00',
  experienceDate: '2026-10-31', experienceTime: '21:00', guests: 3, status: 'checked_in_full', paymentStatus: 'partially_refunded',
  revenue: -12.5, currency: 'PLN', onSeeDetails: jest.fn(),
};
const columns = [{ id: 'customerName', label: 'Customer', width: 200 }, { id: 'revenue', label: 'Revenue', width: 140 }];
const model = () => buildBookingExport([row], columns, ['All matching bookings'], new Date('2026-10-22T12:00:00Z'));
const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});

describe('booking exports', () => {
  let downloaded: Blob;
  beforeEach(() => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = jest.fn(blob => { downloaded = blob as Blob; return 'blob:export'; });
    URL.revokeObjectURL = jest.fn();
  });
  afterEach(() => jest.restoreAllMocks());

  it('exports only requested visible columns, in their order, never hidden metadata or callbacks', () => {
    const result = model();
    expect(result.rows[0].map(cell => cell.value)).toEqual([row.customerName, -12.5]);
    expect(JSON.stringify(result)).not.toContain(row.customerEmail);
    expect(result.details.join(' ')).toContain('Europe/Warsaw');
    expect(result.details.join(' ')).toContain('14:00');
    expect(buildBookingExport([row], [...columns, { id: 'actions', label: 'Action', width: 100 }], []).columns).toEqual(columns);
  });

  it('uses readable dates/statuses and text identifiers, preserving numeric amounts', () => {
    expect(bookingExportCell(row, 'bookingId').value).toBe('1234567890123456789');
    expect(bookingExportCell(row, 'paymentStatus').text).toBe('Partially Refunded');
    expect(bookingExportCell(row, 'experienceDate').text).toBe('2026-10-31 · 21:00');
    expect(bookingExportCell(row, 'revenue')).toEqual({ value: -12.5, text: '-12.50 PLN', numberFormat: '#,##0.00 "PLN"' });
    expect(() => bookingExportCell(row, 'onSeeDetails')).toThrow('Unsupported export column');
  });

  it('escapes CSV quotes/newlines, preserves Unicode and prevents formula injection without corrupting numbers', () => {
    const result = buildBookingExport([{ ...row, customerName: 'A, "B"\nŻółć' }], [
      { id: 'reference', label: 'Booking', width: 200 }, ...columns,
    ], []);
    const csv = bookingExportCsv(result);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"A, ""B""\nŻółć"');
    expect(csv).toContain('"-12.5"');
    for (const dangerous of ['+SUM(1,1)', '-1+2', '@SUM(1)', ' \t=1+1', '\r=1+1']) {
      expect(bookingExportCsv(buildBookingExport([{ ...row, customerName: dangerous }], [columns[0]], []))).toContain(`"'${dangerous}"`);
    }
  });

  it('writes a real Excel workbook with numeric currency cells, text IDs, frozen headers and report context', async () => {
    await downloadBookingExport(buildBookingExport([row], [{ id: 'bookingId', label: 'Booking ID', width: 180 }, ...columns], ['Current page']), 'xlsx');
    const workbook = new Workbook();
    await workbook.xlsx.load(await readBlob(downloaded));
    const sheet = workbook.getWorksheet('Bookings')!;
    expect(sheet.getCell('A2').value).toBe('1234567890123456789');
    expect(sheet.getCell('B2').value).toBe(row.customerName);
    expect(sheet.getCell('C2').value).toBe(-12.5);
    expect(sheet.getCell('C2').numFmt).toBe('#,##0.00 "PLN"');
    expect(sheet.getCell('C2').alignment).toMatchObject({ horizontal: 'center', vertical: 'middle' });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(workbook.getWorksheet('Report scope')!.getCell('A2').value).toBe('Current page');
  });

  it('does not export an empty dataset', async () => {
    await expect(downloadBookingExport({ ...model(), rows: [] }, 'csv')).rejects.toThrow('Choose at least one');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('starts clipboard writing with a pending PNG promise, and downloads if clipboard access is denied', async () => {
    jest.spyOn(await import('./bookingTableExportImage'), 'bookingExportPng').mockResolvedValue(new Blob(['PNG'], { type: 'image/png' }));
    const write = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    const ClipboardItemMock = jest.fn().mockImplementation(data => ({ data }));
    Object.defineProperty(global, 'ClipboardItem', { configurable: true, value: ClipboardItemMock });
    await expect(copyBookingExportImage(model())).resolves.toBe('copied');
    expect(ClipboardItemMock.mock.calls[0][0]['image/png']).toBeInstanceOf(Promise);
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(copyBookingExportImage(model())).resolves.toBe('downloaded');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
