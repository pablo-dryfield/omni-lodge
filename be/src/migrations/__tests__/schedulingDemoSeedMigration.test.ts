import { up, down } from '../202510280011-scheduling-demo-seed.js';

const DEMO_SEED_FLAG = 'SEED_SCHEDULING_DEMO';
const DEMO_SEED_PASSWORD_ENV = 'SCHEDULING_DEMO_SEED_PASSWORD';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn();
  const transactionFactory = jest.fn().mockResolvedValue(transaction);

  return {
    context: {
      sequelize: {
        transaction: transactionFactory,
        query,
      },
    } as never,
    query,
    transaction,
    transactionFactory,
  };
};

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  seedEnabled: process.env[DEMO_SEED_FLAG],
  seedPassword: process.env[DEMO_SEED_PASSWORD_ENV],
};

const restoreEnvironmentValue = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

describe('scheduling demo seed migration', () => {
  afterEach(() => {
    restoreEnvironmentValue('NODE_ENV', originalEnvironment.nodeEnv);
    restoreEnvironmentValue(DEMO_SEED_FLAG, originalEnvironment.seedEnabled);
    restoreEnvironmentValue(DEMO_SEED_PASSWORD_ENV, originalEnvironment.seedPassword);
    jest.restoreAllMocks();
  });

  it('does not access the database unless the demo seed is explicitly enabled', async () => {
    delete process.env[DEMO_SEED_FLAG];
    delete process.env[DEMO_SEED_PASSWORD_ENV];
    const setup = createContext();

    await expect(up({ context: setup.context })).resolves.toBeUndefined();
    await expect(down({ context: setup.context })).resolves.toBeUndefined();

    expect(setup.transactionFactory).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('refuses to run in production even when the opt-in flag and password are present', async () => {
    process.env.NODE_ENV = 'production';
    process.env[DEMO_SEED_FLAG] = 'true';
    process.env[DEMO_SEED_PASSWORD_ENV] = 'a-development-only-password';
    const setup = createContext();

    await expect(up({ context: setup.context })).rejects.toThrow(
      'The scheduling demo seed is allowed only when NODE_ENV=development or test',
    );
    await expect(down({ context: setup.context })).rejects.toThrow(
      'The scheduling demo seed is allowed only when NODE_ENV=development or test',
    );

    expect(setup.transactionFactory).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('refuses ambiguous opt-in values instead of accidentally enabling the seed', async () => {
    process.env.NODE_ENV = 'development';
    process.env[DEMO_SEED_FLAG] = 'yes-please';
    process.env[DEMO_SEED_PASSWORD_ENV] = 'a-development-only-password';
    const setup = createContext();

    await expect(up({ context: setup.context })).rejects.toThrow(
      'SEED_SCHEDULING_DEMO must be exactly "true"',
    );

    expect(setup.transactionFactory).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('requires a separately supplied strong password for an opted-in development seed', async () => {
    process.env.NODE_ENV = 'development';
    process.env[DEMO_SEED_FLAG] = 'true';
    process.env[DEMO_SEED_PASSWORD_ENV] = 'too-short';
    const setup = createContext();

    await expect(up({ context: setup.context })).rejects.toThrow(
      'SCHEDULING_DEMO_SEED_PASSWORD must contain at least 16 characters',
    );

    expect(setup.transactionFactory).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('runs the seed only after a valid development opt-in and hashes the supplied password', async () => {
    process.env.NODE_ENV = 'development';
    process.env[DEMO_SEED_FLAG] = 'true';
    process.env[DEMO_SEED_PASSWORD_ENV] = 'local-demo-password-2026';
    const setup = createContext();
    let nextUserId = 1;
    let nextShiftId = 201;

    setup.query.mockImplementation(async (statement: unknown) => {
      const sql = String(statement);
      if (sql.includes('SELECT id FROM users')) return [];
      if (sql.includes('INSERT INTO users')) return [{ id: nextUserId++ }];
      if (sql.includes('SELECT id FROM schedule_weeks')) return [];
      if (sql.includes('INSERT INTO schedule_weeks')) return [{ id: 101 }];
      if (sql.includes('SELECT id, shift_type_id FROM shift_templates')) {
        return [{ id: 11, shift_type_id: 12 }];
      }
      if (sql.includes('INSERT INTO shift_instances')) return [{ id: nextShiftId++ }];
      return undefined;
    });

    await expect(up({ context: setup.context })).resolves.toBeUndefined();

    const userInsert = setup.query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO users'),
    );
    const storedPassword = (userInsert?.[1] as {
      replacements?: { password?: string };
    })?.replacements?.password;

    expect(setup.transactionFactory).toHaveBeenCalledTimes(1);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
    expect(String(userInsert?.[0])).toContain(
      'username, "firstName", "lastName", email, password, role, status, "createdAt", "updatedAt"',
    );
    expect(String(userInsert?.[0])).not.toContain('created_at');
    expect(storedPassword).toEqual(expect.any(String));
    expect(storedPassword).not.toBe(process.env[DEMO_SEED_PASSWORD_ENV]);
    expect(storedPassword).toMatch(/^\$2[aby]\$/);
    expect(setup.query.mock.calls.filter(([statement]) =>
      String(statement).includes('INSERT INTO shift_instances'),
    ).every(([, options]) =>
      JSON.parse(String((options as { replacements?: { meta?: string } }).replacements?.meta)).seed
        === 'scheduling-demo',
    )).toBe(true);
  });

  it('does not alter profiles belonging to users that pre-date the seed', async () => {
    process.env.NODE_ENV = 'development';
    process.env[DEMO_SEED_FLAG] = 'true';
    process.env[DEMO_SEED_PASSWORD_ENV] = 'local-demo-password-2026';
    const setup = createContext();
    let existingUserId = 1;
    let nextShiftId = 201;

    setup.query.mockImplementation(async (statement: unknown) => {
      const sql = String(statement);
      if (sql.includes('SELECT id FROM users')) return [{ id: existingUserId++ }];
      if (sql.includes('SELECT id FROM schedule_weeks')) return [];
      if (sql.includes('INSERT INTO schedule_weeks')) return [{ id: 101 }];
      if (sql.includes('SELECT id, shift_type_id FROM shift_templates')) {
        return [{ id: 11, shift_type_id: 12 }];
      }
      if (sql.includes('INSERT INTO shift_instances')) return [{ id: nextShiftId++ }];
      return undefined;
    });

    await expect(up({ context: setup.context })).resolves.toBeUndefined();

    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).not.toContain('INSERT INTO users');
    expect(sql).not.toContain('INSERT INTO staff_profiles');
    expect(sql).not.toContain('UPDATE staff_profiles');
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('limits an opted-in development rollback to marker-owned demo shifts', async () => {
    process.env.NODE_ENV = 'development';
    process.env[DEMO_SEED_FLAG] = 'true';
    process.env[DEMO_SEED_PASSWORD_ENV] = 'local-demo-password-2026';
    const setup = createContext();
    setup.query.mockResolvedValue([]);

    await expect(down({ context: setup.context })).resolves.toBeUndefined();

    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain("meta ->> 'seed' = :demoSeedMarker");
    expect(sql).not.toContain('DELETE FROM users');
    expect(sql).not.toContain('DELETE FROM staff_profiles');
    expect(sql).not.toContain('WHERE user_id = ANY');
    expect(sql).not.toContain("NOW() + INTERVAL '1 week'");
    expect(sql).not.toContain('DELETE FROM schedule_weeks');
    expect(setup.query.mock.calls.filter(([statement]) =>
      String(statement).includes("meta ->> 'seed' = :demoSeedMarker"),
    ).every(([, options]) =>
      (options as { replacements?: { demoSeedMarker?: string } }).replacements?.demoSeedMarker
        === 'scheduling-demo',
    )).toBe(true);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });
});
