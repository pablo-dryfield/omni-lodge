import dayjs from 'dayjs';
import { latestCartExperiences } from './storefrontCartExperienceService.js';
import { quoteStorefrontCart } from './storefrontCommerceService.js';
import { normalizeSavedCartFromQuote } from './storefrontSavedCartService.js';
import { randomUUID } from 'node:crypto';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import Product from '../models/Product.js';
import HttpError from '../errors/HttpError.js';
import { dismissCartWithPaidMatch } from './storefrontCartBookingMatchService.js';
import { sendMessage } from './bookings/gmailClient.js';
import { getConfigValue } from './configService.js';
import { RECOVERY_MEETING_POINT_CONFIG_KEY } from '../config/storefrontRecoveryOfferConfig.js';
import logger from '../utils/logger.js';
import type { StorefrontMeetingPoint } from '../types/storefront.js';
import { evaluateRecoveryOffer, type RecoveryOffer } from './storefrontRecoveryOfferService.js';

const SUPPORT_EMAIL = 'pubthroughkrakow@gmail.com';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const header = (value: unknown): string => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const fromAddress = (): string | null => {
  const address = header(getConfigValue('STOREFRONT_EMAIL_FROM_ADDRESS'));
  if (!address) return null;
  const name = header(getConfigValue('STOREFRONT_EMAIL_FROM_NAME'));
  return name ? `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${address}>` : address;
};

const storefrontUrl = (): string => {
  const configured = String(getConfigValue('STOREFRONT_PUBLIC_URL') ?? '').trim();
  return (configured || 'https://krawlthroughkrakow.com/store2').replace(/\/+$/, '');
};

const money = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(amount || 0));

const itemDate = (value: string | null): string => {
  if (!value) return 'Date to be confirmed';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('ddd, D MMM YYYY') : value;
};

const guestLabel = (quantity: number, options: Record<string, unknown>): string => {
  const raw = options?.participants;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `${quantity} guest${quantity === 1 ? '' : 's'}`;
  }
  const participants = raw as Record<string, unknown>;
  const men = Number(participants.men) || 0;
  const women = Number(participants.women) || 0;
  return `${men} ${men === 1 ? 'man' : 'men'}, ${women} ${women === 1 ? 'woman' : 'women'}`;
};

const addonLabel = (addon: StorefrontOngoingCart['quoteSnapshot']['items'][number]['addons'][number]): string => {
  if (addon.variants.length > 0) {
    return `${addon.name}: ${addon.variants.map((variant) => `${variant.value} x ${variant.quantity}`).join(', ')}`;
  }
  return addon.value ? `${addon.name}: ${addon.value}` : `${addon.name} x ${addon.quantity}`;
};

export type StorefrontCartRecoveryProduct = {
  imageUrl: string | null;
  imageAlt: string;
  summary: string;
  highlights: string[];
  meetingPoint?: StorefrontMeetingPoint | null;
};

type RecoveryProducts = ReadonlyMap<number, StorefrontCartRecoveryProduct>;

const safePublicUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
};

const meetingPointDetails = (value: unknown): StorefrontMeetingPoint | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  const text = (key: string): string => {
    const raw = point[key];
    return typeof raw === 'string' ? raw.trim() : '';
  };
  const details = {
    name: text('name'),
    address: text('address'),
    instructions: text('instructions'),
    mapUrl: safePublicUrl(point.mapUrl) ?? '',
    photoUrl: safePublicUrl(point.photoUrl) ?? '',
    photoAlt: text('photoAlt'),
  };
  return [details.name, details.address, details.instructions, details.mapUrl, details.photoUrl].some(Boolean)
    ? details : null;
};

// Use the same configured marketing content in the preview and delivered email.
// Missing imagery must not prevent the customer receiving their recovery link.
export const loadStorefrontCartRecoveryProducts = async (
  ongoing: StorefrontOngoingCart,
): Promise<RecoveryProducts> => {
  const ids = [...new Set(ongoing.quoteSnapshot.items.map((item) => item.productId))];
  if (!ids.length) return new Map();
  try {
    const products = await Product.findAll({
      attributes: ['id', 'name', 'imageUrl', 'images', 'storefrontConfig'],
      where: { id: ids },
    });
    return new Map(products.map((product) => {
      const content = product.storefrontConfig?.content;
      const images = (Array.isArray(product.images) ? [...product.images] : [])
        .sort((a, b) => a.order - b.order);
      const galleryImage = images.find((image) => safePublicUrl(image.url));
      const imageUrl = safePublicUrl(product.imageUrl) ?? safePublicUrl(galleryImage?.url);
      return [product.id, {
        imageUrl,
        imageAlt: galleryImage?.url === imageUrl && galleryImage.alt ? galleryImage.alt : product.name,
        summary: typeof content?.summary === 'string' ? content.summary.trim() : '',
        highlights: Array.isArray(content?.highlights)
          ? content.highlights.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
            .map((value) => value.trim()).slice(0, 3)
          : [],
        meetingPoint: meetingPointDetails(content?.meetingPoint),
      }];
    }));
  } catch (error) {
    logger.warn('[storefront-cart-recovery] Optional product content could not be loaded', error);
    return new Map();
  }
};

const recoveryButton = (url: string, label: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" align="center" class="recovery-button" style="margin:0 auto;width:100%;max-width:340px">
    <tr><td align="center" bgcolor="#ff168f" style="border-radius:6px;mso-padding-alt:18px 22px">
      <a href="${escapeHtml(url)}" style="display:block;padding:18px 22px;border:1px solid #ff168f;border-radius:6px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:.7px;line-height:20px;text-align:center;text-decoration:none">${label} &nbsp;&#8594;</a>
    </td></tr>
  </table>`;

const meetingPointCard = (
  value: StorefrontMeetingPoint | null | undefined,
  item: StorefrontOngoingCart['quoteSnapshot']['items'][number],
  showProductName: boolean,
): string => {
  const point = meetingPointDetails(value);
  if (!point) return '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 17px;background:#110d0f;border:1px solid #49353f;border-left:3px solid #ff168f;border-radius:5px"><tr><td style="padding:20px 16px;text-align:center">
      ${showProductName ? `<h3 style="margin:0 0 13px;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:18px;font-weight:700;line-height:1.4">${escapeHtml(item.productName)}</h3>` : ''}
      <h3 style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;color:#ff59af;font-size:11px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase">Meeting point</h3>
      ${point.name ? `<div style="font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:18px;font-weight:700;line-height:1.4">${escapeHtml(point.name)}</div>` : ''}
      ${point.address ? `<div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;color:#c9bdc2;font-size:13px;line-height:1.6">${escapeHtml(point.address)}</div>` : ''}
      <div style="margin-top:13px;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:14px;font-weight:700;line-height:1.6">${escapeHtml(itemDate(item.experienceDate))}<br><span style="color:#ffd438">${item.experienceTime ? `Starts at ${escapeHtml(item.experienceTime)}` : 'Starting time to be confirmed'}</span>${item.experienceTime ? '<br><span style="color:#c9bdc2;font-size:12px;font-weight:400">Krakow local time</span>' : ''}</div>
      ${point.instructions ? `<div style="margin-top:11px;font-family:Arial,Helvetica,sans-serif;color:#ffd438;font-size:14px;font-weight:700;line-height:1.6">${escapeHtml(point.instructions)}</div>` : ''}
      ${point.photoUrl ? `<img src="${escapeHtml(point.photoUrl)}" alt="${escapeHtml(point.photoAlt || point.name || 'Meeting point')}" width="476" style="display:block;width:100%;max-width:476px;height:auto;margin:16px auto 0;border:0;border-radius:5px;color:#c9bdc2;font-family:Arial,Helvetica,sans-serif;font-size:13px">` : ''}
      ${point.mapUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:16px auto 0"><tr><td bgcolor="#ffd438" style="border-radius:4px;mso-padding-alt:13px 18px"><a href="${escapeHtml(point.mapUrl)}" style="display:inline-block;padding:13px 18px;font-family:Arial,Helvetica,sans-serif;color:#110d0f;font-size:12px;font-weight:800;line-height:18px;text-decoration:none;letter-spacing:.5px">GET MAP DIRECTIONS &nbsp;&#8599;</a></td></tr></table>` : ''}
    </td></tr></table>`;
};

const itemCard = (
  item: StorefrontOngoingCart['quoteSnapshot']['items'][number],
  currency: string,
  showTotal: boolean,
  product?: StorefrontCartRecoveryProduct,
): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#1b1419;border:1px solid #49353f;border-radius:8px;border-collapse:separate;overflow:hidden">
    ${product?.imageUrl ? `<tr><td style="padding:0;text-align:center"><img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.imageAlt)}" width="560" height="250" class="experience-image" style="display:block;width:100%;max-width:560px;height:250px;object-fit:cover;border:0;border-radius:7px 7px 0 0;color:#fff8f2;font-family:Arial,Helvetica,sans-serif;font-size:16px"></td></tr>` : ''}
    <tr><td class="experience-content" style="padding:25px 24px;text-align:center">
      <h2 style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:24px;font-weight:800;line-height:1.3">${escapeHtml(item.productName)}</h2>
      ${product?.summary ? `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;color:#d7cbd1;font-size:14px;line-height:1.65">${escapeHtml(product.summary)}</p>` : ''}
      ${product?.highlights.length ? `<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;color:#ffd438;font-size:13px;line-height:1.8">${product.highlights.map((highlight) => `&#10003; ${escapeHtml(highlight)}`).join('<br>')}</p>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:21px;border-top:1px solid #49353f">
        <tr><td style="padding:17px 0 5px;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:15px;font-weight:700;line-height:1.5">${escapeHtml(itemDate(item.experienceDate))}</td></tr>
        <tr><td style="padding:0 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#ffd438;font-size:16px;font-weight:700;line-height:1.6">${item.experienceTime ? `Starts at ${escapeHtml(item.experienceTime)} <span style="font-size:12px;font-weight:400;color:#c9bdc2">&nbsp;&#183;&nbsp; Krakow local time</span>` : 'Starting time to be confirmed'}</td></tr>
        <tr><td style="padding:0 0 17px;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#c9bdc2;font-size:14px;line-height:1.6">${escapeHtml(guestLabel(item.quantity, item.options))}</td></tr>
      </table>
      ${item.addons.length ? `<div style="padding:16px 0;border-top:1px solid #49353f;text-align:center"><div style="margin-bottom:7px;font-family:Arial,Helvetica,sans-serif;color:#b6a7af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Your extras</div><div style="font-family:Arial,Helvetica,sans-serif;color:#e8dfe3;font-size:13px;line-height:1.8">${item.addons.map((addon) => escapeHtml(addonLabel(addon))).join('<br>')}</div></div>` : ''}
      ${showTotal ? `<div style="padding-top:15px;border-top:1px solid #49353f;font-family:Arial,Helvetica,sans-serif;color:#ffd438;font-size:22px;font-weight:800;line-height:1.4">${escapeHtml(money(item.total, currency))}</div>` : ''}
    </td></tr>
  </table>`;

export const buildStorefrontCartRecoveryEmail = (
  ongoing: Pick<StorefrontOngoingCart, 'publicId' | 'recoveryToken' | 'customer' | 'quoteSnapshot'>,
  products: RecoveryProducts = new Map(),
  offer: RecoveryOffer | null = null,
) => {
  const quote = ongoing.quoteSnapshot;
  const showExperienceTotal = (item: typeof quote.items[number]): boolean =>
    quote.items.length > 1 || money(item.total, quote.currency) !== money(quote.total, quote.currency);
  const meetingItems = getConfigValue(RECOVERY_MEETING_POINT_CONFIG_KEY) === true
    ? quote.items.filter((item) => products.get(item.productId)?.meetingPoint) : [];
  const firstName = ongoing.customer.fullName.trim().split(/\s+/)[0] || 'there';
  const productNames = quote.items.map((item) => item.productName);
  const subjectProduct = productNames.length === 1 ? productNames[0] : 'Krakow experiences';
  const recoveryUrl = `${storefrontUrl()}/cart?recover=${encodeURIComponent(ongoing.publicId)}`
    + (ongoing.recoveryToken ? `&rt=${encodeURIComponent(ongoing.recoveryToken)}` : '');
  const subject = header(`Still thinking about ${subjectProduct}?`);
  const preheader = `${firstName}, your choices are saved. Pick up where you left off and make it a Krakow to remember.`;
  const textBody = [
    `Hi ${firstName},`,
    '',
    'Make it a Krakow to remember.',
    'Still making plans? Your selections are saved, so you can pick up where you left off. Give yourself something to look forward to.',
    '',
    `Continue my booking: ${recoveryUrl}`,
    'You can review your dates, group and extras before paying.',
    '',
    ...quote.items.flatMap((item) => {
      const product = products.get(item.productId);
      return [
        `${item.productName} - ${itemDate(item.experienceDate)}${item.experienceTime ? ` at ${item.experienceTime}` : ''} - ${guestLabel(item.quantity, item.options)}${showExperienceTotal(item) ? ` - ${money(item.total, quote.currency)}` : ''}`,
        ...(product?.summary ? [product.summary] : []),
        ...(product?.highlights ?? []),
        `Starting time: ${item.experienceTime ? `${item.experienceTime} (Krakow local time)` : 'To be confirmed'}`,
        ...item.addons.map(addonLabel),
        '',
      ];
    }),
    '',
    ...(offer ? [
      `A little extra for your plans: save ${money(offer.amount, offer.currency)} with code ${offer.code}.`,
      offer.applyAutomatically ? 'Your code is applied when you open your booking from this email.' : 'Enter this code in your cart before paying.',
      ...(offer.validTo ? [`Coupon expires: ${new Date(offer.validTo).toISOString()}`] : []),
      'Coupon eligibility and availability are checked again at checkout.',
      '',
    ] : []),
    `${offer ? `Total with code ${offer.code}` : 'Cart total'}: ${money(quote.total, quote.currency)}`,
    'Your booking is confirmed only after payment. Final price and availability are checked when you return.',
    `Complete your booking: ${recoveryUrl}`,
    '',
    ...(meetingItems.length ? [
      'Prefer to meet the group first?',
      'Find our team at the meeting point below. You can also pay in cash by speaking to the pub crawl leader at the meeting point.',
      '',
      ...meetingItems.flatMap((item) => {
        const point = products.get(item.productId)?.meetingPoint;
        return [
          `${item.productName} - ${itemDate(item.experienceDate)}`,
          `Starting time: ${item.experienceTime ? `${item.experienceTime} (Krakow local time)` : 'To be confirmed'}`,
          'Meeting point:',
          ...(point?.name ? [point.name] : []),
          ...(point?.address ? [point.address] : []),
          ...(point?.instructions ? [point.instructions] : []),
          ...(point?.mapUrl ? [`Directions: ${point.mapUrl}`] : []),
          ...(point?.photoUrl ? [`Meeting point photo: ${point.photoUrl}`] : []),
          '',
        ];
      }),
      '',
    ] : []),
    `A question before you book? Reply to this email or contact ${SUPPORT_EMAIL}. Our Krakow team is happy to help.`,
    'Already booked? You can ignore this email.',
  ].join('\n');
  const htmlBody = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:480px){.email-shell{padding:12px 8px!important}.email-content{padding-left:20px!important;padding-right:20px!important}.recovery-title{font-size:36px!important}.experience-content{padding:21px 17px!important}.experience-image{height:190px!important}.recovery-button{max-width:100%!important}.desktop-break{display:none!important}}</style></head>
<body style="margin:0;padding:0;background:#080708;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#080708">
    <tr><td align="center" class="email-shell" style="padding:28px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#110d0f;border:1px solid #49353f">
        <tr><td height="5" bgcolor="#ff168f" style="height:5px;background:#ff168f;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:27px 20px;text-align:center;border-bottom:1px solid #35252f">
          <div style="font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:15px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Krawl Through <span style="color:#ffd438">Krakow</span></div>
        </td></tr>
        <tr><td class="email-content" style="padding:36px 28px 29px;text-align:center">
          <div style="font-family:Arial,Helvetica,sans-serif;color:#ff59af;font-size:10px;font-weight:800;letter-spacing:2.2px;text-transform:uppercase">A good plan worth coming back to</div>
          <h1 class="recovery-title" style="margin:15px 0 19px;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:46px;font-weight:800;letter-spacing:-1.5px;line-height:1.08">Make it a Krakow<br><span style="color:#ffd438">to remember.</span></h1>
          <p style="margin:0 0 23px;font-family:Arial,Helvetica,sans-serif;color:#d7cbd1;font-size:16px;line-height:1.75">Hi ${escapeHtml(firstName)}, still making plans?<br>Your selections are saved. Pick up where you left off<br class="desktop-break"> and give yourself something to look forward to.</p>
          ${recoveryButton(recoveryUrl, 'CONTINUE MY BOOKING')}
          <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;color:#b6a7af;font-size:12px;line-height:1.6">Review your dates, group and extras before paying.</p>
        </td></tr>
        <tr><td class="email-content" style="padding:0 28px 28px;text-align:center">
          <div style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;color:#b6a7af;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase">${quote.items.length === 1 ? 'Your saved experience' : 'Your saved experiences'}</div>
          ${quote.items.map((item) => itemCard(item, quote.currency, showExperienceTotal(item), products.get(item.productId))).join('')}
          ${offer ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:5px 0 20px;background:#25131f;border:1px solid #c83d87;border-radius:6px"><tr><td style="padding:23px 18px;text-align:center"><div style="font-family:Arial,Helvetica,sans-serif;color:#ff75be;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">A little extra for your plans</div><h2 style="margin:10px 0;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:25px;line-height:1.3">Save ${escapeHtml(money(offer.amount, offer.currency))}</h2><div style="margin:13px 0;font-family:Courier New,monospace;color:#ffd438;font-size:25px;font-weight:700;letter-spacing:2px;overflow-wrap:anywhere">${escapeHtml(offer.code)}</div><p style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#e8dfe3;font-size:13px;line-height:1.7">${offer.applyAutomatically ? 'Your code is applied when you open your booking from this email.' : 'Enter this code in your cart before paying.'}</p>${offer.validTo ? `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;color:#e8dfe3;font-size:12px;line-height:1.6">Valid until ${escapeHtml(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(offer.validTo)))} (Krakow time).</p>` : ''}<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;color:#b6a7af;font-size:11px;line-height:1.6">Coupon eligibility and availability are checked again at checkout.</p></td></tr></table>` : ''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:5px 0 23px;background:#241c12;border:1px solid #655126;border-radius:6px"><tr><td style="padding:21px 16px;text-align:center">
            <div style="font-family:Arial,Helvetica,sans-serif;color:#dac58d;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase">${offer ? 'Your total with this code' : 'Your saved total'}</div>
            <div style="margin-top:7px;font-family:Arial,Helvetica,sans-serif;color:#ffd438;font-size:34px;font-weight:800;line-height:1.2">${escapeHtml(money(quote.total, quote.currency))}</div>
            ${quote.discountTotal > 0 ? `<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;color:#e8d5a4;font-size:12px;line-height:1.5">Includes ${escapeHtml(money(quote.discountTotal, quote.currency))} in ${offer ? 'discounts with this code' : 'saved discounts'}</div>` : ''}
          </td></tr></table>
          ${recoveryButton(recoveryUrl, 'LET\'S MAKE IT HAPPEN')}
          <p style="margin:13px 0 0;font-family:Arial,Helvetica,sans-serif;color:#b6a7af;font-size:11px;line-height:1.65">Your booking is confirmed only after payment.<br>Final price and availability are checked when you return.</p>
        </td></tr>
        ${meetingItems.length ? `<tr><td class="email-content" style="padding:24px 28px;border-top:1px solid #49353f;text-align:center"><h2 style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:19px;font-weight:700;line-height:1.4">Prefer to meet the group first?</h2><p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;color:#c9bdc2;font-size:14px;line-height:1.7">Find our team at the meeting point below.<br>You can also pay in cash by speaking to the pub crawl leader at the meeting point.</p>${meetingItems.map((item) => meetingPointCard(products.get(item.productId)?.meetingPoint, item, quote.items.length > 1)).join('')}</td></tr>` : ''}
        <tr><td class="email-content" style="padding:25px 28px 28px;border-top:1px solid #49353f;background:#191116;text-align:center">
          <h2 style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;color:#fff8f2;font-size:19px;font-weight:700;line-height:1.4">A question before you book?</h2>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#c9bdc2;font-size:14px;line-height:1.7">Just reply. Our Krakow team is happy to help<br>with your plans, your group or anything else.</p>
          <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6"><a href="mailto:${SUPPORT_EMAIL}" style="color:#ff75be;text-decoration:underline">${SUPPORT_EMAIL}</a></p>
        </td></tr>
      </table>
      <p style="margin:18px 10px 0;font-family:Arial,Helvetica,sans-serif;color:#aa9aa3;font-size:11px;line-height:1.7;text-align:center">Sent because you saved a cart with Krawl Through Krakow.<br>Already booked? You can ignore this email.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, textBody, htmlBody, recoveryUrl };
};

export const prepareStorefrontCartRecoveryEmail = async (ongoing: StorefrontOngoingCart) => {
  const evaluation = await evaluateRecoveryOffer(ongoing);
  const email = buildStorefrontCartRecoveryEmail({
    publicId: ongoing.publicId,
    recoveryToken: evaluation.offer && ongoing.recoveryToken ? `${ongoing.recoveryToken}.${evaluation.previewVersion}` : ongoing.recoveryToken,
    customer: ongoing.customer, quoteSnapshot: evaluation.quote,
  }, await loadStorefrontCartRecoveryProducts(ongoing), evaluation.offer);
  return { ...evaluation, email };
};

export const deliverStorefrontCartRecoveryEmail = async (
  ongoing: StorefrontOngoingCart,
  prepared?: Awaited<ReturnType<typeof prepareStorefrontCartRecoveryEmail>>,
): Promise<{ messageId: string | null }> => {
  const { email } = prepared ?? await prepareStorefrontCartRecoveryEmail(ongoing);
  const result = await sendMessage({
    to: ongoing.customer.email,
    from: fromAddress(),
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
  });
  return { messageId: result.id };
};

export const ensureStorefrontCartRecoveryToken = async (
  ongoing: StorefrontOngoingCart,
): Promise<void> => {
  if (!ongoing.recoveryToken) {
    await ongoing.update({ recoveryToken: randomUUID() });
  }
};

export const refreshDuplicateRecoveryCart = async (ongoing: StorefrontOngoingCart): Promise<void> => {
  const expectedStatus = ongoing.status;
  if (!['active', 'checkout_started', 'sending_recovery', 'recovery_sent'].includes(expectedStatus)) {
    throw new HttpError(409, 'This cart is no longer available for changes.');
  }
  // Old unpaid drafts can still contain selections appended by an earlier storefront.
  // Reprice the latest selection before emailing; completed carts never reach this claimed state.
  if (latestCartExperiences(ongoing.quoteSnapshot.items).length !== ongoing.quoteSnapshot.items.length) {
    const quote = await quoteStorefrontCart(ongoing.cart);
    const [saved] = await StorefrontOngoingCart.update({
      cart: normalizeSavedCartFromQuote(quote), quoteSnapshot: quote, currency: quote.currency, total: quote.total,
      metadata: { ...ongoing.metadata, events: [...(Array.isArray(ongoing.metadata?.events) ? ongoing.metadata.events : []), {
        id: randomUUID(), occurredAt: new Date().toISOString(), type: 'cart_item_updated', severity: 'info',
        message: 'Duplicate unpaid experience selections replaced by the latest selection before recovery email.',
        details: { previousItemCount: ongoing.quoteSnapshot.items.length, itemCount: quote.items.length,
          previousTotal: Number(ongoing.total), total: quote.total, currency: quote.currency,
          previousSelections: ongoing.quoteSnapshot.items.map(({ productId, quantity, experienceDate, experienceTime, addons }) =>
            ({ productId, quantity, experienceDate, experienceTime, addons })) },
      }] },
    }, { where: { id: ongoing.id, status: expectedStatus, updatedAt: ongoing.updatedAt } });
    if (!saved) throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
    await ongoing.reload();
    if (ongoing.status !== expectedStatus) throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
  }
};

export const sendAndRecordStorefrontCartRecoveryEmail = async (
  ongoing: StorefrontOngoingCart,
  expectedPreviewVersion?: string,
): Promise<StorefrontOngoingCart> => {
  await ongoing.reload();
  if (ongoing.status !== 'sending_recovery') {
    throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
  }
  if (await dismissCartWithPaidMatch(ongoing)) {
    throw new HttpError(409, 'This customer already has a matching paid booking. The cart has been removed from ongoing carts.');
  }
  await ongoing.reload();
  if (ongoing.status !== 'sending_recovery') {
    throw new HttpError(409, 'This cart changed before the recovery email could be sent.');
  }
  await refreshDuplicateRecoveryCart(ongoing);
  await ensureStorefrontCartRecoveryToken(ongoing);

  const prepared = await prepareStorefrontCartRecoveryEmail(ongoing);
  if (prepared.error) throw new HttpError(400, prepared.error);
  if (expectedPreviewVersion && expectedPreviewVersion !== prepared.previewVersion) {
    throw new HttpError(409, 'The cart or its recovery offer changed. Review a fresh preview before sending.');
  }
  const result = await deliverStorefrontCartRecoveryEmail(ongoing, prepared);
  const metadata = ongoing.metadata && typeof ongoing.metadata === 'object' ? ongoing.metadata : {};
  const recoveryCount = Number(ongoing.recoveryCount) || Number(metadata.recoveryCount) || 0;
  const sentAt = new Date();
  const [updated] = await StorefrontOngoingCart.update(
    {
      status: 'recovery_sent',
      recoverySentAt: sentAt,
      firstRecoverySentAt: ongoing.firstRecoverySentAt || sentAt,
      lastRecoverySentAt: sentAt,
      recoveryCount: recoveryCount + 1,
      recoveryMessageId: result.messageId,
      recoveryError: null,
      metadata: {
        ...metadata, recoveryCount: recoveryCount + 1,
        recoveryOfferSent: prepared.offer ? { ...prepared.offer, previewVersion: prepared.previewVersion } : null,
        events: [...(Array.isArray(metadata.events) ? metadata.events : []), {
          id: randomUUID(), occurredAt: sentAt.toISOString(), type: 'recovery_email_sent', severity: 'info',
          message: prepared.offer ? `Recovery email sent with coupon ${prepared.offer.code}.` : 'Recovery email sent without a new coupon offer.',
          details: { offer: prepared.offer, warnings: prepared.warnings, previewVersion: prepared.previewVersion },
        }],
      },
    },
    { where: { id: ongoing.id, status: 'sending_recovery' } },
  );
  if (!updated) throw new Error('The cart changed while its recovery email was being sent.');

  await ongoing.reload();
  return ongoing;
};
