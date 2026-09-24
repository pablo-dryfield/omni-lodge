import { up } from '../202609240001-civitatis-cancellation-parser.js';

const originalConfig = [{
  id: 'civitatis-v1', platform: 'civitatis',
  match: { all: [{ source: 'subject', pattern: '^New\\s+booking\\s+[A-Z0-9]+\\s*:' }, { source: 'textBody', pattern: 'Civitatis' }] },
  extract: { platformOrderId: { source: 'subject', pattern: 'New\\s+booking\\s+([A-Z0-9]+)\\s*:' } },
  status: { cancelled: [{ source: 'subject', pattern: 'cancelled|canceled|cancelaci[oó]n' }] },
}];

describe('Civitatis cancellation parser migration', () => {
  it('accepts lifecycle subjects and queues previously ignored Civitatis lifecycle emails', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([[{ value: JSON.stringify(originalConfig) }]])
      .mockResolvedValueOnce([[], 1])
      .mockResolvedValueOnce([[], 2]);
    const transaction = jest.fn(async (callback) => callback({ id: 'tx' }));
    const context = { sequelize: { query, transaction } } as any;

    await up({ context });

    const saved = JSON.parse(query.mock.calls[1][1].replacements.value);
    expect(saved[0].match.all[0].pattern).toContain('Cancellation');
    expect(saved[0].extract.platformOrderId.pattern).toContain('modified');
    expect(saved[0].status.cancelled[0].pattern).toContain('lation');
    expect(query.mock.calls[2][0]).toContain("ingestion_status = 'pending'");
    expect(query.mock.calls[2][0]).toContain("from_address ILIKE '%@civitatis.com%'");
    expect(query.mock.calls[1][1].transaction).toEqual({ id: 'tx' });
  });

  it('leaves malformed configuration untouched', async () => {
    const query = jest.fn().mockResolvedValueOnce([[{ value: '{bad json' }]]);
    const transaction = jest.fn();

    await up({ context: { sequelize: { query, transaction } } as any });

    expect(query).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });
});
