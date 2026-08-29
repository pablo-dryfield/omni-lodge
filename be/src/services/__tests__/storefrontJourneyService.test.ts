import StorefrontJourneyEvent from '../../models/StorefrontJourneyEvent';
import StorefrontJourneyVisit from '../../models/StorefrontJourneyVisit';
import { Op } from 'sequelize';
import {
  ingestClientJourneyEvents,
  normalizeClientJourneyEvents,
  purgeExpiredStorefrontJourneyDetails,
} from '../storefrontJourneyService';

jest.mock('../../models/StorefrontJourneyEvent.js', () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn(), findAll: jest.fn(), destroy: jest.fn() },
}));
jest.mock('../../models/StorefrontJourneyVisit.js', () => ({
  __esModule: true,
  default: { findOrCreate: jest.fn(), findOne: jest.fn(), create: jest.fn(), findAll: jest.fn() },
}));

const eventModel = StorefrontJourneyEvent as unknown as { bulkCreate: jest.Mock; destroy: jest.Mock };
const visitModel = StorefrontJourneyVisit as unknown as { findOrCreate: jest.Mock };

const context = {
  browserId: '85cf256c-3147-4f6e-a276-b364c7b9bdb4',
  pageId: '9f1cb043-59d8-4dca-9a46-c03706f50ab7',
  claritySampled: false,
};

describe('storefront journey service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts known activity and removes contact values from details', () => {
    const now = new Date('2026-08-28T12:00:00Z');
    const result = normalizeClientJourneyEvents([{
      eventId: '319a56f6-57ab-4d40-8cdd-2d9949f30ab2',
      visitId: 'c3c7d60f-b420-4925-892f-00484ce786cd',
      type: 'contact_information_valid',
      occurredAt: '2026-08-28T11:59:00Z',
      sequence: 7,
      details: {
        fullName: 'Private Person',
        email: 'private@example.com',
        phone: '500100200',
        validFields: 4,
      },
    }], context, now);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'contact_information_valid',
      sequence: 7,
      details: { validFields: 4 },
    });
    expect(JSON.stringify(result)).not.toContain('private@example.com');
    expect(JSON.stringify(result)).not.toContain('Private Person');
  });

  it('rejects unknown event types and malformed identifiers', () => {
    expect(normalizeClientJourneyEvents([
      {
        eventId: '319a56f6-57ab-4d40-8cdd-2d9949f30ab2',
        visitId: 'c3c7d60f-b420-4925-892f-00484ce786cd',
        type: 'keystroke_recorded',
      },
      {
        eventId: 'not-a-uuid',
        visitId: 'c3c7d60f-b420-4925-892f-00484ce786cd',
        type: 'cart_opened',
      },
    ], context)).toEqual([]);
  });

  it('accepts payment completion without retaining sensitive field details', () => {
    const result = normalizeClientJourneyEvents([{
      eventId: '319a56f6-57ab-4d40-8cdd-2d9949f30ab2',
      visitId: 'c3c7d60f-b420-4925-892f-00484ce786cd',
      type: 'payment_details_completed',
      occurredAt: '2026-08-28T11:59:00Z',
      sequence: 12,
      details: {
        orderPublicId: 'order-reference',
        cardNumber: 'not-retained',
        expiry: 'not-retained',
        cvc: 'not-retained',
      },
    }], context, new Date('2026-08-28T12:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'payment_details_completed',
      details: { orderPublicId: 'order-reference' },
    });
    expect(JSON.stringify(result)).not.toContain('not-retained');
  });

  it('preserves cart item snapshots and nested add-on variants without contact details', () => {
    const result = normalizeClientJourneyEvents([{
      eventId: '319a56f6-57ab-4d40-8cdd-2d9949f30ab2',
      visitId: 'c3c7d60f-b420-4925-892f-00484ce786cd',
      type: 'cart_item_updated',
      occurredAt: '2026-08-28T11:59:00Z',
      sequence: 13,
      details: {
        cartItemId: '28-1787920000000',
        cartItemNumber: 2,
        productName: 'Pub Crawl',
        previousItem: {
          quantity: 4,
          participants: { men: 4, women: 0 },
          addons: [],
        },
        newItem: {
          quantity: 4,
          participants: { men: 4, women: 0 },
          addons: [{
            addonId: 2,
            name: 'T-Shirts',
            quantity: 3,
            variants: [
              { value: 'S', quantity: 1 },
              { value: 'M', quantity: 2 },
            ],
          }],
          customer: {
            fullName: 'Private Person',
            email: 'private@example.com',
            phone: '+48123456789',
          },
        },
      },
    }], context, new Date('2026-08-28T12:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0].details).toMatchObject({
      cartItemId: '28-1787920000000',
      cartItemNumber: 2,
      newItem: {
        addons: [{
          name: 'T-Shirts',
          variants: [
            { value: 'S', quantity: 1 },
            { value: 'M', quantity: 2 },
          ],
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('Private Person');
    expect(JSON.stringify(result)).not.toContain('private@example.com');
    expect(JSON.stringify(result)).not.toContain('+48123456789');
  });

  it('stores a qualified visit and acknowledges the accepted event identifiers', async () => {
    const update = jest.fn();
    visitModel.findOrCreate.mockResolvedValue([{
      id: 41,
      ongoingCartId: 73,
      browserInstanceId: context.browserId,
      lastPageId: context.pageId,
      lastActivityAt: new Date('2026-08-28T11:50:00Z'),
      claritySampled: false,
      claritySessionId: null,
      update,
    }, false]);
    eventModel.bulkCreate.mockResolvedValue([]);

    const result = await ingestClientJourneyEvents({ id: 73 } as never, [{
      eventId: '319a56f6-57ab-4d40-8cdd-2d9949f30ab2',
      visitId: 'c3c7d60f-b420-4925-892f-00484ce786cd',
      pageId: context.pageId,
      type: 'add_to_cart',
      occurredAt: new Date().toISOString(),
      sequence: 11,
      details: { productName: 'Pub Crawl' },
    }], context);

    expect(result.acceptedEventIds).toEqual(['319a56f6-57ab-4d40-8cdd-2d9949f30ab2']);
    expect(eventModel.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({
        ongoingCartId: 73,
        visitId: 41,
        type: 'add_to_cart',
        source: 'client',
      }),
    ], { ignoreDuplicates: true });
  });

  it('expires only low-value client detail events after the configured retention period', async () => {
    eventModel.destroy.mockResolvedValue(12);
    const now = new Date('2026-08-28T12:00:00Z');

    await expect(purgeExpiredStorefrontJourneyDetails(90, now)).resolves.toBe(12);

    const where = eventModel.destroy.mock.calls[0][0].where;
    expect(where.source).toBe('client');
    expect(where.type[Op.notIn]).toEqual(expect.arrayContaining([
      'payment_details_completed',
      'payment_attempted',
      'payment_error',
      'payment_authentication_cancelled',
      'recovery_email_opened',
    ]));
    expect(where.occurredAt[Op.lt]).toEqual(new Date('2026-05-30T12:00:00Z'));
  });
});
