import HttpError from '../errors/HttpError.js';
import { getConfigValue } from './configService.js';

export type StorefrontBankTransferAccount = {
  beneficiary: string;
  iban: string;
  bic: string | null;
  bankName: string | null;
  instructions: string | null;
};

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const clean = (value: unknown, maxLength: number): string =>
  (typeof value === 'string' ? value : '').trim().slice(0, maxLength);

export const getStorefrontBankTransferAccount = (
  currencyValue: unknown,
): StorefrontBankTransferAccount => {
  const currency = clean(currencyValue, 3).toUpperCase();
  const configured = record(getConfigValue('STOREFRONT_BANK_TRANSFER_ACCOUNTS'));
  const source = record(configured?.[currency]);
  const beneficiary = clean(source?.beneficiary ?? source?.accountHolder, 255);
  const iban = clean(source?.iban ?? source?.accountNumber, 100);
  if (!currency || !source || !beneficiary || !iban) {
    throw new HttpError(
      503,
      `Bank transfer instructions are not configured for ${currency || 'this currency'}.`,
    );
  }

  return {
    beneficiary,
    iban,
    bic: clean(source.bic ?? source.swift, 32) || null,
    bankName: clean(source.bankName, 160) || null,
    instructions: clean(source.instructions, 1000) || null,
  };
};

export const getStorefrontBankTransferDueHours = (): number => {
  const parsed = Number(getConfigValue('STOREFRONT_BANK_TRANSFER_DUE_HOURS'));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 336 ? parsed : 48;
};
