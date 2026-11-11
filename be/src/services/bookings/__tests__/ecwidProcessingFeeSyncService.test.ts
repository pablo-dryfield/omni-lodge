jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../../finance/services/stripeClient.js', () => ({ getStripeClient: jest.fn() }));
jest.mock('../../ecwidService.js', () => ({ getEcwidOrder: jest.fn() }));
jest.mock('../../../utils/logger.js', () => ({ __esModule: true, default: { warn: jest.fn() } }));

import Booking from '../../../models/Booking';
import { getStripeClient } from '../../../finance/services/stripeClient';
import { getEcwidOrder } from '../../ecwidService';
import { syncEcwidBookingProcessingFeeByBookingId } from '../ecwidProcessingFeeSyncService';

const client = { charges: { retrieve: jest.fn() }, paymentIntents: { retrieve: jest.fn() } };
const related = (id: number, currency = 'PLN') => ({ id, currency, processingFee: null as string | null,
  processingFeeCurrency: null as string | null, paymentMethodCountry: null, ipAddress: null, save: jest.fn() });
const charge = (balance: unknown) => ({ id: 'ch_One', currency: 'eur', paid: true, captured: true,
  payment_method_details: { card: { country: 'PL' } }, balance_transaction: balance });

beforeEach(() => {
  jest.clearAllMocks();
  (Booking.findByPk as jest.Mock).mockResolvedValue({ id: 1, platform: 'ecwid', platformOrderId: 'ABC' });
  (getEcwidOrder as jest.Mock).mockResolvedValue({ externalTransactionId: 'ch_One', ipAddress: '192.0.2.1' });
  (getStripeClient as jest.Mock).mockReturnValue(client);
});

it('uses the same exact currency-safe allocation on later Ecwid reimports', async () => {
  const a = related(1, 'EUR'), b = related(2, 'EUR');
  (Booking.findAll as jest.Mock).mockResolvedValue([a, b]);
  client.charges.retrieve.mockResolvedValue(charge({ id: 'txn_One', fee: 1000, currency: 'pln', exchange_rate: 4.3 }));
  await syncEcwidBookingProcessingFeeByBookingId(1);
  expect(a).toMatchObject({ processingFee: '1.17', processingFeeCurrency: 'EUR', paymentMethodCountry: 'PL', ipAddress: '192.0.2.1' });
  expect(b).toMatchObject({ processingFee: '1.16', processingFeeCurrency: 'EUR' });
  expect(a.save).toHaveBeenCalledTimes(1);
});

it.each([null, { id: 'txn_One', fee: 1000, currency: 'pln', exchange_rate: null }])('does not guess fees while retaining country/IP enrichment: %j', async balance => {
  const a = related(1, 'EUR');
  (Booking.findAll as jest.Mock).mockResolvedValue([a]);
  client.charges.retrieve.mockResolvedValue(charge(balance));
  await syncEcwidBookingProcessingFeeByBookingId(1);
  expect(a).toMatchObject({ processingFee: null, processingFeeCurrency: null, paymentMethodCountry: 'PL', ipAddress: '192.0.2.1' });
});

it('records a verified provider zero instead of treating it as unavailable', async () => {
  const a = related(1, 'EUR'); (Booking.findAll as jest.Mock).mockResolvedValue([a]);
  client.charges.retrieve.mockResolvedValue(charge({ id: 'txn_One', fee: 0, currency: 'eur', exchange_rate: null }));
  await syncEcwidBookingProcessingFeeByBookingId(1);
  expect(a).toMatchObject({ processingFee: '0.00', processingFeeCurrency: 'EUR' });
});
