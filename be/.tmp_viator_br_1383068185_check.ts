import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);
dotenv.config({ path: ".env.dev" });
const { Client } = pg;

const BOOKING_ID = "BR-1383068185";
const CSV_PATH = "C:/Users/pjcam/Downloads/bookings-report-68223-20260428151500.csv";

const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const findHeaderIndex = (headers: string[], candidates: string[]): number => {
  const normalized = headers.map(normalizeHeader);
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const idx = normalized.findIndex((h) => h === nc);
    if (idx >= 0) return idx;
  }
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const idx = normalized.findIndex((h) => h.includes(nc));
    if (idx >= 0) return idx;
  }
  return -1;
};

const parseMoney = (value: unknown): number => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
    else normalized = cleaned.replace(/,/g, "");
  } else if (hasComma) normalized = cleaned.replace(/,/g, ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
};

const parseCsv = (content: string): { headers: string[]; rows: string[][] } => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((v) => String(v ?? "").trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((v) => String(v ?? "").trim().length > 0)) rows.push(row);
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0].map((h) => String(h ?? "").trim()), rows: rows.slice(1) };
};

const parseFlexibleDate = (value: string): string | null => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const formats = [
    "YYYY-MM-DD",
    "YYYY/MM/DD",
    "DD/MM/YYYY",
    "DD-MM-YYYY",
    "MM/DD/YYYY",
    "MMM D, YYYY",
    "MMMM D, YYYY",
    "ddd, MMM D, YYYY",
    "ddd, MMMM D, YYYY",
  ];
  for (const f of formats) {
    const parsed = dayjs(trimmed, f, true);
    if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
  }
  const fallback = dayjs(trimmed);
  return fallback.isValid() ? fallback.format("YYYY-MM-DD") : null;
};

(async () => {
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const parsed = parseCsv(csvText);

  const orderIdx = findHeaderIndex(parsed.headers, [
    "booking reference",
    "viator reference",
    "booking id",
    "order id",
    "reservation id",
    "reference",
    "transaction ref",
    "transaction reference",
  ]);
  const dateIdx = findHeaderIndex(parsed.headers, ["travel date", "activity date", "experience date", "tour date", "service date"]);
  const revenueIdx = findHeaderIndex(parsed.headers, ["net amount", "net price", "net", "revenue", "amount", "total"]);
  const peopleIdx = findHeaderIndex(parsed.headers, ["travelers", "travellers", "pax", "party size", "participants", "guests", "people"]);
  const statusIdx = findHeaderIndex(parsed.headers, ["status", "booking status", "reservation status"]);

  const csvRows = parsed.rows.filter((r) => String(r[orderIdx] ?? "").trim() === BOOKING_ID).map((r) => ({
    orderKey: String(r[orderIdx] ?? "").trim(),
    dateRaw: dateIdx >= 0 ? String(r[dateIdx] ?? "") : null,
    date: dateIdx >= 0 ? parseFlexibleDate(String(r[dateIdx] ?? "")) : null,
    revenueRaw: revenueIdx >= 0 ? String(r[revenueIdx] ?? "") : null,
    revenue: revenueIdx >= 0 ? parseMoney(r[revenueIdx]) : 0,
    peopleRaw: peopleIdx >= 0 ? String(r[peopleIdx] ?? "") : null,
    people: peopleIdx >= 0 ? Number.parseInt(String(r[peopleIdx] ?? ""), 10) || 0 : 0,
    status: statusIdx >= 0 ? String(r[statusIdx] ?? "") : null,
  }));

  const csvAgg = csvRows.reduce(
    (acc, row) => {
      acc.rows += 1;
      acc.revenue += row.revenue;
      acc.people += row.people > 0 ? row.people : 0;
      if (row.date && (!acc.firstDate || row.date < acc.firstDate)) acc.firstDate = row.date;
      return acc;
    },
    { rows: 0, revenue: 0, people: 0, firstDate: null as string | null },
  );

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();

  const bookingRows = await client.query(
    `
    SELECT id, platform, platform_booking_id, platform_order_id, status, payment_status,
           experience_date, source_received_at, party_size_total, party_size_adults, party_size_children,
           base_amount, tip_amount, price_gross, price_net, refunded_amount, discount_amount,
           last_email_message_id, created_at, updated_at
    FROM bookings
    WHERE platform='viator' AND platform_booking_id = $1
    ORDER BY id ASC;
  `,
    [BOOKING_ID],
  );

  const bookingIds = bookingRows.rows.map((r: any) => r.id);
  const events = bookingIds.length
    ? await client.query(
        `
    SELECT id, booking_id, event_type, status, occurred_at, email_message_id, created_at
    FROM booking_events
    WHERE booking_id = ANY($1)
    ORDER BY occurred_at ASC, id ASC;
  `,
        [bookingIds],
      )
    : { rows: [] };

  await client.end();

  const omniAgg = bookingRows.rows.reduce(
    (acc: any, row: any) => {
      acc.rows += 1;
      acc.revenue += Number(row.base_amount ?? 0);
      acc.people += Number(row.party_size_total ?? 0);
      if (row.experience_date) {
        const d = dayjs(row.experience_date).format("YYYY-MM-DD");
        if (!acc.firstDate || d < acc.firstDate) acc.firstDate = d;
      }
      return acc;
    },
    { rows: 0, revenue: 0, people: 0, firstDate: null as string | null },
  );

  const out = {
    bookingId: BOOKING_ID,
    csv: {
      columns: {
        order: orderIdx >= 0 ? parsed.headers[orderIdx] : null,
        date: dateIdx >= 0 ? parsed.headers[dateIdx] : null,
        revenue: revenueIdx >= 0 ? parsed.headers[revenueIdx] : null,
        people: peopleIdx >= 0 ? parsed.headers[peopleIdx] : null,
        status: statusIdx >= 0 ? parsed.headers[statusIdx] : null,
      },
      rows: csvRows,
      aggregate: {
        rows: csvAgg.rows,
        revenue: Math.round((csvAgg.revenue + Number.EPSILON) * 100) / 100,
        people: csvAgg.people,
        firstDate: csvAgg.firstDate,
      },
    },
    omni: {
      rows: bookingRows.rows,
      events: events.rows,
      aggregate: {
        rows: omniAgg.rows,
        revenue: Math.round((omniAgg.revenue + Number.EPSILON) * 100) / 100,
        people: omniAgg.people,
        firstDate: omniAgg.firstDate,
      },
    },
    delta: {
      revenue: Math.round((omniAgg.revenue - csvAgg.revenue + Number.EPSILON) * 100) / 100,
      people: omniAgg.people - csvAgg.people,
      bookings: omniAgg.rows - csvAgg.rows,
    },
  };

  console.log(JSON.stringify(out, null, 2));
})();

