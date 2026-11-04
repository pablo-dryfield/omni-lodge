jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
import BookingEvent from '../../../models/BookingEvent.js';
import { findNewerLocalBookingOverride } from '../localBookingOverrideHistory.js';

const incoming = new Date('2027-01-01T00:00:00Z');
beforeEach(() => jest.resetAllMocks());
it('protects a newer product reassignment saved from a native amendment screen', async () => {
  const event = { occurredAt: new Date('2027-01-02T00:00:00Z'), eventPayload: { source: 'manual', productChangeLocalOnly: true } } as BookingEvent;
  jest.mocked(BookingEvent.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(event);
  expect(await findNewerLocalBookingOverride(42, incoming)).toBe(event);
});
it('allows a genuinely newer provider amendment to apply', async () => {
  const event = { occurredAt: new Date('2026-12-31T00:00:00Z'), eventPayload: { source: 'manual', productChangeLocalOnly: true } } as BookingEvent;
  jest.mocked(BookingEvent.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(event);
  expect(await findNewerLocalBookingOverride(42, incoming)).toBeNull();
});
it('retains the existing force-amendment protection without another history query', async () => {
  const event = { occurredAt: incoming, eventPayload: { source: 'manifest-local-action', localOnly: true } } as BookingEvent;
  jest.mocked(BookingEvent.findOne).mockResolvedValueOnce(event);
  expect(await findNewerLocalBookingOverride(42, incoming)).toBe(event);
  expect(BookingEvent.findOne).toHaveBeenCalledTimes(1);
});
