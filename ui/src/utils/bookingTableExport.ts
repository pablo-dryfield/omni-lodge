import type { RevenueBookingRow } from '../components/bookings/RevenueBookingsTable';

export type BookingExportScope = 'page' | 'all';
export type BookingExportFormat = 'png' | 'xlsx' | 'pdf' | 'csv';
export type BookingExportColumn = { id: string; label: string; width: number };
export type BookingExportCell = { value: string | number; text: string; numberFormat?: string };
export type BookingExportModel = {
  columns: BookingExportColumn[];
  rows: BookingExportCell[][];
  details: string[];
  filename: string;
};

const statusLabel = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const textCell = (value: unknown): BookingExportCell => ({ value: String(value ?? ''), text: String(value ?? '') });

// Explicit allowlist: callbacks, raw booking objects and hidden fields never enter a file.
export const bookingExportCell = (row: RevenueBookingRow, id: string): BookingExportCell => {
  switch (id) {
    case 'reference': return textCell(row.reference || row.bookingId);
    case 'bookingId': return textCell(row.bookingId);
    case 'customerName': return textCell(row.customerName);
    case 'customerEmail': return textCell(row.customerEmail);
    case 'platform': return textCell(row.platform);
    case 'productName': return textCell(row.productName);
    case 'sourceReceivedAt': return textCell(row.sourceReceivedAtLabel);
    case 'experienceDate': return textCell([row.experienceDate, row.experienceTime].filter(Boolean).join(' · '));
    case 'experienceTime': return textCell(row.experienceTime);
    case 'status': return textCell(statusLabel(row.status));
    case 'paymentStatus': return textCell(statusLabel(row.paymentStatus));
    case 'currency': return textCell(row.currency);
    case 'guests': {
      const value = Math.max(0, Number(row.guests) || 0);
      return { value, text: value.toLocaleString('en-US') };
    }
    case 'revenue': {
      const value = Number.isFinite(row.revenue) ? row.revenue : 0;
      const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : 'PLN';
      return {
        value, text: `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
        numberFormat: `#,##0.00 "${currency}"`,
      };
    }
    default: throw new Error(`Unsupported export column: ${id}`);
  }
};

export const buildBookingExport = (
  rows: RevenueBookingRow[], columns: BookingExportColumn[], details: string[], now = new Date(),
): BookingExportModel => ({
  columns: columns.filter(column => column.id !== 'actions').map(column => ({ ...column })),
  rows: rows.map(row => columns.filter(column => column.id !== 'actions').map(column => bookingExportCell(row, column.id))),
  details: [...details, `Generated ${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short',
  }).format(now)} (Europe/Warsaw)`],
  filename: `bookings-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
});

const csvValue = (value: string | number) => {
  // Keep real numbers numeric, but prevent customer-controlled strings from becoming formulas.
  let text = String(value);
  if (typeof value === 'string') {
    let first = 0;
    while (first < value.length && (value.charCodeAt(first) < 32 || !value[first].trim())) first++;
    if (['=', '+', '-', '@'].includes(value[first])) text = `'${value}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

export const bookingExportCsv = (model: BookingExportModel): string => '\uFEFF' + [
  model.columns.map(column => csvValue(column.label)).join(','),
  ...model.rows.map(row => row.map(cell => csvValue(cell.value)).join(',')),
].join('\r\n');

export const downloadBookingBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give browsers time to consume the URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

export const downloadBookingExport = async (model: BookingExportModel, format: BookingExportFormat): Promise<void> => {
  if (!model.columns.length || !model.rows.length) throw new Error('Choose at least one data column and one booking to export.');
  if (format === 'csv') {
    downloadBookingBlob(new Blob([bookingExportCsv(model)], { type: 'text/csv;charset=utf-8' }), `${model.filename}.csv`);
  } else if (format === 'xlsx') {
    // Large export libraries are only loaded when requested, not on the Summary page's initial load.
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    workbook.creator = 'OmniLodge';
    const sheet = workbook.addWorksheet('Bookings', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = model.columns.map(column => ({ header: column.label, width: Math.max(14, Math.min(45, column.width / 7)) }));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: model.rows.length + 1, column: model.columns.length } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF214A66' } };
    model.rows.forEach(cells => {
      const row = sheet.addRow(cells.map(cell => cell.value));
      row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cells.forEach((cell, index) => { if (cell.numberFormat) row.getCell(index + 1).numFmt = cell.numberFormat; });
    });
    const info = workbook.addWorksheet('Report scope');
    info.getColumn(1).width = 110;
    ['OmniLodge · Bookings', ...model.details, `${model.rows.length} bookings · ${model.columns.length} columns`]
      .forEach(detail => info.addRow([detail]));
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBookingBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${model.filename}.xlsx`);
  } else {
    const renderer = await import('./bookingTableExportImage');
    if (format === 'pdf') await renderer.downloadBookingPdf(model);
    else downloadBookingBlob(await renderer.bookingExportPng(model), `${model.filename}.png`);
  }
};

export const copyBookingExportImage = async (model: BookingExportModel): Promise<'copied' | 'downloaded'> => {
  const blobPromise = import('./bookingTableExportImage').then(renderer => renderer.bookingExportPng(model));
  // Start clipboard.write synchronously in the click handler, preserving Safari's user activation.
  if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      return 'copied';
    } catch {
      // Unsupported/denied clipboard access still offers the same image as a download.
    }
  }
  downloadBookingBlob(await blobPromise, `${model.filename}.png`);
  return 'downloaded';
};
