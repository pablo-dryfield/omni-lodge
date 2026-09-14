import type { QueryInterface } from 'sequelize';

import { up } from '../202511230002-venue-compensation-term-rates.js';

describe('venue compensation term rates migration', () => {
  it('casts the backfilled ticket type to the PostgreSQL enum', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const query = jest.fn().mockResolvedValue(undefined);
    const context = {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      createTable: jest.fn().mockResolvedValue(undefined),
      addIndex: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryInterface;

    await up({ context });

    const backfill = query.mock.calls
      .map(([sql]) => sql as string)
      .find((sql) => sql.includes('INSERT INTO venue_compensation_term_rates'));
    expect(backfill).toContain(
      "'generic'::\"enum_venue_compensation_term_rates_ticket_type\" AS ticket_type",
    );
    expect(backfill).toContain(
      'rate_unit::text::"enum_venue_compensation_term_rates_rate_unit" AS rate_unit',
    );
    expect(backfill).toMatch(
      /INSERT INTO venue_compensation_term_rates\s*\([\s\S]*?rate_amount,\s*rate_unit,\s*valid_from,[\s\S]*?\)\s*SELECT/u,
    );
    expect(backfill).toMatch(
      /SELECT[\s\S]*?rate_amount,\s*rate_unit::text::"enum_venue_compensation_term_rates_rate_unit" AS rate_unit,\s*valid_from,/u,
    );
    expect(backfill).not.toContain("'generic'::TEXT AS ticket_type");
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
