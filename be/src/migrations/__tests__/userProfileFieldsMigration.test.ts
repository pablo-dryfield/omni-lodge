import type { QueryInterface } from 'sequelize';
import { down, up, verify } from '../202511250001-user-profile-fields';

const PROFILE_COLUMNS = [
  'phone',
  'country_of_citizenship',
  'date_of_birth',
  'preferred_pronouns',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
  'emergency_contact_email',
  'arrival_date',
  'departure_date',
  'dietary_restrictions',
  'allergies',
  'medical_notes',
  'whatsapp_handle',
  'facebook_profile_url',
  'instagram_profile_url',
  'discovery_source',
  'profile_photo_path',
  'profile_photo_url',
];

const createContext = (initialColumns: string[] = []) => {
  const columns = new Set(initialColumns);
  const transaction = { id: 'profile-fields-transaction' };
  const describeTable = jest.fn(async () => Object.fromEntries([...columns].map((name) => [name, {}])));
  const addColumn = jest.fn(async (_table: string, name: string) => {
    columns.add(name);
  });
  const context = {
    sequelize: {
      transaction: jest.fn(async (callback: (value: unknown) => Promise<void>) => callback(transaction)),
    },
    describeTable,
    addColumn,
  } as unknown as QueryInterface;

  return { context, transaction, describeTable, addColumn, columns };
};

describe('202511250001 user profile fields migration', () => {
  it('adds every missing historical profile column in one transaction', async () => {
    const setup = createContext(['id']);

    await up({ context: setup.context });

    expect(setup.addColumn.mock.calls.map(([, name]) => name)).toEqual(PROFILE_COLUMNS);
    for (const [, , options, queryOptions] of setup.addColumn.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ type: expect.anything(), allowNull: true }));
      expect(queryOptions).toEqual({ transaction: setup.transaction });
    }
  });

  it('preserves existing columns and adds only the missing subset', async () => {
    const setup = createContext(['id', 'phone', 'arrival_date', 'profile_photo_url']);

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledTimes(PROFILE_COLUMNS.length - 3);
    expect(setup.addColumn.mock.calls.map(([, name]) => name)).not.toEqual(expect.arrayContaining([
      'phone',
      'arrival_date',
      'profile_photo_url',
    ]));
  });

  it('is a no-op when production already contains the complete schema', async () => {
    const setup = createContext(['id', ...PROFILE_COLUMNS]);

    await up({ context: setup.context });

    expect(setup.addColumn).not.toHaveBeenCalled();
  });

  it('reports any incomplete schema and verifies the complete schema', async () => {
    const incomplete = createContext(PROFILE_COLUMNS.slice(0, -1));
    await expect(verify({ context: incomplete.context })).resolves.toEqual({
      ok: false,
      details: { missingColumns: ['profile_photo_url'] },
    });

    const complete = createContext(PROFILE_COLUMNS);
    await expect(verify({ context: complete.context })).resolves.toEqual({
      ok: true,
      details: { missingColumns: [] },
    });
  });

  it('has an intentionally non-destructive rollback', async () => {
    const setup = createContext(PROFILE_COLUMNS);

    await down();

    expect(setup.columns).toEqual(new Set(PROFILE_COLUMNS));
    expect(setup.addColumn).not.toHaveBeenCalled();
  });
});
