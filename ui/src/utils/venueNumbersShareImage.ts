import type {
  VenuePayoutVenueBreakdown,
  VenuePayoutVenueDaily,
} from "../types/nightReports/VenuePayoutSummary";

export type VenueSummaryShareRange = {
  startDate: string;
  endDate: string;
};

export type ShareVenueSummaryImageOptions = VenueSummaryShareRange & {
  venue: VenuePayoutVenueBreakdown;
};

export type VenueSummaryShareResult = "copied" | "downloaded";

export type VenueSummaryShareDetailColumnKey =
  | "date"
  | "totalPeople"
  | "duration"
  | "normal"
  | "cocktail"
  | "brunch"
  | "type"
  | "amount";

export type VenueSummaryShareDetailColumn = {
  key: VenueSummaryShareDetailColumnKey;
  label: string;
  weight: number;
  align: "left" | "center" | "right";
};

export type VenueSummaryShareDetailRow = {
  source: VenuePayoutVenueDaily;
  placeholder: boolean;
  values: Record<VenueSummaryShareDetailColumnKey, string>;
};

type MetricTone = "default" | "positive" | "negative" | "warning";

export type VenueSummaryShareMetric = {
  label: string;
  value: string;
  tone?: MetricTone;
};

export type VenueSummaryShareSection = {
  key: "commission" | "openBar";
  title: string;
  accent: string;
  metrics: VenueSummaryShareMetric[];
};

export type VenueSummaryShareModel = {
  venueName: string;
  currency: string;
  rangeLabel: string;
  filename: string;
  totalPeople: string;
  net: string;
  netTone: MetricTone;
  showCommissionSection: boolean;
  showOpenBarSection: boolean;
  showOpenBarBreakdownColumns: boolean;
  showCocktailColumn: boolean;
  showBrunchColumn: boolean;
  showDurationColumn: boolean;
  showTypeColumn: boolean;
  representedDayCount: number;
  sections: VenueSummaryShareSection[];
  columns: VenueSummaryShareDetailColumn[];
  details: VenueSummaryShareDetailRow[];
};

const COMMISSION_IMAGE_WIDTH = 220;
const MIXED_MIN_IMAGE_WIDTH = 429;
const OPEN_BAR_COLUMN_WIDTH_UNIT = 61;
const MIN_OUTPUT_WIDTH = 5_200;
const MIN_IMAGE_SCALE = 6;
const MAX_OUTPUT_HEIGHT = 16_000;
const MAX_OUTPUT_PIXELS = 60_000_000;
const FONT_FAMILY = 'Inter, "Segoe UI", Arial, sans-serif';

type VenueSummaryShareRenderStyle = {
  compact: boolean;
  outerPadding: number;
  cardInset: number;
  gap: number;
  borderWidth: number;
  headerHeight: number;
  overviewHeight: number;
  sectionHeight: number;
  detailTitleHeight: number;
  detailHeaderHeight: number;
  detailRowHeight: number;
  footerHeight: number;
  emptyDetailsHeight: number;
  headerLabelFontSize: number;
  headerLabelY: number;
  venueFontSize: number;
  venueY: number;
  rangeFontSize: number;
  rangeY: number;
  overviewLabelFontSize: number;
  overviewLabelY: number;
  overviewValueFontSize: number;
  overviewValueY: number;
  sectionTitleFontSize: number;
  sectionTitleY: number;
  sectionLabelFontSize: number;
  sectionLabelY: number;
  sectionValueFontSize: number;
  sectionValueY: number;
  sectionSideInset: number;
  dailyTitleFontSize: number;
  dailyTitleY: number;
  tableHeaderFontSize: number;
  rowFontSize: number;
  footerFontSize: number;
  footerY: number;
};

const DEFAULT_RENDER_STYLE: VenueSummaryShareRenderStyle = {
  compact: false,
  outerPadding: 18,
  cardInset: 7,
  gap: 7,
  borderWidth: 1,
  headerHeight: 72,
  overviewHeight: 44,
  sectionHeight: 68,
  detailTitleHeight: 24,
  detailHeaderHeight: 20,
  detailRowHeight: 18,
  footerHeight: 28,
  emptyDetailsHeight: 38,
  headerLabelFontSize: 7,
  headerLabelY: 15,
  venueFontSize: 18,
  venueY: 36,
  rangeFontSize: 9,
  rangeY: 57,
  overviewLabelFontSize: 7,
  overviewLabelY: 13,
  overviewValueFontSize: 14,
  overviewValueY: 30,
  sectionTitleFontSize: 10,
  sectionTitleY: 14,
  sectionLabelFontSize: 6,
  sectionLabelY: 34,
  sectionValueFontSize: 9,
  sectionValueY: 51,
  sectionSideInset: 11,
  dailyTitleFontSize: 10,
  dailyTitleY: 10,
  tableHeaderFontSize: 7,
  rowFontSize: 8,
  footerFontSize: 8,
  footerY: 15,
};

const COMMISSION_RENDER_STYLE: VenueSummaryShareRenderStyle = {
  compact: true,
  outerPadding: 8,
  cardInset: 4,
  gap: 5,
  borderWidth: 0.5,
  headerHeight: 40,
  overviewHeight: 24,
  sectionHeight: 40,
  detailTitleHeight: 12,
  detailHeaderHeight: 12,
  detailRowHeight: 9,
  footerHeight: 16,
  emptyDetailsHeight: 24,
  headerLabelFontSize: 4,
  headerLabelY: 7,
  venueFontSize: 11,
  venueY: 20,
  rangeFontSize: 5,
  rangeY: 33,
  overviewLabelFontSize: 4,
  overviewLabelY: 7,
  overviewValueFontSize: 8,
  overviewValueY: 17,
  sectionTitleFontSize: 6,
  sectionTitleY: 8,
  sectionLabelFontSize: 4,
  sectionLabelY: 21,
  sectionValueFontSize: 5.25,
  sectionValueY: 32,
  sectionSideInset: 6,
  dailyTitleFontSize: 6,
  dailyTitleY: 6,
  tableHeaderFontSize: 4.5,
  rowFontSize: 6,
  footerFontSize: 5,
  footerY: 8,
};

const COLORS = {
  page: "#F2F5FA",
  surface: "#FFFFFF",
  header: "#132238",
  headerMuted: "#B9C7DB",
  ink: "#172033",
  muted: "#667085",
  border: "#D9E1EC",
  tableHeader: "#EAF0F8",
  alternateRow: "#F8FAFD",
  blue: "#2E67D1",
  blueSoft: "#E9F0FF",
  green: "#168568",
  greenSoft: "#E4F6F0",
  orange: "#C96A19",
  orangeSoft: "#FFF1E3",
  red: "#C23B4A",
  redSoft: "#FDECEF",
};

const safeNumber = (value: number): number => (Number.isFinite(value) ? value : 0);

const hasAnyNonZeroValue = (...values: number[]): boolean =>
  values.some((value) => safeNumber(value) !== 0);

const resolveStayDurationMinutes = (row: VenuePayoutVenueDaily): number | null => {
  const value = row.stayDurationMinutes;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
};

const formatStayDuration = (minutes: number | null): string => {
  if (minutes === null) {
    return "—";
  }
  const roundedMinutes = Math.max(1, Math.round(minutes));
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${remainingMinutes}m`;
};

const formatCurrency = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeNumber(value));
  } catch {
    return `${safeNumber(value).toFixed(2)} ${currency}`.trim();
  }
};

const parseDateOnly = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: string, style: "short" | "long" = "short"): string => {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return value;
  }
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};

const formatUtcDateKey = (value: Date): string =>
  `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(
    value.getUTCDate(),
  ).padStart(2, "0")}`;

const enumerateCalendarDateKeys = (startDate: string, endDate: string): string[] => {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }
  const dates: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatUtcDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const sanitizeFilenamePart = (value: string): string => {
  const normalized = value
    .replace(/[Łł]/g, (character) => (character === "Ł" ? "L" : "l"))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "venue";
};

const buildFilename = (venueName: string, range: VenueSummaryShareRange): string => {
  const venuePart = sanitizeFilenamePart(venueName).slice(0, 72).replace(/-+$/g, "") || "venue";
  const startPart = sanitizeFilenamePart(range.startDate);
  const endPart = sanitizeFilenamePart(range.endDate);
  return `venue-summary-${venuePart}-${startPart}-to-${endPart}.png`;
};

const detailColumns = (
  showDurationColumn: boolean,
  showOpenBarBreakdownColumns: boolean,
  showCocktailColumn: boolean,
  showBrunchColumn: boolean,
  showTypeColumn: boolean,
): VenueSummaryShareDetailColumn[] => {
  const columns: VenueSummaryShareDetailColumn[] = [
    { key: "date", label: "Date", weight: 1.25, align: "center" },
    { key: "totalPeople", label: "Total people", weight: 0.85, align: "center" },
  ];
  if (showDurationColumn) {
    columns.push({ key: "duration", label: "Duration", weight: 0.8, align: "center" });
  }
  if (showOpenBarBreakdownColumns) {
    columns.push({ key: "normal", label: "Normal", weight: 0.65, align: "center" });
  }
  if (showCocktailColumn) {
    columns.push({ key: "cocktail", label: "Cocktail", weight: 0.75, align: "center" });
  }
  if (showBrunchColumn) {
    columns.push({ key: "brunch", label: "Brunch", weight: 0.65, align: "center" });
  }
  if (showTypeColumn) {
    columns.push({ key: "type", label: "Type", weight: 0.85, align: "center" });
  }
  columns.push({ key: "amount", label: "Amount", weight: 1.2, align: "center" });
  return columns;
};

/**
 * Builds the exact calendar content represented in the share image. Real activity
 * is retained and dates without activity receive a muted zero-value placeholder.
 */
export const buildVenueSummaryShareModel = ({
  venue,
  startDate,
  endDate,
}: ShareVenueSummaryImageOptions): VenueSummaryShareModel => {
  const indexedDetails = venue.daily.map((source, sourceIndex) => ({ source, sourceIndex }));
  indexedDetails.sort((left, right) => {
    const dateComparison = left.source.date.localeCompare(right.source.date);
    return dateComparison === 0 ? left.sourceIndex - right.sourceIndex : dateComparison;
  });

  const hasCommissionDetail = indexedDetails.some(
    ({ source }) => source.direction === "receivable",
  );
  const payableDetails = indexedDetails.filter(
    ({ source }) => source.direction === "payable",
  );
  const hasOpenBarDetail = payableDetails.length > 0;
  const hasCommissionData =
    hasCommissionDetail ||
    hasAnyNonZeroValue(
      venue.totalPeopleReceivable,
      venue.receivable,
      venue.receivableCollected,
      venue.receivableOutstanding,
    );
  const hasOpenBarData =
    hasOpenBarDetail ||
    hasAnyNonZeroValue(
      venue.totalPeoplePayable,
      venue.payable,
      venue.payableCollected,
      venue.payableOutstanding,
    );
  const showOpenBarSection = venue.allowsOpenBar === true && hasOpenBarData;
  const showCommissionSection = hasCommissionData || !showOpenBarSection;
  const showTypeColumn =
    showCommissionSection && showOpenBarSection && hasCommissionDetail && hasOpenBarDetail;
  const showOpenBarBreakdownColumns = showOpenBarSection && hasOpenBarDetail;
  const showCocktailColumn =
    showOpenBarBreakdownColumns &&
    payableDetails.some(({ source }) => safeNumber(source.cocktailsCount) > 0);
  const showBrunchColumn =
    showOpenBarBreakdownColumns &&
    payableDetails.some(({ source }) => safeNumber(source.brunchCount) > 0);
  const relevantDetails = indexedDetails.filter(
    ({ source }) => source.direction === "receivable" || showOpenBarSection,
  );
  const showDurationColumn = relevantDetails.some(
    ({ source }) => resolveStayDurationMinutes(source) !== null,
  );
  const columns = detailColumns(
    showDurationColumn,
    showOpenBarBreakdownColumns,
    showCocktailColumn,
    showBrunchColumn,
    showTypeColumn,
  );
  const calendarDateKeys = enumerateCalendarDateKeys(startDate, endDate);
  const actualDateKeys = new Set(relevantDetails.map(({ source }) => source.date.slice(0, 10)));
  const placeholderDetails = calendarDateKeys
    .filter((date) => !actualDateKeys.has(date))
    .map((date, placeholderIndex) => ({
      source: {
        date,
        reportId: null,
        totalPeople: 0,
        amount: 0,
        direction: "receivable" as const,
        normalCount: 0,
        cocktailsCount: 0,
        brunchCount: 0,
        stayDurationMinutes: null,
      },
      sourceIndex: relevantDetails.length + placeholderIndex,
      placeholder: true,
    }));
  const detailInputs = [
    ...relevantDetails.map(({ source, sourceIndex }) => ({
      source,
      sourceIndex,
      placeholder: false,
    })),
    ...placeholderDetails,
  ];
  detailInputs.sort((left, right) => {
    const dateComparison = left.source.date.localeCompare(right.source.date);
    return dateComparison === 0 ? left.sourceIndex - right.sourceIndex : dateComparison;
  });

  const details = detailInputs.map(({ source, placeholder }): VenueSummaryShareDetailRow => ({
    source,
    placeholder,
    values: {
      date: formatDate(source.date),
      totalPeople: placeholder ? "0" : String(safeNumber(source.totalPeople)),
      duration: placeholder ? "—" : formatStayDuration(resolveStayDurationMinutes(source)),
      normal:
        !placeholder && source.direction === "payable"
          ? String(safeNumber(source.normalCount))
          : "—",
      cocktail:
        !placeholder && source.direction === "payable"
          ? String(safeNumber(source.cocktailsCount))
          : "—",
      brunch:
        !placeholder && source.direction === "payable"
          ? String(safeNumber(source.brunchCount))
          : "—",
      type: placeholder
        ? "No activity"
        : source.direction === "receivable"
          ? "Commission"
          : "Open bar",
      amount: formatCurrency(placeholder ? 0 : source.amount, venue.currency),
    },
  }));

  const sections: VenueSummaryShareSection[] = [];
  if (showCommissionSection) {
    sections.push({
      key: "commission",
      title: "Commission",
      accent: COLORS.green,
      metrics: [
        { label: "People", value: String(safeNumber(venue.totalPeopleReceivable)) },
        { label: "Owed", value: formatCurrency(venue.receivable, venue.currency) },
        { label: "Collected", value: formatCurrency(venue.receivableCollected, venue.currency), tone: "positive" },
        {
          label: "Outstanding",
          value: formatCurrency(venue.receivableOutstanding, venue.currency),
          tone: safeNumber(venue.receivableOutstanding) > 0 ? "warning" : "default",
        },
      ],
    });
  }
  if (showOpenBarSection) {
    sections.push({
      key: "openBar",
      title: "Open bar payout",
      accent: COLORS.orange,
      metrics: [
        { label: "People", value: String(safeNumber(venue.totalPeoplePayable)) },
        { label: "Owed", value: formatCurrency(venue.payable, venue.currency) },
        { label: "Paid", value: formatCurrency(venue.payableCollected, venue.currency), tone: "positive" },
        {
          label: "Outstanding",
          value: formatCurrency(venue.payableOutstanding, venue.currency),
          tone: safeNumber(venue.payableOutstanding) > 0 ? "warning" : "default",
        },
      ],
    });
  }

  const net = safeNumber(venue.net);
  return {
    venueName: venue.venueName,
    currency: venue.currency,
    rangeLabel: `${formatDate(startDate, "long")} – ${formatDate(endDate, "long")}`,
    filename: buildFilename(venue.venueName, { startDate, endDate }),
    totalPeople: String(safeNumber(venue.totalPeople)),
    net: formatCurrency(net, venue.currency),
    netTone: net < 0 ? "negative" : "positive",
    showCommissionSection,
    showOpenBarSection,
    showOpenBarBreakdownColumns,
    showCocktailColumn,
    showBrunchColumn,
    showDurationColumn,
    showTypeColumn,
    representedDayCount: calendarDateKeys.length,
    sections,
    columns,
    details,
  };
};

export type VenueSummaryShareCanvasLayout = {
  logicalWidth: number;
  contentWidth: number;
  tableWidth: number;
  tableX: number;
  scale: number;
  outputWidth: number;
};

const isCommissionOnly = (model: VenueSummaryShareModel): boolean =>
  model.showCommissionSection && !model.showOpenBarSection;

const OPEN_BAR_RENDER_STYLE = COMMISSION_RENDER_STYLE;

const resolveRenderStyle = (model: VenueSummaryShareModel): VenueSummaryShareRenderStyle =>
  isCommissionOnly(model)
    ? COMMISSION_RENDER_STYLE
    : model.showOpenBarSection
      ? OPEN_BAR_RENDER_STYLE
      : DEFAULT_RENDER_STYLE;

const resolveOpenBarTableWidth = (columns: VenueSummaryShareDetailColumn[]): number =>
  Math.round(
    columns.reduce((sum, column) => sum + column.weight, 0) *
      OPEN_BAR_COLUMN_WIDTH_UNIT,
  );

export const resolveVenueSummaryShareCanvasLayout = (
  model: VenueSummaryShareModel,
): VenueSummaryShareCanvasLayout => {
  const style = resolveRenderStyle(model);
  const openBarTableWidth = model.showOpenBarSection
    ? resolveOpenBarTableWidth(model.columns)
    : null;
  const logicalWidth =
    openBarTableWidth === null
      ? COMMISSION_IMAGE_WIDTH
      : model.showCommissionSection
        ? Math.max(MIXED_MIN_IMAGE_WIDTH, openBarTableWidth + style.outerPadding * 2)
        : openBarTableWidth + style.outerPadding * 2;
  const scale = Math.max(MIN_IMAGE_SCALE, Math.ceil(MIN_OUTPUT_WIDTH / logicalWidth));
  const tableWidth = openBarTableWidth ?? logicalWidth - style.outerPadding * 2;
  return {
    logicalWidth,
    contentWidth: logicalWidth - style.outerPadding * 2,
    tableWidth,
    tableX: (logicalWidth - tableWidth) / 2,
    scale,
    outputWidth: logicalWidth * scale,
  };
};

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  const boundedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + boundedRadius, y);
  context.lineTo(x + width - boundedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + boundedRadius);
  context.lineTo(x + width, y + height - boundedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - boundedRadius, y + height);
  context.lineTo(x + boundedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - boundedRadius);
  context.lineTo(x, y + boundedRadius);
  context.quadraticCurveTo(x, y, x + boundedRadius, y);
  context.closePath();
};

const fillRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
  strokeWidth = 1,
): void => {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.stroke();
  }
};

const truncateText = (
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string => {
  if (context.measureText(value).width <= maxWidth) {
    return value;
  }
  let shortened = value;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
};

const drawText = (
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: {
    font?: string;
    color?: string;
    align?: CanvasTextAlign;
    maxWidth?: number;
  } = {},
): void => {
  context.font = options.font ?? `400 16px ${FONT_FAMILY}`;
  context.fillStyle = options.color ?? COLORS.ink;
  context.textAlign = options.align ?? "left";
  context.textBaseline = "middle";
  const fitted = options.maxWidth ? truncateText(context, value, options.maxWidth) : value;
  context.fillText(fitted, x, y);
};

const toneColor = (tone: MetricTone | undefined): string => {
  if (tone === "positive") return COLORS.green;
  if (tone === "negative") return COLORS.red;
  if (tone === "warning") return COLORS.orange;
  return COLORS.ink;
};

const calculateImageHeight = (model: VenueSummaryShareModel): number => {
  const style = resolveRenderStyle(model);
  const sectionsHeight = model.sections.length > 0 ? style.sectionHeight : 0;
  const bodyHeight =
    model.details.length > 0
      ? model.details.length * style.detailRowHeight
      : style.emptyDetailsHeight;
  const gaps = style.gap * 3;
  return (
    style.outerPadding * 2 +
    style.headerHeight +
    style.overviewHeight +
    sectionsHeight +
    style.detailTitleHeight +
    style.detailHeaderHeight +
    bodyHeight +
    style.footerHeight +
    gaps
  );
};

const assertPracticalCanvasHeight = (
  model: VenueSummaryShareModel,
  logicalHeight: number,
  layout: VenueSummaryShareCanvasLayout,
): void => {
  const outputHeight = logicalHeight * layout.scale;
  if (
    outputHeight <= MAX_OUTPUT_HEIGHT &&
    layout.outputWidth * outputHeight <= MAX_OUTPUT_PIXELS
  ) {
    return;
  }
  throw new Error(
    `This venue has too many detail rows to fit in one share image (${model.details.length} rows). Choose a shorter date range and try again.`,
  );
};

const drawHeader = (
  context: CanvasRenderingContext2D,
  model: VenueSummaryShareModel,
  y: number,
  imageWidth: number,
): number => {
  const style = resolveRenderStyle(model);
  const width = imageWidth - style.outerPadding * 2;
  const height = style.headerHeight;
  fillRoundedRect(
    context,
    style.outerPadding,
    y,
    width,
    height,
    style.compact ? 6 : 11,
    COLORS.header,
  );
  drawText(context, "VENUE NUMBERS", imageWidth / 2, y + style.headerLabelY, {
    font: `700 ${style.headerLabelFontSize}px ${FONT_FAMILY}`,
    color: COLORS.headerMuted,
    align: "center",
  });
  drawText(context, model.venueName, imageWidth / 2, y + style.venueY, {
    font: `700 ${style.venueFontSize}px ${FONT_FAMILY}`,
    color: COLORS.surface,
    align: "center",
    maxWidth: width - (style.compact ? 12 : 30),
  });
  drawText(context, model.rangeLabel, imageWidth / 2, y + style.rangeY, {
    font: `500 ${style.rangeFontSize}px ${FONT_FAMILY}`,
    color: COLORS.headerMuted,
    align: "center",
    maxWidth: width - (style.compact ? 12 : 30),
  });
  return y + height;
};

const drawOverview = (
  context: CanvasRenderingContext2D,
  model: VenueSummaryShareModel,
  y: number,
  imageWidth: number,
): number => {
  const style = resolveRenderStyle(model);
  const availableWidth = imageWidth - style.outerPadding * 2;
  const gap = style.gap;
  const cardWidth = (availableWidth - gap) / 2;
  const cards = [
    { label: "Total people", value: model.totalPeople, fill: COLORS.blueSoft, color: COLORS.blue },
    {
      label: "Net",
      value: model.net,
      fill: model.netTone === "negative" ? COLORS.redSoft : COLORS.greenSoft,
      color: toneColor(model.netTone),
    },
  ];
  cards.forEach((card, index) => {
    const x = style.outerPadding + index * (cardWidth + gap);
    fillRoundedRect(
      context,
      x,
      y,
      cardWidth,
      style.overviewHeight,
      style.compact ? 4 : 8,
      card.fill,
      COLORS.border,
      style.borderWidth,
    );
    drawText(context, card.label.toUpperCase(), x + cardWidth / 2, y + style.overviewLabelY, {
      font: `700 ${style.overviewLabelFontSize}px ${FONT_FAMILY}`,
      color: COLORS.muted,
      align: "center",
    });
    drawText(context, card.value, x + cardWidth / 2, y + style.overviewValueY, {
      font: `700 ${style.overviewValueFontSize}px ${FONT_FAMILY}`,
      color: card.color,
      align: "center",
      maxWidth: cardWidth - (style.compact ? style.cardInset * 2 : 22),
    });
  });
  return y + style.overviewHeight;
};

const drawSections = (
  context: CanvasRenderingContext2D,
  model: VenueSummaryShareModel,
  y: number,
  imageWidth: number,
): number => {
  if (model.sections.length === 0) {
    return y;
  }
  const style = resolveRenderStyle(model);
  const availableWidth = imageWidth - style.outerPadding * 2;
  const gap = style.gap;
  const containerWidth = model.sections.length === 1 ? Math.min(560, availableWidth) : availableWidth;
  const containerX = (imageWidth - containerWidth) / 2;
  const sectionWidth =
    (containerWidth - gap * Math.max(0, model.sections.length - 1)) / model.sections.length;
  model.sections.forEach((section, sectionIndex) => {
    const x = containerX + sectionIndex * (sectionWidth + gap);
    fillRoundedRect(
      context,
      x,
      y,
      sectionWidth,
      style.sectionHeight,
      style.compact ? 4 : 8,
      COLORS.surface,
      COLORS.border,
      style.borderWidth,
    );
    context.fillStyle = section.accent;
    context.fillRect(x, y, style.compact ? 1.5 : 3, style.sectionHeight);
    drawText(context, section.title, x + sectionWidth / 2, y + style.sectionTitleY, {
      font: `700 ${style.sectionTitleFontSize}px ${FONT_FAMILY}`,
      color: COLORS.ink,
      align: "center",
      maxWidth: sectionWidth - style.sectionSideInset * 2,
    });
    const metricWidth =
      (sectionWidth - style.sectionSideInset * 2) / section.metrics.length;
    section.metrics.forEach((metric, metricIndex) => {
      const metricX =
        x + style.sectionSideInset + (metricIndex + 0.5) * metricWidth;
      drawText(context, metric.label.toUpperCase(), metricX, y + style.sectionLabelY, {
        font: `700 ${style.sectionLabelFontSize}px ${FONT_FAMILY}`,
        color: COLORS.muted,
        align: "center",
        maxWidth: metricWidth - (style.compact ? 2 : 5),
      });
      drawText(context, metric.value, metricX, y + style.sectionValueY, {
        font: `700 ${style.sectionValueFontSize}px ${FONT_FAMILY}`,
        color: toneColor(metric.tone),
        align: "center",
        maxWidth: metricWidth - (style.compact ? 2 : 5),
      });
    });
  });
  return y + style.sectionHeight;
};

const resolveColumnGeometry = (
  model: VenueSummaryShareModel,
  imageWidth: number,
  style: VenueSummaryShareRenderStyle,
): {
  tableX: number;
  tableWidth: number;
  columns: Array<VenueSummaryShareDetailColumn & { x: number; width: number }>;
} => {
  const { columns } = model;
  const weightTotal = columns.reduce((sum, column) => sum + column.weight, 0);
  const tableWidth = model.showOpenBarSection
    ? resolveOpenBarTableWidth(columns)
    : imageWidth - style.outerPadding * 2;
  const tableX = (imageWidth - tableWidth) / 2;
  let cursor = tableX;
  const resolvedColumns = columns.map((column, index) => {
    const width =
      index === columns.length - 1
        ? tableX + tableWidth - cursor
        : (tableWidth * column.weight) / weightTotal;
    const geometry = { ...column, x: cursor, width };
    cursor += width;
    return geometry;
  });
  return { tableX, tableWidth, columns: resolvedColumns };
};

const columnTextX = (
  column: { x: number; width: number; align: "left" | "center" | "right" },
  cardInset: number,
): number => {
  if (column.align === "left") return column.x + cardInset;
  if (column.align === "right") return column.x + column.width - cardInset;
  return column.x + column.width / 2;
};

const drawDetails = (
  context: CanvasRenderingContext2D,
  model: VenueSummaryShareModel,
  y: number,
  imageWidth: number,
): number => {
  const style = resolveRenderStyle(model);
  const detailRowHeight = style.detailRowHeight;
  const dayCountLabel = `${model.representedDayCount} ${
    model.representedDayCount === 1 ? "calendar day" : "calendar days"
  }`;
  drawText(context, `Daily activity • ${dayCountLabel}`, imageWidth / 2, y + style.dailyTitleY, {
    font: `700 ${style.dailyTitleFontSize}px ${FONT_FAMILY}`,
    align: "center",
    maxWidth: imageWidth - style.outerPadding * 2,
  });
  y += style.detailTitleHeight;

  const table = resolveColumnGeometry(model, imageWidth, style);
  const { columns, tableWidth, tableX } = table;
  fillRoundedRect(
    context,
    tableX,
    y,
    tableWidth,
    style.detailHeaderHeight,
    style.compact ? 3 : 6,
    COLORS.tableHeader,
    COLORS.border,
    style.borderWidth,
  );
  columns.forEach((column) => {
    drawText(
      context,
      column.label.toUpperCase(),
      columnTextX(column, style.cardInset),
      y + style.detailHeaderHeight / 2,
      {
        font: `700 ${style.tableHeaderFontSize}px ${FONT_FAMILY}`,
        color: COLORS.muted,
        align: column.align,
        maxWidth: column.width - style.cardInset * 2,
      },
    );
  });
  y += style.detailHeaderHeight;

  if (model.details.length === 0) {
    fillRoundedRect(
      context,
      tableX,
      y,
      tableWidth,
      style.emptyDetailsHeight,
      style.compact ? 3 : 6,
      COLORS.surface,
      COLORS.border,
      style.borderWidth,
    );
    drawText(
      context,
      "No daily activity available for the selected period.",
      imageWidth / 2,
      y + style.emptyDetailsHeight / 2,
      {
        font: `500 ${style.rowFontSize}px ${FONT_FAMILY}`,
        color: COLORS.muted,
        align: "center",
      },
    );
    return y + style.emptyDetailsHeight;
  }

  model.details.forEach((detail, rowIndex) => {
    const rowY = y + rowIndex * detailRowHeight;
    context.fillStyle = rowIndex % 2 === 0 ? COLORS.surface : COLORS.alternateRow;
    context.fillRect(tableX, rowY, tableWidth, detailRowHeight);
    context.strokeStyle = COLORS.border;
    context.lineWidth = style.borderWidth;
    context.beginPath();
    context.moveTo(tableX, rowY + detailRowHeight);
    context.lineTo(tableX + tableWidth, rowY + detailRowHeight);
    context.stroke();

    columns.forEach((column) => {
      const isAmount = column.key === "amount";
      const amountTone =
        detail.source.direction === "receivable" ? COLORS.green : COLORS.orange;
      drawText(
        context,
        detail.values[column.key],
        columnTextX(column, style.cardInset),
        rowY + detailRowHeight / 2,
        {
          font: `${isAmount ? 700 : 500} ${style.rowFontSize}px ${FONT_FAMILY}`,
          color: detail.placeholder ? COLORS.muted : isAmount ? amountTone : COLORS.ink,
          align: column.align,
          maxWidth: column.width - style.cardInset * 2,
        },
      );
    });
  });
  return y + model.details.length * detailRowHeight;
};

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(
          new Error(
            "The venue share image could not be encoded as PNG. Try again or choose a shorter date range.",
          ),
        );
        return;
      }
      resolve(blob);
    }, "image/png");
  });

const prepareVenueSummaryImage = (
  options: ShareVenueSummaryImageOptions,
): { blobPromise: Promise<Blob>; filename: string } => {
  const model = buildVenueSummaryShareModel(options);
  const layout = resolveVenueSummaryShareCanvasLayout(model);
  const style = resolveRenderStyle(model);
  const logicalHeight = calculateImageHeight(model);
  assertPracticalCanvasHeight(model, logicalHeight, layout);

  const canvas = document.createElement("canvas");
  canvas.width = layout.outputWidth;
  canvas.height = logicalHeight * layout.scale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Your browser could not create the venue share image. Try a current Chrome or Edge browser.");
  }
  context.scale(layout.scale, layout.scale);
  context.fillStyle = COLORS.page;
  context.fillRect(0, 0, layout.logicalWidth, logicalHeight);

  let y = style.outerPadding;
  y = drawHeader(context, model, y, layout.logicalWidth) + style.gap;
  y = drawOverview(context, model, y, layout.logicalWidth) + style.gap;
  y = drawSections(context, model, y, layout.logicalWidth) + style.gap;
  y = drawDetails(context, model, y, layout.logicalWidth);

  drawText(context, "Venue Numbers • Full calendar detail", layout.logicalWidth / 2, y + style.footerY, {
    font: `500 ${style.footerFontSize}px ${FONT_FAMILY}`,
    color: COLORS.muted,
    align: "center",
  });

  return { blobPromise: canvasToPngBlob(canvas), filename: model.filename };
};

export const renderVenueSummaryImage = async (
  options: ShareVenueSummaryImageOptions,
): Promise<{ blob: Blob; filename: string }> => {
  const { blobPromise, filename } = prepareVenueSummaryImage(options);
  return { blob: await blobPromise, filename };
};

const downloadPng = (blob: Blob, filename: string): void => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error(
      "Image clipboard access is unavailable and this browser could not start a PNG download.",
    );
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }
};

/**
 * Copies a polished PNG to the image clipboard when supported. Browsers that do
 * not allow image clipboard writes receive the same PNG as a download instead.
 */
export const shareVenueSummaryImage = async (
  options: ShareVenueSummaryImageOptions,
): Promise<VenueSummaryShareResult> => {
  const { blobPromise, filename } = prepareVenueSummaryImage(options);
  const ClipboardItemConstructor = globalThis.ClipboardItem;
  if (navigator.clipboard?.write && typeof ClipboardItemConstructor === "function") {
    try {
      // Passing the pending Blob promise allows clipboard.write to start during the
      // click's transient user activation (notably required by Safari).
      const item = new ClipboardItemConstructor({ "image/png": blobPromise });
      await navigator.clipboard.write([item]);
      return "copied";
    } catch {
      // Image clipboard support varies by browser and permission state. Download below.
    }
  }

  const blob = await blobPromise;
  downloadPng(blob, filename);
  return "downloaded";
};
