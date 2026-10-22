import { downloadBookingBlob, type BookingExportModel } from './bookingTableExport';

const FONT = '"Segoe UI", Arial, sans-serif';
const PADDING = 24;
const LINE_HEIGHT = 20;
const MAX_HEIGHT = 16_000;
const MAX_PIXELS = 40_000_000;

// Break long IDs/emails as well as ordinary words. Never silently crop cell values.
export const wrapBookingExportText = (text: string, width: number, measure: (value: string) => number): string[] =>
  text.split(/\r?\n/).flatMap(paragraph => {
    const lines: string[] = [];
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > width) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
    return lines;
  });

type Layout = { width: number; height: number; header: string[][]; details: string[]; cells: string[][][]; heights: number[]; top: number; headerHeight: number };

const layout = (model: BookingExportModel, context: CanvasRenderingContext2D): Layout => {
  const width = model.columns.reduce((sum, column) => sum + column.width, 0) + PADDING * 2;
  context.font = `14px ${FONT}`;
  const wrap = (text: string, available: number) => wrapBookingExportText(text, available, value => context.measureText(value).width);
  const details = model.details.flatMap(detail => wrap(detail, width - PADDING * 2));
  const top = 88 + details.length * LINE_HEIGHT;
  const header = model.columns.map(column => wrap(column.label, column.width - 20));
  const headerHeight = Math.max(1, ...header.map(lines => lines.length)) * LINE_HEIGHT + 24;
  const cells = model.rows.map(row => row.map((cell, index) => wrap(cell.text || '—', model.columns[index].width - 20)));
  const heights = cells.map(row => Math.max(1, ...row.map(lines => lines.length)) * LINE_HEIGHT + 22);
  return { width, height: top + headerHeight + heights.reduce((sum, height) => sum + height, 0) + 50, header, details, cells, heights, top, headerHeight };
};

const createSurface = () => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create images. Please use Excel or CSV.');
  return { canvas, context };
};

const paint = (model: BookingExportModel, plan: Layout, footer: string): HTMLCanvasElement => {
  const { canvas, context } = createSurface();
  const scale = 1.5;
  if (plan.height * scale > MAX_HEIGHT || plan.width * plan.height * scale * scale > MAX_PIXELS) {
    throw new Error('This image is too large to create safely. Choose Current page, hide some columns, or download Excel, CSV or PDF for all matching bookings.');
  }
  canvas.width = Math.ceil(plan.width * scale);
  canvas.height = Math.ceil(plan.height * scale);
  context.scale(scale, scale);
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, plan.width, plan.height);
  context.fillStyle = '#172b42'; context.font = `bold 26px ${FONT}`;
  context.fillText('OmniLodge · Bookings', PADDING, 42);
  context.font = `14px ${FONT}`; context.fillStyle = '#526576';
  plan.details.forEach((line, index) => context.fillText(line, PADDING, 70 + index * LINE_HEIGHT));
  const drawRow = (cells: string[][], y: number, height: number, heading: boolean, stripe: boolean) => {
    let x = PADDING;
    cells.forEach((lines, index) => {
      const width = model.columns[index].width;
      context.fillStyle = heading ? '#214a66' : stripe ? '#f1f5f9' : '#ffffff';
      context.fillRect(x, y, width, height);
      context.strokeStyle = '#d9e2eb'; context.strokeRect(x, y, width, height);
      context.fillStyle = heading ? '#ffffff' : '#172b42';
      context.font = `${heading ? 'bold ' : ''}14px ${FONT}`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
      lines.forEach((line, lineIndex) => context.fillText(line, x + width / 2, y + (height - (lines.length - 1) * LINE_HEIGHT) / 2 + lineIndex * LINE_HEIGHT));
      x += width;
    });
  };
  drawRow(plan.header, plan.top, plan.headerHeight, true, false);
  let y = plan.top + plan.headerHeight;
  plan.cells.forEach((cells, index) => { drawRow(cells, y, plan.heights[index], false, index % 2 === 1); y += plan.heights[index]; });
  context.font = `13px ${FONT}`; context.fillStyle = '#526576'; context.textAlign = 'left'; context.textBaseline = 'alphabetic';
  context.fillText(footer, PADDING, plan.height - 18);
  return canvas;
};

export const bookingExportPng = async (model: BookingExportModel): Promise<Blob> => {
  if (!model.rows.length || !model.columns.length) throw new Error('No visible booking data to share.');
  const plan = layout(model, createSurface().context);
  const canvas = paint(model, plan, `${model.rows.length} bookings · ${model.columns.length} columns`);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image creation failed. Try Excel or CSV.')), 'image/png'));
};

export const downloadBookingPdf = async (model: BookingExportModel): Promise<void> => {
  const { jsPDF } = await import('jspdf');
  // Split wide tables into column bands (repeating the first column), rather than shrinking text to illegibility.
  const bands: number[][] = [];
  let band: number[] = [];
  let width = 0;
  model.columns.forEach((column, index) => {
    if (band.length && width + column.width > 1400) {
      bands.push(band); band = [0]; width = model.columns[0].width;
    }
    band.push(index); width += column.width;
  });
  if (band.length) bands.push(band);
  const bandPlans = bands.map(indices => {
    const bandModel = { ...model, columns: indices.map(index => model.columns[index]), rows: model.rows.map(row => indices.map(index => row[index])) };
    return { model: bandModel, plan: layout(bandModel, createSurface().context) };
  });
  // Use identical row ranges and font scale across all column groups and pages.
  const top = Math.max(...bandPlans.map(band => band.plan.top));
  const headerHeight = Math.max(...bandPlans.map(band => band.plan.headerHeight));
  const heights = model.rows.map((_, index) => Math.max(...bandPlans.map(band => band.plan.heights[index])));
  const ranges: Array<{ start: number; end: number; height: number }> = [];
  let start = 0;
  while (start < model.rows.length) {
    let end = start;
    let height = top + headerHeight + 50;
    while (end < model.rows.length && (end === start || height + heights[end] <= 1000)) height += heights[end++];
    ranges.push({ start, end, height }); start = end;
  }
  const pages = bandPlans.flatMap((band, bandIndex) => ranges.map(range => ({
    ...range, bandIndex,
    model: { ...band.model, rows: band.model.rows.slice(range.start, range.end) },
    plan: { ...band.plan, top, headerHeight, height: range.height, cells: band.plan.cells.slice(range.start, range.end), heights: heights.slice(range.start, range.end) },
  })));
  const pdf = new jsPDF({ unit: 'pt', orientation: 'landscape', format: 'a3', compress: true });
  pdf.setProperties({ title: 'OmniLodge · Bookings', subject: model.details.join(' | '), creator: 'OmniLodge' });
  const scale = Math.min(
    (pdf.internal.pageSize.getWidth() - 32) / Math.max(...pages.map(page => page.plan.width)),
    (pdf.internal.pageSize.getHeight() - 32) / Math.max(1000, ...pages.map(page => page.plan.height)),
  );
  for (let index = 0; index < pages.length; index++) {
    if (index) pdf.addPage('a3', 'landscape');
    const page = pages[index];
    const canvas = paint(page.model, page.plan, `Page ${index + 1} of ${pages.length} · Bookings ${page.start + 1}–${page.end} of ${model.rows.length} · Column group ${page.bandIndex + 1}/${bands.length}`);
    // Canvas rendering preserves Unicode names and currency symbols without remote fonts.
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 16, 16, page.plan.width * scale, page.plan.height * scale);
    canvas.width = 0; canvas.height = 0;
    await new Promise(resolve => window.setTimeout(resolve, 0));
  }
  downloadBookingBlob(pdf.output('blob'), `${model.filename}.pdf`);
};
