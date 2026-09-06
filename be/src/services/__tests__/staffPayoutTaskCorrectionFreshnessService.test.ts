jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import { QueryTypes, type Transaction } from 'sequelize';
import sequelize from '../../config/database';
import {
  assertStaffPayoutTaskCorrectionVersionUnchanged,
  loadStaffPayoutTaskCorrectionVersions,
} from '../staffPayoutTaskCorrectionFreshnessService';

const query = sequelize.query as jest.Mock;
const transaction = {} as Transaction;

describe('staff payout task correction freshness', () => {
  beforeEach(() => query.mockReset());

  it('captures correction versions by responsible staff member rather than the manager actor', async () => {
    query.mockResolvedValue([{ userId: '51', version: '2' }, { userId: '7', version: '1' }]);

    expect(await loadStaffPayoutTaskCorrectionVersions()).toEqual(new Map([[51, '2'], [7, '1']]));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("meta_json->>'userId'"),
      {
        replacements: { action: 'social_media.publish_date_changed' },
        type: QueryTypes.SELECT,
      },
    );
  });

  it('permits unchanged staff corrections and checks inside the caller transaction', async () => {
    query.mockResolvedValue([{ version: '2' }]);

    await expect(assertStaffPayoutTaskCorrectionVersionUnchanged(
      51, new Map([[51, '2']]), transaction,
    )).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      replacements: { action: 'social_media.publish_date_changed', userId: '51' },
      type: QueryTypes.SELECT,
      transaction,
    });
  });

  it('allows a staff member with no corrections even if another person has corrections', async () => {
    query.mockResolvedValue([{ version: '0' }]);
    await expect(assertStaffPayoutTaskCorrectionVersionUnchanged(
      51, new Map([[7, '5']]), transaction,
    )).resolves.toBeUndefined();
  });

  it('rejects the first correction committed after the report read its task data', async () => {
    query.mockResolvedValue([{ version: '1' }]);
    await expect(assertStaffPayoutTaskCorrectionVersionUnchanged(
      51, new Map(), transaction,
    )).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Refresh Pays') });
  });

  it('rejects another committed correction regardless of its audit timestamp or sequence ID', async () => {
    // A correction audit can be inserted before report startup, then commit
    // after the task read. Its newly visible count still changes the version.
    query.mockResolvedValueOnce([{ userId: '51', version: '2' }]);
    const versions = await loadStaffPayoutTaskCorrectionVersions();
    query.mockResolvedValueOnce([{ version: '3' }]);

    await expect(assertStaffPayoutTaskCorrectionVersionUnchanged(
      51, versions, transaction,
    )).rejects.toMatchObject({ status: 409 });
  });

  it('fails closed if the version query cannot return a count', async () => {
    query.mockResolvedValue([]);
    await expect(assertStaffPayoutTaskCorrectionVersionUnchanged(
      51, new Map(), transaction,
    )).rejects.toMatchObject({ status: 409 });
  });
});
