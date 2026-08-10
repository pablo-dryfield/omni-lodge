import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op } from 'sequelize';
import Booking from '../../models/Booking.js';
import BookingAddon from '../../models/BookingAddon.js';
import Addon from '../../models/Addon.js';
import EmailTemplate from '../../models/EmailTemplate.js';
import { getConfigValue } from '../configService.js';
import { getTshirtVariantAvailability } from '../inventoryService.js';
import { renderStoredEmailTemplate, type EmailTemplateContext } from '../emailTemplates/emailTemplateRenderer.js';
import { sendMessage as sendGmailMessage } from './gmailClient.js';
import logger from '../../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export type TshirtSizeEmailAutomationOutcome =
  | 'disabled'
  | 'ineligible'
  | 'already_sent'
  | 'already_processing'
  | 'sent'
  | 'failed';

const EMAIL_ADDRESS_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const DISPLAY_TIMEZONE = 'Europe/Warsaw';

const formatVariantList = (variants: string[]): string => {
  if (variants.length <= 1) return variants[0] ?? '';
  if (variants.length === 2) return `${variants[0]} and ${variants[1]}`;
  return `${variants.slice(0, -1).join(', ')}, and ${variants[variants.length - 1]}`;
};

const getTshirtQuantityFromSnapshot = (snapshot: Record<string, unknown> | null): number => {
  if (!snapshot) return 0;
  const extras = snapshot.extras;
  if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
    const quantity = Math.max(0, Math.round(Number((extras as Record<string, unknown>).tshirts) || 0));
    if (quantity > 0) return quantity;
  }

  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  return items.reduce((total, rawItem) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return total;
    const item = rawItem as Record<string, unknown>;
    const name = String(item.name ?? item.platformAddonName ?? item.label ?? '').toLowerCase();
    if (!name.includes('shirt')) return total;
    return total + Math.max(0, Math.round(Number(item.quantity ?? item.qty ?? 1) || 0));
  }, 0);
};

const getTshirtQuantity = async (booking: Booking): Promise<number> => {
  const snapshotQuantity = getTshirtQuantityFromSnapshot(booking.addonsSnapshot);
  if (snapshotQuantity > 0) return snapshotQuantity;

  const [addonRows, tshirtAddons] = await Promise.all([
    BookingAddon.findAll({
      attributes: ['addonId', 'platformAddonName', 'quantity'],
      where: { bookingId: booking.id },
    }),
    Addon.findAll({
      attributes: ['id'],
      where: { name: { [Op.iLike]: '%shirt%' } },
    }),
  ]);
  const tshirtAddonIds = new Set(tshirtAddons.map((addon) => addon.id));
  return addonRows.reduce((total, addon) => {
    const isTshirt =
      (addon.addonId != null && tshirtAddonIds.has(addon.addonId)) ||
      String(addon.platformAddonName ?? '').toLowerCase().includes('shirt');
    return isTshirt ? total + Math.max(0, Math.round(Number(addon.quantity) || 0)) : total;
  }, 0);
};

const markFailed = async (bookingId: number, error: string): Promise<void> => {
  await Booking.update(
    {
      tshirtSizeEmailStatus: 'failed',
      tshirtSizeEmailError: error.slice(0, 4000),
    },
    { where: { id: bookingId, tshirtSizeEmailStatus: { [Op.ne]: 'sent' } } },
  );
};

export const maybeSendTshirtSizeSelectionEmail = async (
  bookingId: number,
): Promise<TshirtSizeEmailAutomationOutcome> => {
  if (getConfigValue('BOOKING_TSHIRT_SIZE_EMAIL_AUTO_SEND') !== true) return 'disabled';

  const booking = await Booking.findByPk(bookingId);
  if (!booking || booking.status === 'cancelled') return 'ineligible';
  if (booking.tshirtSizeEmailStatus === 'sent') return 'already_sent';
  if (
    booking.tshirtSizeEmailStatus === 'sending' &&
    booking.tshirtSizeEmailAttemptedAt &&
    booking.tshirtSizeEmailAttemptedAt.getTime() > Date.now() - CLAIM_TIMEOUT_MS
  ) {
    return 'already_processing';
  }

  const tshirtsCount = await getTshirtQuantity(booking);
  if (tshirtsCount <= 0) return 'ineligible';

  const customerEmail = String(booking.guestEmail ?? '').trim();
  if (!EMAIL_ADDRESS_REGEX.test(customerEmail)) {
    await markFailed(booking.id, 'Automatic T-shirt size email requires a valid customer email address.');
    return 'failed';
  }

  const templateName = String(getConfigValue('BOOKING_TSHIRT_SIZE_EMAIL_TEMPLATE_NAME') ?? '').trim();
  const template = templateName
    ? await EmailTemplate.findOne({ where: { name: { [Op.iLike]: templateName }, isActive: true } })
    : null;
  if (!template) {
    await markFailed(
      booking.id,
      templateName
        ? `Active email template "${templateName}" was not found.`
        : 'No T-shirt size-selection email template is configured in the Control Panel.',
    );
    return 'failed';
  }

  const tshirtVariants = await getTshirtVariantAvailability();
  const availableTshirtVariants = tshirtVariants.filter((variant) => variant.inStock);
  const availableTshirtSizes = availableTshirtVariants.map((variant) => variant.variant);
  if (availableTshirtSizes.length === 0) {
    await markFailed(booking.id, 'No T-shirt sizes are currently in stock, so the automatic email was not sent.');
    return 'failed';
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const [claimed] = await Booking.update(
    {
      tshirtSizeEmailStatus: 'sending',
      tshirtSizeEmailAttemptedAt: now,
      tshirtSizeEmailError: null,
    },
    {
      where: {
        id: booking.id,
        [Op.or]: [
          { tshirtSizeEmailStatus: { [Op.is]: null } },
          { tshirtSizeEmailStatus: 'failed' },
          {
            tshirtSizeEmailStatus: 'sending',
            tshirtSizeEmailAttemptedAt: { [Op.lt]: staleBefore },
          },
        ],
      },
    },
  );
  if (claimed === 0) {
    const current = await Booking.findByPk(booking.id, { attributes: ['tshirtSizeEmailStatus'] });
    return current?.tshirtSizeEmailStatus === 'sent' ? 'already_sent' : 'already_processing';
  }

  const customerName = [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ').trim() || 'Guest';
  const bookingDate = String(booking.experienceDate ?? '').trim();
  const context: EmailTemplateContext = {
    customerName,
    customerEmail,
    productName: booking.productName ?? 'Booking',
    bookingDate,
    bookingDateDisplay: bookingDate && dayjs(bookingDate).isValid() ? dayjs(bookingDate).format('ddd, MMM D YYYY') : bookingDate,
    bookingTime: booking.experienceStartAt && dayjs(booking.experienceStartAt).isValid()
      ? dayjs(booking.experienceStartAt).tz(DISPLAY_TIMEZONE).format('HH:mm')
      : '',
    bookingId: booking.id,
    bookingReference: booking.platformBookingId || String(booking.id),
    reservationId: booking.platformBookingId || String(booking.id),
    platformBookingId: booking.platformBookingId,
    platform: booking.platform,
    tshirtsCount,
    extrasTshirts: tshirtsCount,
    tshirtVariants,
    availableTshirtVariants,
    availableTshirtSizes,
    availableTshirtSizesText: formatVariantList(availableTshirtSizes),
    hasAvailableTshirtSizes: true,
  };

  try {
    const rendered = await renderStoredEmailTemplate({ template, context });
    const rfcMessageId = `<omni-lodge-tshirt-size-booking-${booking.id}@omni-lodge.local>`;
    const result = await sendGmailMessage({
      to: customerEmail,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
      rfcMessageId,
    });
    await Booking.update(
      {
        tshirtSizeEmailStatus: 'sent',
        tshirtSizeEmailSentAt: new Date(),
        tshirtSizeEmailMessageId: result.id ?? result.rfcMessageId ?? rfcMessageId,
        tshirtSizeEmailError: null,
      },
      { where: { id: booking.id } },
    );
    logger.info(`[booking-email] Automatically sent T-shirt size request for booking ${booking.id}.`);
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send automatic T-shirt size email.';
    await markFailed(booking.id, message);
    logger.error(`[booking-email] Automatic T-shirt size request failed for booking ${booking.id}: ${message}`);
    return 'failed';
  }
};
