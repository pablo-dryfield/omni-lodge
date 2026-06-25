import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import { sendMessage as sendGmailMessage } from './bookings/gmailClient.js';
import { getConfigValue } from './configService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BADGE_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../ui/public/assets/badges/ktk-guide-badge.svg',
);
const BADGE_BACKSIDE_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../ui/public/assets/badges/ktk-backside-badge.png',
);
const BADGE_PRINT_RECIPIENT_FALLBACK = 'pjcampo1@gmail.com';
const BADGE_PRINT_EMAIL_SUBJECT_FALLBACK = 'Badge Print Request - {{userDisplayName}}';
const BADGE_PRINT_EMAIL_BODY_FALLBACK = `Hello!

I'd like to order:

A6 Size (It's a badge)
Glossy lamination and the thickest paper (320g - 350g).
Perforated at the hole (it doesn't need to be exact).

Faktura:

Nazwa pe\u0142na: KRAKTIVITY SP\u00D3\u0141KA Z OGRANICZON\u0104 ODPOWIEDZIALNO\u015ACI\u0104
NIP: 6762661275
Adres siedziby: Cegielniana 4A / 27, 30-404 Krak\u00F3w, Polska

Best,

The KTK Pub Crawl Team`;
const BADGE_FRONT_PAGE_WIDTH_MM = 105;
const BADGE_FRONT_PAGE_HEIGHT_MM = 148;
const BADGE_FRONT_EXPORT_VIEWBOX = {
  x: 102.29,
  y: 0.12,
  width: 297.64,
  height: 419.53,
};
const BADGE_FRONT_RENDER_WIDTH_MM = 106;
const BADGE_FRONT_RENDER_HEIGHT_MM = 149;
const BADGE_FRONT_BLEED_OFFSET_MM = -0.5;
const BADGE_FRONT_LABEL_WIDTH = 272.18;
const BADGE_FRONT_LABEL_CENTER_X = 253.03;
const BADGE_FRONT_LABEL_CENTER_Y = 305.41;
const BADGE_FRONT_LABEL_MAX_TEXT_WIDTH = BADGE_FRONT_LABEL_WIDTH - 26;
const BADGE_BACKSIDE_IMAGE_WIDTH = 1240;
const BADGE_BACKSIDE_IMAGE_HEIGHT = 1748;
const BADGE_BACKSIDE_QR = {
  left: 381,
  top: 340,
  size: 452,
};
const BADGE_CAMPAIGN_BASE_URL =
  'https://krawlthroughkrakow.com/store/Krakow-Pub-Crawl-with-Krawl-Through-Krakow-p637047413/';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const emojiSvgCache = new Map<string, string>();

const sanitizeFileName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase() || 'staff-badge';

const buildBadgeFontSize = (badgeName: string, prefixEmoji: string, suffixEmoji: string): number => {
  const units = badgeName.length * 1.2 + (prefixEmoji ? 3 : 0) + (suffixEmoji ? 3 : 0);
  if (units <= 7) {
    return 41;
  }
  if (units <= 10) {
    return 38;
  }
  if (units <= 13) {
    return 35;
  }
  if (units <= 16) {
    return 31;
  }
  return 27;
};

const buildBadgeLabel = (badgeName: string, prefixEmoji: string, suffixEmoji: string): string =>
  [prefixEmoji.trim(), badgeName.trim(), suffixEmoji.trim()].filter(Boolean).join(' ');

const getEmojiCodepointSlug = (emoji: string): string =>
  Array.from(emoji.trim())
    .map((symbol) => symbol.codePointAt(0)?.toString(16))
    .filter((value): value is string => Boolean(value))
    .join('-');

const getEmojiDataUrl = async (emoji: string): Promise<string | null> => {
  const slug = getEmojiCodepointSlug(emoji);
  if (!slug) {
    return null;
  }
  const cached = emojiSvgCache.get(slug);
  if (cached) {
    return cached;
  }

  const response = await fetch(`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${slug}.svg`);
  if (!response.ok) {
    return null;
  }

  const svgBuffer = Buffer.from(await response.arrayBuffer());
  const dataUrl = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
  emojiSvgCache.set(slug, dataUrl);
  return dataUrl;
};

const buildBadgeFrontLabelNode = async (badgeName: string, prefixEmoji: string, suffixEmoji: string): Promise<string> => {
  const fontSize = buildBadgeFontSize(badgeName, prefixEmoji, suffixEmoji);
  const naturalNameWidth = Math.max(badgeName.length * fontSize * 0.68, fontSize * 1.8);
  const naturalEmojiSize = fontSize * 0.98;
  const naturalGap = fontSize * 0.2;
  const totalNaturalWidth =
    naturalNameWidth +
    (prefixEmoji ? naturalEmojiSize : 0) +
    (suffixEmoji ? naturalEmojiSize : 0) +
    (prefixEmoji && badgeName ? naturalGap : 0) +
    (suffixEmoji && badgeName ? naturalGap : 0);
  const scale = Math.min(1, BADGE_FRONT_LABEL_MAX_TEXT_WIDTH / totalNaturalWidth);
  const scaledFontSize = fontSize * scale;
  const scaledNameWidth = naturalNameWidth * scale;
  const scaledEmojiSize = naturalEmojiSize * scale;
  const scaledGap = naturalGap * scale;
  const totalWidth =
    scaledNameWidth +
    (prefixEmoji ? scaledEmojiSize : 0) +
    (suffixEmoji ? scaledEmojiSize : 0) +
    (prefixEmoji && badgeName ? scaledGap : 0) +
    (suffixEmoji && badgeName ? scaledGap : 0);
  const startX = BADGE_FRONT_LABEL_CENTER_X - totalWidth / 2;

  let cursorX = startX;
  const nodes: string[] = ['<g aria-label="badge-print-name">'];

  if (prefixEmoji) {
    const prefixDataUrl = await getEmojiDataUrl(prefixEmoji);
    if (prefixDataUrl) {
      nodes.push(`
    <image
      href="${prefixDataUrl}"
      x="${cursorX}"
      y="${BADGE_FRONT_LABEL_CENTER_Y - scaledEmojiSize / 2}"
      width="${scaledEmojiSize}"
      height="${scaledEmojiSize}"
      preserveAspectRatio="xMidYMid meet"
    />`);
      cursorX += scaledEmojiSize;
      if (badgeName) {
        cursorX += scaledGap;
      }
    }
  }

  const textCenterX = cursorX + scaledNameWidth / 2;
  nodes.push(`
    <text
      x="${textCenterX}"
      y="${BADGE_FRONT_LABEL_CENTER_Y}"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="'Montserrat', sans-serif"
      font-size="${scaledFontSize}"
      font-weight="900"
      fill="#111111"
      textLength="${scaledNameWidth}"
      lengthAdjust="spacingAndGlyphs"
    >${escapeXml(badgeName)}</text>`);

  cursorX += scaledNameWidth;
  if (suffixEmoji && badgeName) {
    cursorX += scaledGap;
  }

  if (suffixEmoji) {
    const suffixDataUrl = await getEmojiDataUrl(suffixEmoji);
    if (suffixDataUrl) {
      nodes.push(`
    <image
      href="${suffixDataUrl}"
      x="${cursorX}"
      y="${BADGE_FRONT_LABEL_CENTER_Y - scaledEmojiSize / 2}"
      width="${scaledEmojiSize}"
      height="${scaledEmojiSize}"
      preserveAspectRatio="xMidYMid meet"
    />`);
    }
  }

  nodes.push('\n  </g>\n</svg>');
  return nodes.join('');
};

const normalizeBadgeSourceValue = (badgeName: string): string => {
  const trimmed = badgeName.trim();
  if (!trimmed) {
    return 'Staff';
  }
  const lowerCased = trimmed.toLocaleLowerCase();
  return `${lowerCased.charAt(0).toLocaleUpperCase()}${lowerCased.slice(1)}`;
};

const buildBadgeCampaignUrl = (badgeName: string): string => {
  const url = new URL(BADGE_CAMPAIGN_BASE_URL);
  url.searchParams.set('utm_source', normalizeBadgeSourceValue(badgeName));
  url.searchParams.set('utm_medium', 'Badge');
  url.searchParams.set('utm_campaign', 'Staff');
  return url.toString();
};

const resolveBadgePrintRecipient = (): string => {
  const configured = String(getConfigValue('BADGE_PRINT_RECIPIENT') ?? '').trim();
  return configured || BADGE_PRINT_RECIPIENT_FALLBACK;
};

const buildBadgePrintEmailSubject = (userDisplayName: string): string => {
  const configured = String(getConfigValue('BADGE_PRINT_EMAIL_SUBJECT') ?? '').trim();
  const template = configured || BADGE_PRINT_EMAIL_SUBJECT_FALLBACK;
  return template.replaceAll('{{userDisplayName}}', userDisplayName.trim());
};

const resolveBadgePrintEmailBody = (): string => {
  const configured = String(getConfigValue('BADGE_PRINT_EMAIL_BODY') ?? '').trim();
  return configured || BADGE_PRINT_EMAIL_BODY_FALLBACK;
};

const buildPrintEmailText = (): string => resolveBadgePrintEmailBody();

const buildPrintEmailHtml = (): string =>
  resolveBadgePrintEmailBody()
    .split(/\r?\n\r?\n/)
    .map((paragraph) => `<p>${escapeXml(paragraph).replace(/\r?\n/g, '<br />')}</p>`)
    .join('\n');

const launchBadgeBrowser = async () => {
  const headlessEnv = String(getConfigValue('PUPPETEER_HEADLESS') ?? '').toLowerCase();
  const headlessMode: boolean | 'shell' | undefined =
    headlessEnv === 'shell' ? 'shell' : headlessEnv === 'false' ? false : true;
  return puppeteer.launch({
    headless: headlessMode,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
};

export const renderBadgeSvg = async (options: {
  badgeName: string;
  badgePrefixEmoji?: string | null;
  badgeSuffixEmoji?: string | null;
}): Promise<{ svg: string; fileName: string }> => {
  const badgeName = options.badgeName.trim();
  const badgePrefixEmoji = options.badgePrefixEmoji?.trim() ?? '';
  const badgeSuffixEmoji = options.badgeSuffixEmoji?.trim() ?? '';
  const label = buildBadgeLabel(badgeName, badgePrefixEmoji, badgeSuffixEmoji);

  if (!label) {
    throw new Error('Badge name is required before sending to print.');
  }

  const template = await readFile(BADGE_TEMPLATE_PATH, 'utf8');
  const textNode = await buildBadgeFrontLabelNode(badgeName, badgePrefixEmoji, badgeSuffixEmoji);
  const croppedTemplate = template.replace(
    /<svg\b([^>]*?)\bwidth="[^"]*"\s+height="[^"]*"\s+([^>]*?)viewBox="[^"]*"([^>]*)>/i,
    `<svg$1width="${BADGE_FRONT_EXPORT_VIEWBOX.width}mm" height="${BADGE_FRONT_EXPORT_VIEWBOX.height}mm" $2viewBox="${BADGE_FRONT_EXPORT_VIEWBOX.x} ${BADGE_FRONT_EXPORT_VIEWBOX.y} ${BADGE_FRONT_EXPORT_VIEWBOX.width} ${BADGE_FRONT_EXPORT_VIEWBOX.height}"$3>`,
  );

  return {
    svg: croppedTemplate.replace('</svg>', textNode),
    fileName: `${sanitizeFileName(badgeName)}-guide-badge.svg`,
  };
};

export const renderBadgePdf = async (options: {
  badgeName: string;
  badgePrefixEmoji?: string | null;
  badgeSuffixEmoji?: string | null;
}): Promise<{ pdf: Buffer; fileName: string }> => {
  const { svg, fileName } = await renderBadgeSvg(options);
  const browser = await launchBadgeBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(
      `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap" rel="stylesheet">
          <style>
            @page {
              size: ${BADGE_FRONT_PAGE_WIDTH_MM}mm ${BADGE_FRONT_PAGE_HEIGHT_MM}mm;
              margin: 0;
            }
            html, body {
              margin: 0;
              padding: 0;
              width: ${BADGE_FRONT_PAGE_WIDTH_MM}mm;
              height: ${BADGE_FRONT_PAGE_HEIGHT_MM}mm;
              background: #ffffff;
              overflow: hidden;
            }
            body {
              position: relative;
            }
            svg {
              display: block;
              width: ${BADGE_FRONT_RENDER_WIDTH_MM}mm;
              height: ${BADGE_FRONT_RENDER_HEIGHT_MM}mm;
              position: absolute;
              left: ${BADGE_FRONT_BLEED_OFFSET_MM}mm;
              top: ${BADGE_FRONT_BLEED_OFFSET_MM}mm;
              margin: 0;
              padding: 0;
              overflow: hidden;
              shape-rendering: geometricPrecision;
            }
          </style>
        </head>
        <body>${svg}</body>
      </html>
      `,
      { waitUntil: 'networkidle0' },
    );

    const pdfBytes = await page.pdf({
      width: `${BADGE_FRONT_PAGE_WIDTH_MM}mm`,
      height: `${BADGE_FRONT_PAGE_HEIGHT_MM}mm`,
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    return {
      pdf: pdfBytes,
      fileName: fileName.replace(/\.svg$/i, '.pdf'),
    };
  } finally {
    await browser.close();
  }
};

const buildBadgePrintHtml = async (options: {
  frontSvg: string;
  badgeName: string;
}): Promise<string> => {
  const backsideBuffer = await readFile(BADGE_BACKSIDE_TEMPLATE_PATH);
  const backsideDataUrl = `data:image/png;base64,${backsideBuffer.toString('base64')}`;
  const qrDataUrl = await QRCode.toDataURL(buildBadgeCampaignUrl(options.badgeName), {
    errorCorrectionLevel: 'M',
    margin: 1,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap" rel="stylesheet">
        <style>
          @page {
            size: ${BADGE_FRONT_PAGE_WIDTH_MM}mm ${BADGE_FRONT_PAGE_HEIGHT_MM}mm;
            margin: 0;
          }
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          body {
            font-family: Arial, sans-serif;
          }
          .print-page {
            position: relative;
            width: ${BADGE_FRONT_PAGE_WIDTH_MM}mm;
            height: ${BADGE_FRONT_PAGE_HEIGHT_MM}mm;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
          }
          .print-page:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .front-svg {
            display: block;
            width: ${BADGE_FRONT_RENDER_WIDTH_MM}mm;
            height: ${BADGE_FRONT_RENDER_HEIGHT_MM}mm;
            position: absolute;
            left: ${BADGE_FRONT_BLEED_OFFSET_MM}mm;
            top: ${BADGE_FRONT_BLEED_OFFSET_MM}mm;
            margin: 0;
            padding: 0;
            overflow: hidden;
            shape-rendering: geometricPrecision;
          }
          .backside-image {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            display: block;
          }
          .backside-qr {
            position: absolute;
            left: ${(BADGE_BACKSIDE_QR.left / BADGE_BACKSIDE_IMAGE_WIDTH) * 100}%;
            top: ${(BADGE_BACKSIDE_QR.top / BADGE_BACKSIDE_IMAGE_HEIGHT) * 100}%;
            width: ${(BADGE_BACKSIDE_QR.size / BADGE_BACKSIDE_IMAGE_WIDTH) * 100}%;
            height: ${(BADGE_BACKSIDE_QR.size / BADGE_BACKSIDE_IMAGE_HEIGHT) * 100}%;
            object-fit: contain;
            display: block;
          }
        </style>
      </head>
      <body>
        <section class="print-page">
          ${options.frontSvg.replace('<svg', '<svg class="front-svg"')}
        </section>
        <section class="print-page">
          <img class="backside-image" src="${backsideDataUrl}" alt="Badge backside" />
          <img class="backside-qr" src="${qrDataUrl}" alt="Join the party QR code" />
        </section>
      </body>
    </html>
  `;
};

export const renderBadgePrintPdf = async (options: {
  badgeName: string;
  badgePrefixEmoji?: string | null;
  badgeSuffixEmoji?: string | null;
}): Promise<{ pdf: Buffer; fileName: string }> => {
  const { svg, fileName } = await renderBadgeSvg(options);
  const browser = await launchBadgeBrowser();

  try {
    const page = await browser.newPage();
    const html = await buildBadgePrintHtml({
      frontSvg: svg,
      badgeName: options.badgeName.trim(),
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBytes = await page.pdf({
      width: `${BADGE_FRONT_PAGE_WIDTH_MM}mm`,
      height: `${BADGE_FRONT_PAGE_HEIGHT_MM}mm`,
      preferCSSPageSize: true,
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    return {
      pdf: pdfBytes,
      fileName: fileName.replace(/-guide-badge\.svg$/i, '-badge-print.pdf'),
    };
  } finally {
    await browser.close();
  }
};

export const sendBadgeToPrint = async (options: {
  userDisplayName: string;
  badgeName: string;
  badgePrefixEmoji?: string | null;
  badgeSuffixEmoji?: string | null;
}): Promise<void> => {
  const { pdf, fileName } = await renderBadgePrintPdf(options);

  await sendGmailMessage({
    to: resolveBadgePrintRecipient(),
    subject: buildBadgePrintEmailSubject(options.userDisplayName),
    textBody: buildPrintEmailText(),
    htmlBody: buildPrintEmailHtml(),
    attachments: [
      {
        filename: fileName,
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  });
};
