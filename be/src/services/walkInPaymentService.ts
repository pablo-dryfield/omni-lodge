import PaymentMethod from '../models/PaymentMethod.js';
import HttpError from '../errors/HttpError.js';
import { normalizeWalkInPaymentNotes } from './walkInPaymentUtils.js';

export async function validateCounterWalkInNotes(notes: string | null | undefined) {
  if (notes != null && typeof notes !== 'string') throw new HttpError(400, 'Counter notes must be text.');
  if (notes == null || !notes.includes('-- CASH-SNAPSHOT START --')) return notes;
  const methods = await PaymentMethod.findAll({ attributes: ['id', 'name'] });
  try { return normalizeWalkInPaymentNotes(notes, methods); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid Walk-Ins payment details.'); }
}
