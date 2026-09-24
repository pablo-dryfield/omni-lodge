import { up } from '../202609240002-xperiencepoland-resale-parser.js';

describe('XperiencePoland resale parser migration', () => {
  it('queues previously ignored Pub Crawl Krakow resale booking emails', async () => {
    const query = jest.fn().mockResolvedValueOnce([[], 1]);
    const context = { sequelize: { query } } as any;

    await up({ context });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("ingestion_status = 'pending'");
    expect(query.mock.calls[0][0]).toContain("from_address ILIKE '%noreply@pubcrawlkrakow.pl%'");
    expect(query.mock.calls[0][0]).toContain("subject ILIKE 'New Booking:%'");
    expect(query.mock.calls[0][0]).toContain("snippet ILIKE '%New Resale Booking%'");
  });
});
