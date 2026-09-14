import type { QueryInterface } from 'sequelize';

import { up } from '../202510020002-pub-crawl-seed.js';

describe('pub crawl seed migration', () => {
  it('reads product metadata from the historical camel-case columns', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const query = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM channels')) return [{ id: 1 }];
      if (sql.includes('FROM addons')) return [{ id: 1 }];
      if (sql.includes('FROM products ORDER BY')) return [{ productTypeId: 1, createdBy: 1 }];
      if (sql.includes('FROM products WHERE')) return [{ id: 1 }];
      return [];
    });
    const context = {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      bulkInsert: jest.fn().mockResolvedValue(undefined),
      bulkDelete: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryInterface;

    await up({ context });

    const metadataQuery = query.mock.calls
      .map(([sql]) => sql as string)
      .find((sql) => sql.includes('FROM products ORDER BY'));
    expect(metadataQuery).toBe(
      'SELECT "productTypeId", "createdBy" FROM products ORDER BY id ASC LIMIT 1',
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
