import type { QueryInterface, Transaction } from 'sequelize';
import { QueryTypes } from 'sequelize';
import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

type MigrationParams = { context: QueryInterface };

type SeedUser = {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roleKey: 'owner' | 'admin' | 'assistant_manager' | 'guide';
  staffProfile?: {
    staffType: 'volunteer' | 'long_term';
    livesInAccom: boolean;
  };
};

const DEMO_SEED_FLAG = 'SEED_SCHEDULING_DEMO';
const DEMO_SEED_PASSWORD_ENV = 'SCHEDULING_DEMO_SEED_PASSWORD';
const MINIMUM_DEMO_PASSWORD_LENGTH = 16;
const DEMO_SEED_MARKER = 'scheduling-demo';
const tz = process.env.SCHED_TZ || 'Europe/Warsaw';

type DemoSeedConfig =
  | { enabled: false }
  | { enabled: true; password: string };

const readDemoSeedConfig = (env: NodeJS.ProcessEnv = process.env): DemoSeedConfig => {
  // This historical migration lives in the production migration chain, so
  // demo data must be opt-in and impossible to enable in a runtime environment.
  const requestedValue = String(env[DEMO_SEED_FLAG] ?? '').trim().toLowerCase();

  if (!requestedValue || ['0', 'false', 'no', 'off'].includes(requestedValue)) {
    return { enabled: false };
  }

  if (requestedValue !== 'true') {
    throw new Error(`${DEMO_SEED_FLAG} must be exactly "true" to enable the scheduling demo seed`);
  }

  const nodeEnvironment = String(env.NODE_ENV ?? '').trim().toLowerCase();
  if (!['development', 'test'].includes(nodeEnvironment)) {
    throw new Error('The scheduling demo seed is allowed only when NODE_ENV=development or test');
  }

  const password = String(env[DEMO_SEED_PASSWORD_ENV] ?? '');
  if (password.length < MINIMUM_DEMO_PASSWORD_LENGTH) {
    throw new Error(
      `${DEMO_SEED_PASSWORD_ENV} must contain at least ${MINIMUM_DEMO_PASSWORD_LENGTH} characters`,
    );
  }

  return { enabled: true, password };
};

const seedUsers: SeedUser[] = [
  {
    email: 'owner.demo@omni-lodge.test',
    username: 'owner.demo',
    firstName: 'Olivia',
    lastName: 'Owner',
    roleKey: 'owner',
  },
  {
    email: 'gm.demo@omni-lodge.test',
    username: 'gm.demo',
    firstName: 'Gavin',
    lastName: 'Manager',
    roleKey: 'admin',
  },
  {
    email: 'assistant.demo@omni-lodge.test',
    username: 'assistant.demo',
    firstName: 'Avery',
    lastName: 'Assistant',
    roleKey: 'assistant_manager',
    staffProfile: {
      staffType: 'long_term',
      livesInAccom: true,
    },
  },
  {
    email: 'guide.longterm@omni-lodge.test',
    username: 'guide.longterm',
    firstName: 'Liam',
    lastName: 'Guide',
    roleKey: 'guide',
    staffProfile: {
      staffType: 'long_term',
      livesInAccom: false,
    },
  },
  {
    email: 'guide.volunteer@omni-lodge.test',
    username: 'guide.volunteer',
    firstName: 'Vera',
    lastName: 'Volunteer',
    roleKey: 'guide',
    staffProfile: {
      staffType: 'volunteer',
      livesInAccom: true,
    },
  },
];

async function upsertUsers(
  qi: QueryInterface,
  transaction: Transaction,
  password: string,
): Promise<number[]> {
  const hashed = await bcrypt.hash(password, 10);
  const insertedIds: number[] = [];

  for (const user of seedUsers) {
    const [existing] = await qi.sequelize.query<{ id: number }>(
      `SELECT id FROM users WHERE email = :email LIMIT 1`,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: { email: user.email },
      },
    );

    let userId = existing?.id;
    let insertedBySeed = false;

    if (!userId) {
      const insertedRows = await qi.sequelize.query<{ id: number }>(
        `INSERT INTO users (username, "firstName", "lastName", email, password, role, status, "createdAt", "updatedAt")
         VALUES (:username, :firstName, :lastName, :email, :password, :role, true, NOW(), NOW())
         RETURNING id`,
        {
          transaction,
          type: QueryTypes.SELECT,
          replacements: {
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            password: hashed,
            role: user.roleKey,
          },
        },
      );

      const insertedRow = insertedRows[0];
      userId = insertedRow?.id;
      insertedBySeed = Boolean(userId);
    }

    if (!userId) {
      throw new Error(`Failed to insert seed user ${user.email}`);
    }

    insertedIds.push(userId);

    // Never modify a profile belonging to a user that pre-dated this seed.
    if (user.staffProfile && insertedBySeed) {
      await qi.sequelize.query(
        `INSERT INTO staff_profiles (user_id, staff_type, lives_in_accom, active, created_at, updated_at)
         VALUES (:userId, :staffType, :lives, true, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        {
          transaction,
          replacements: {
            userId,
            staffType: user.staffProfile.staffType,
            lives: user.staffProfile.livesInAccom,
          },
        },
      );
    }
  }

  return insertedIds;
}

async function getOrCreateScheduleWeek(qi: QueryInterface, transaction: Transaction): Promise<{ id: number; year: number; week: number; weekStart: dayjs.Dayjs }> {
  const base = dayjs().tz(tz).add(1, 'week');
  const year = base.isoWeekYear();
  const week = base.isoWeek();
  const weekStart = base.startOf('isoWeek');

  const [existing] = await qi.sequelize.query<{ id: number }>(
    `SELECT id FROM schedule_weeks WHERE year = :year AND iso_week = :week LIMIT 1`,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { year, week },
    },
  );

  if (existing?.id) {
    return { id: existing.id, year, week, weekStart };
  }

  const inserted = await qi.sequelize.query<{ id: number }>(
    `INSERT INTO schedule_weeks (year, iso_week, tz, state, created_at, updated_at)
     VALUES (:year, :week, :tz, 'collecting', NOW(), NOW())
     RETURNING id`,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { year, week, tz },
    },
  );

  const insertedRow = inserted[0];
  const weekId = insertedRow?.id;

  if (!weekId) {
    throw new Error('Failed to create demo schedule_week');
  }

  return { id: weekId, year, week, weekStart };
}

async function resolveTemplate(qi: QueryInterface, name: string, transaction: Transaction): Promise<{ templateId: number; shiftTypeId: number }> {
  const rows = await qi.sequelize.query<{ id: number; shift_type_id: number }>(
    `SELECT id, shift_type_id FROM shift_templates WHERE name = :name LIMIT 1`,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { name },
    },
  );

  const [row] = rows;

  if (!row?.id || !row.shift_type_id) {
    throw new Error(`Missing shift template seed "${name}"`);
  }

  return { templateId: row.id, shiftTypeId: row.shift_type_id };
}

export async function up({ context }: MigrationParams): Promise<void> {
  const demoSeed = readDemoSeedConfig();
  if (!demoSeed.enabled) {
    return;
  }

  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    const userIds = await upsertUsers(qi, transaction, demoSeed.password);
    const { id: weekId, weekStart } = await getOrCreateScheduleWeek(qi, transaction);

    const assistantId = userIds[2];
    const guideLongTermId = userIds[3];
    const guideVolunteerId = userIds[4];

    const pubCrawlTemplate = await resolveTemplate(qi, 'Pub Crawl - Standard', transaction);
    const cleaningTemplate = await resolveTemplate(qi, 'Cleaning - Kitchen', transaction);
    const promotionTemplate = await resolveTemplate(qi, 'Promotion - Slot 1', transaction);

    const monday = weekStart.format('YYYY-MM-DD');
    const tuesday = weekStart.add(1, 'day').format('YYYY-MM-DD');
    const wednesday = weekStart.add(2, 'day').format('YYYY-MM-DD');

    const pubCrawlRows = await qi.sequelize.query<{ id: number }>(
      `INSERT INTO shift_instances
        (schedule_week_id, shift_type_id, shift_template_id, date, time_start, time_end, capacity, required_roles, meta, created_at, updated_at)
       VALUES
        (:weekId, :shiftTypeId, :templateId, :date, '20:45:00', '00:30:00', NULL, :roles::jsonb, :meta::jsonb, NOW(), NOW())
       RETURNING id`,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: {
          weekId,
          shiftTypeId: pubCrawlTemplate.shiftTypeId,
          templateId: pubCrawlTemplate.templateId,
          date: monday,
          roles: JSON.stringify([
            { role: 'Leader', required: 1 },
            { role: 'Guide', required: 2 },
          ]),
          meta: JSON.stringify({ seed: DEMO_SEED_MARKER }),
        },
      },
    );

    const cleaningRows = await qi.sequelize.query<{ id: number }>(
      `INSERT INTO shift_instances
        (schedule_week_id, shift_type_id, shift_template_id, date, time_start, time_end, capacity, required_roles, meta, created_at, updated_at)
       VALUES
        (:weekId, :shiftTypeId, :templateId, :date, '17:00:00', '18:00:00', NULL, :roles::jsonb, :meta::jsonb, NOW(), NOW())
       RETURNING id`,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: {
          weekId,
          shiftTypeId: cleaningTemplate.shiftTypeId,
          templateId: cleaningTemplate.templateId,
          date: tuesday,
          roles: JSON.stringify([{ role: 'Staff', required: 1 }]),
          meta: JSON.stringify({ area: 'Kitchen', seed: DEMO_SEED_MARKER }),
        },
      },
    );

    const promotionRows = await qi.sequelize.query<{ id: number }>(
      `INSERT INTO shift_instances
        (schedule_week_id, shift_type_id, shift_template_id, date, time_start, time_end, capacity, required_roles, meta, created_at, updated_at)
       VALUES
        (:weekId, :shiftTypeId, :templateId, :date, '14:00:00', '15:00:00', NULL, :roles::jsonb, :meta::jsonb, NOW(), NOW())
       RETURNING id`,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: {
          weekId,
          shiftTypeId: promotionTemplate.shiftTypeId,
          templateId: promotionTemplate.templateId,
          date: wednesday,
          roles: JSON.stringify([{ role: 'Staff', required: 1 }]),
          meta: JSON.stringify({ seed: DEMO_SEED_MARKER }),
        },
      },
    );

    const pubCrawlId = pubCrawlRows[0]?.id;
    const cleaningId = cleaningRows[0]?.id;
    const promotionId = promotionRows[0]?.id;

    if (pubCrawlId) {
      await qi.sequelize.query(
        `INSERT INTO shift_assignments (shift_instance_id, user_id, role_in_shift, created_at, updated_at)
         VALUES (:instanceId, :leaderId, 'Leader', NOW(), NOW()),
                (:instanceId, :guideOne, 'Guide', NOW(), NOW()),
                (:instanceId, :guideTwo, 'Guide', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        {
          transaction,
          replacements: {
            instanceId: pubCrawlId,
            leaderId: assistantId,
            guideOne: guideLongTermId,
            guideTwo: guideVolunteerId,
          },
        },
      );
    }

    if (cleaningId) {
      await qi.sequelize.query(
        `INSERT INTO shift_assignments (shift_instance_id, user_id, role_in_shift, created_at, updated_at)
         VALUES (:instanceId, :userId, 'Staff', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        {
          transaction,
          replacements: {
            instanceId: cleaningId,
            userId: guideVolunteerId,
          },
        },
      );
    }

    if (promotionId) {
      await qi.sequelize.query(
        `INSERT INTO shift_assignments (shift_instance_id, user_id, role_in_shift, created_at, updated_at)
         VALUES (:instanceId, :userId, 'Staff', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        {
          transaction,
          replacements: {
            instanceId: promotionId,
            userId: guideLongTermId,
          },
        },
      );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const demoSeed = readDemoSeedConfig();
  if (!demoSeed.enabled) {
    return;
  }

  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.sequelize.query(
      `DELETE FROM shift_assignments
       WHERE shift_instance_id IN (
         SELECT id
         FROM shift_instances
         WHERE meta ->> 'seed' = :demoSeedMarker
       )`,
      {
        transaction,
        replacements: { demoSeedMarker: DEMO_SEED_MARKER },
      },
    );

    await qi.sequelize.query(
      `DELETE FROM shift_instances
       WHERE meta ->> 'seed' = :demoSeedMarker`,
      {
        transaction,
        replacements: { demoSeedMarker: DEMO_SEED_MARKER },
      },
    );

    // The legacy schema has no durable marker proving which user/profile rows
    // were created here. Retaining them is safer than deleting a pre-existing
    // account that happens to use one of the demo identities.

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
