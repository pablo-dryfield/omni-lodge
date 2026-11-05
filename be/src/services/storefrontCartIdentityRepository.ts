import { Op, fn, col, where, type Transaction } from 'sequelize';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import { normalizedCartEmail, normalizedCartName, normalizedCartPhone, type CartCustomerIdentity } from './storefrontCartIdentity.js';

export const ACTIVE_CART_STATUSES = ['active', 'checkout_started', 'sending_recovery', 'recovery_sent'];

export const cartCustomerWhere = (customer: CartCustomerIdentity, booking = false) => {
  const textField = (key: string) => booking
    ? key === 'fullName' ? fn('concat_ws', ' ', col('guest_first_name'), col('guest_last_name')) : col(key === 'phone' ? 'guest_phone' : 'guest_email')
    : fn('jsonb_extract_path_text', col('customer'), key);
  const conditions = [];
  const email = normalizedCartEmail(customer.email), name = normalizedCartName(customer.fullName), phone = normalizedCartPhone(customer);
  if (email) conditions.push(where(fn('lower', fn('btrim', textField('email'))), email));
  if (name) conditions.push(where(fn('lower', fn('regexp_replace', fn('btrim', textField('fullName')), '\\s+', ' ', 'g')), name));
  if (phone) {
    const parsed = parsePhoneNumberFromString(phone)!;
    const variants = [...new Set([phone.replace(/\D/g, ''), `00${phone.slice(1)}`, String(parsed.nationalNumber), `0${parsed.nationalNumber}`])];
    conditions.push(where(fn('regexp_replace', textField('phone'), '[^0-9]', '', 'g'), { [Op.in]: variants }));
  }
  return { [Op.or]: conditions };
};

export const findCartIdentityCandidates = async (customer: CartCustomerIdentity, transaction?: Transaction, statuses = ACTIVE_CART_STATUSES, lock = true) =>
  StorefrontOngoingCart.findAll({
    where: { status: { [Op.in]: statuses }, ...cartCustomerWhere(customer) },
    order: [['lastActivityAt', 'DESC'], ['id', 'DESC']],
    transaction,
    ...(transaction && lock ? { lock: transaction.LOCK.UPDATE } : {}),
  });
