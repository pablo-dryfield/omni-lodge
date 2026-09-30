jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));

jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn(() => null),
}));

import { normalizeProductForMatch } from '../bookingIngestionService';

describe('booking ingestion product matching', () => {
  it('matches Airbnb public product labels to the internal Pub Crawl product', () => {
    expect(normalizeProductForMatch('Krawl Through Krakow Pub Crawl')).toBe('pub crawl');
    expect(normalizeProductForMatch('Pub Crawl')).toBe('pub crawl');
  });
});
