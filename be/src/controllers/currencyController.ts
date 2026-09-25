import type { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Currency from '../models/Currency.js';
import CurrencyExchangeRate from '../models/CurrencyExchangeRate.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const normalizeCode = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const parseCurrencyPayload = (body: Record<string, unknown>) => {
  const code = normalizeCode(body.code);
  if (!CURRENCY_PATTERN.test(code)) {
    throw new Error('Currency code must be a three-letter ISO code.');
  }
  const name = String(body.name ?? code).trim().slice(0, 120) || code;
  const exchangeRateToPln = code === 'PLN' ? 1 : Number(body.exchangeRateToPln);
  if (!Number.isFinite(exchangeRateToPln) || exchangeRateToPln <= 0) {
    throw new Error('Exchange rate to PLN must be greater than zero.');
  }
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
  return { code, name, exchangeRateToPln, isActive };
};

const buildColumns = () => {
  const attributes = Currency.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

const actorId = (request: Request): number | null => {
  const value = Number((request as AuthenticatedRequest).authContext?.id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

const recordExchangeRate = async (
  currency: Currency,
  request: Request,
  note?: string,
): Promise<void> => {
  await CurrencyExchangeRate.create({
    currencyCode: currency.code,
    exchangeRateToPln: Number(currency.exchangeRateToPln),
    effectiveAt: currency.lastRateUpdatedAt ?? new Date(),
    source: 'manual',
    note: note || null,
    createdBy: actorId(request),
  });
};

export const listCurrencies = async (_req: Request, res: Response): Promise<void> => {
  const data = await Currency.findAll({ order: [['code', 'ASC']] });
  res.json([{ data, columns: buildColumns() }]);
};

export const listCurrencyOptions = async (_req: Request, res: Response): Promise<void> => {
  const data = await Currency.findAll({
    where: { isActive: true },
    attributes: ['code', 'name', 'exchangeRateToPln', 'isActive', 'lastRateUpdatedAt'],
    order: [['code', 'ASC']],
  });
  res.json({ data });
};

export const createCurrency = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const payload = parseCurrencyPayload(req.body ?? {});
    const created = await Currency.create({
      ...payload,
      lastRateUpdatedAt: now,
    });
    await recordExchangeRate(created, req, 'Initial rate');
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
};

export const updateCurrency = async (req: Request, res: Response): Promise<void> => {
  const code = normalizeCode(req.params.code);
  const currency = await Currency.findByPk(code);
  if (!currency) {
    res.status(404).json({ message: 'Currency not found.' });
    return;
  }
  try {
    const payload = parseCurrencyPayload({ ...req.body, code });
    const previousRate = Number(currency.exchangeRateToPln);
    const nextRate = Number(payload.exchangeRateToPln);
    const rateChanged = Math.abs(previousRate - nextRate) > 0.000001;
    await currency.update({
      name: payload.name,
      exchangeRateToPln: nextRate,
      isActive: payload.isActive,
      lastRateUpdatedAt: rateChanged ? new Date() : currency.lastRateUpdatedAt,
    });
    if (rateChanged) {
      await recordExchangeRate(currency, req, String(req.body?.note ?? '').trim().slice(0, 1000));
    }
    res.json(currency);
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
};

export const deleteCurrency = async (req: Request, res: Response): Promise<void> => {
  const code = normalizeCode(req.params.code);
  if (code === 'PLN') {
    res.status(400).json({ message: 'PLN cannot be deleted.' });
    return;
  }
  const deleted = await Currency.destroy({ where: { code } });
  if (!deleted) {
    res.status(404).json({ message: 'Currency not found.' });
    return;
  }
  res.status(204).send();
};

export const listCurrencyExchangeRateHistory = async (req: Request, res: Response): Promise<void> => {
  const code = normalizeCode(req.params.code);
  const data = await CurrencyExchangeRate.findAll({
    where: { currencyCode: code },
    order: [['effectiveAt', 'DESC'], ['id', 'DESC']],
    limit: 200,
  });
  res.json({ data });
};
