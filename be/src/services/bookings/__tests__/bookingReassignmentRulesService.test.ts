jest.mock('../../../models/Product.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn(),
}));

import Product from '../../../models/Product.js';
import { getConfigValue } from '../../configService.js';
import {
  applyAutomaticBookingReassignmentRules,
  normalizeAutomaticBookingReassignmentRules,
} from '../bookingReassignmentRulesService.js';

const mockGetConfigValue = getConfigValue as jest.Mock;
const mockProduct = Product as unknown as {
  findAll: jest.Mock;
  findByPk: jest.Mock;
};

describe('automatic booking reassignment rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfigValue.mockImplementation((key: string) => {
      if (key === 'BOOKING_PARSER_TIMEZONE') {
        return 'Europe/Warsaw';
      }
      return null;
    });
    mockProduct.findAll.mockResolvedValue([]);
    mockProduct.findByPk.mockResolvedValue(null);
  });

  it('normalizes aliases and ignores disabled rules', () => {
    const rules = normalizeAutomaticBookingReassignmentRules([
      {
        id: 'halloween',
        platform: 'Viator',
        productName: 'Pub Crawl',
        date: '2026-10-31',
        time: '9:00',
        reassignProductId: '51',
      },
      {
        id: 'disabled',
        enabled: false,
        targetProductName: 'Should not appear',
      },
    ]);

    expect(rules).toEqual([
      expect.objectContaining({
        id: 'halloween',
        platform: 'Viator',
        sourceProductName: 'Pub Crawl',
        sourceDate: '2026-10-31',
        sourceTime: '09:00',
        targetProductId: 51,
      }),
    ]);
  });

  it('reassigns matching incoming bookings to the target product', async () => {
    mockGetConfigValue.mockImplementation((key: string) => {
      if (key === 'BOOKING_AUTOMATIC_REASSIGNMENT_RULES') {
        return {
          rules: [
            {
              id: 'halloween-viator-9pm',
              platform: 'viator',
              sourceProductName: 'Pub Crawl',
              sourceDate: '2026-10-31',
              sourceTime: '21:00',
              targetProductId: 51,
            },
          ],
        };
      }
      if (key === 'BOOKING_PARSER_TIMEZONE') {
        return 'Europe/Warsaw';
      }
      return null;
    });
    mockProduct.findByPk.mockResolvedValue({ id: 51, name: 'Halloween Pub Crawl' });

    const result = await applyAutomaticBookingReassignmentRules(
      {
        platform: 'viator',
        productName: 'Pub Crawl',
        experienceDate: '2026-10-31',
        experienceStartAt: new Date('2026-10-31T20:00:00.000Z'),
      },
      {},
      { timezoneName: 'Europe/Warsaw' },
    );

    expect(result.matchedRule?.id).toBe('halloween-viator-9pm');
    expect(result.patch).toMatchObject({
      productId: 51,
      productName: 'Halloween Pub Crawl',
    });
  });

  it('can reassign date and time while preserving the existing target date when only time changes', async () => {
    mockGetConfigValue.mockImplementation((key: string) => {
      if (key === 'BOOKING_AUTOMATIC_REASSIGNMENT_RULES') {
        return {
          rules: [
            {
              id: 'late-special',
              platform: 'getyourguide',
              targetTime: '22:00',
            },
          ],
        };
      }
      if (key === 'BOOKING_PARSER_TIMEZONE') {
        return 'Europe/Warsaw';
      }
      return null;
    });

    const result = await applyAutomaticBookingReassignmentRules(
      {
        platform: 'getyourguide',
        productName: 'Pub Crawl',
        experienceDate: '2026-10-31',
        experienceStartAt: new Date('2026-10-31T20:00:00.000Z'),
      },
      {},
      { timezoneName: 'Europe/Warsaw' },
    );

    expect(result.matchedRule?.id).toBe('late-special');
    expect(result.patch.experienceDate).toBeUndefined();
    expect(result.patch.experienceStartAt?.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });
});
