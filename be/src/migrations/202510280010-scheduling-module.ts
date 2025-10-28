import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const USER_ROLE_ENUM = 'enum_users_role';
const STAFF_TYPE_ENUM = 'enum_staff_profiles_staff_type';
const WEEK_STATE_ENUM = 'enum_schedule_weeks_state';
const AVAILABILITY_STATUS_ENUM = 'enum_availabilities_status';
const SWAP_STATUS_ENUM = 'enum_swap_requests_status';
const NOTIFICATION_CHANNEL_ENUM = 'enum_notifications_channel';

const DEFAULT_TZ = 'Europe/Warsaw';

type TemplateSeed = {
  shiftTypeKey: string;
  name: string;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  defaultCapacity: number | null;
  requiresLeader: boolean;
  defaultRoles: Array<{ role: string; required: number | null }>;
  defaultMeta?: Record<string, unknown>;
};

const shiftTypeSeeds: Array<{ key: string; name: string; description: string | null }> = [
  { key: 'PUB_CRAWL', name: 'Pub Crawl', description: 'Nightly pub crawl experience with designated leader and guides.' },
  { key: 'PRIVATE_PUB_CRAWL', name: 'Private Pub Crawl', description: 'Private crawl for groups with dedicated staff.' },
  { key: 'BOTTOMLESS_BRUNCH', name: 'Bottomless Brunch', description: 'Brunch shift covering guests and logistics.' },
  { key: 'GO_KARTING', name: 'Go Karting', description: 'Go-karting coordination shift.' },
  { key: 'PROMOTION', name: 'Promotion', description: 'Street promotion shift.' },
  { key: 'SOCIAL_MEDIA', name: 'Social Media', description: 'Evening social media coverage.' },
  { key: 'CLEANING', name: 'Cleaning', description: 'Cleaning shift for designated area.' },
  { key: 'ORG_MANAGER', name: 'Organization Duty Manager', description: 'Manager on duty overseeing operations.' },
];

const templateSeeds: TemplateSeed[] = [
  {
    shiftTypeKey: 'PUB_CRAWL',
    name: 'Pub Crawl - Standard',
    defaultStartTime: '20:45:00',
    defaultEndTime: '00:30:00',
    defaultCapacity: null,
    requiresLeader: true,
    defaultRoles: [
      { role: 'Leader', required: 1 },
      { role: 'Guide', required: null },
    ],
  },
  {
    shiftTypeKey: 'PRIVATE_PUB_CRAWL',
    name: 'Private Pub Crawl',
    defaultStartTime: null,
    defaultEndTime: null,
    defaultCapacity: null,
    requiresLeader: true,
    defaultRoles: [
      { role: 'Leader', required: 1 },
      { role: 'Guide', required: null },
    ],
  },
  {
    shiftTypeKey: 'BOTTOMLESS_BRUNCH',
    name: 'Bottomless Brunch',
    defaultStartTime: '12:00:00',
    defaultEndTime: '14:00:00',
    defaultCapacity: null,
    requiresLeader: false,
    defaultRoles: [
      { role: 'Manager', required: 1 },
      { role: 'Staff', required: 2 },
    ],
  },
  {
    shiftTypeKey: 'GO_KARTING',
    name: 'Go Karting',
    defaultStartTime: '16:00:00',
    defaultEndTime: '18:00:00',
    defaultCapacity: null,
    requiresLeader: false,
    defaultRoles: [
      { role: 'Coordinator', required: 1 },
    ],
  },
  ...['14:00:00', '16:00:00', '18:00:00'].map((time, index) => ({
    shiftTypeKey: 'PROMOTION',
    name: `Promotion - Slot ${index + 1}`,
    defaultStartTime: time,
    defaultEndTime: time,
    defaultCapacity: null,
    requiresLeader: false,
    defaultRoles: [
      { role: 'Staff', required: 1 },
    ],
  })),
  {
    shiftTypeKey: 'SOCIAL_MEDIA',
    name: 'Social Media',
    defaultStartTime: '20:45:00',
    defaultEndTime: '22:00:00',
    defaultCapacity: null,
    requiresLeader: false,
    defaultRoles: [
      { role: 'Staff', required: 1 },
    ],
  },
  ...['Kitchen', 'Entrance', 'Outside', 'Bathroom', 'Bedrooms'].map((area) => ({
    shiftTypeKey: 'CLEANING',
    name: `Cleaning - ${area}`,
    defaultStartTime: '17:00:00',
    defaultEndTime: '18:00:00',
    defaultCapacity: null,
    requiresLeader: false,
    defaultRoles: [
      { role: 'Staff', required: 1 },
    ],
    defaultMeta: { area },
  })),
  {
    shiftTypeKey: 'ORG_MANAGER',
    name: 'Manager on Duty',
    defaultStartTime: '16:00:00',
    defaultEndTime: '01:00:00',
    defaultCapacity: null,
    requiresLeader: false,
    defaultRoles: [
      { role: 'Manager', required: 1 },
    ],
  },
];

async function upsertShiftTemplates(qi: QueryInterface, transaction: Transaction): Promise<void> {
  for (const template of templateSeeds) {
    const [shiftType] = await qi.sequelize.query<{ id: number }>(
      `SELECT id FROM shift_types WHERE key = :key LIMIT 1`,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements: { key: template.shiftTypeKey },
      }
    );

    if (!shiftType?.id) {
      throw new Error(`Missing shift_type with key=${template.shiftTypeKey} while seeding shift_templates`);
    }

    await qi.sequelize.query(
      `INSERT INTO shift_templates
        (shift_type_id, name, default_start_time, default_end_time, default_capacity, requires_leader, default_roles, default_meta, created_at, updated_at)
       VALUES
        (:shiftTypeId, :name, :defaultStart, :defaultEnd, :defaultCapacity, :requiresLeader, :defaultRoles::jsonb, :defaultMeta::jsonb, NOW(), NOW())
       ON CONFLICT (shift_type_id, name)
       DO UPDATE SET
         default_start_time = EXCLUDED.default_start_time,
         default_end_time = EXCLUDED.default_end_time,
         default_capacity = EXCLUDED.default_capacity,
         requires_leader = EXCLUDED.requires_leader,
         default_roles = EXCLUDED.default_roles,
         default_meta = EXCLUDED.default_meta,
         updated_at = NOW();`,
      {
        transaction,
        replacements: {
          shiftTypeId: shiftType.id,
          name: template.name,
          defaultStart: template.defaultStartTime,
          defaultEnd: template.defaultEndTime,
          defaultCapacity: template.defaultCapacity,
          requiresLeader: template.requiresLeader,
          defaultRoles: JSON.stringify(template.defaultRoles),
          defaultMeta: JSON.stringify(template.defaultMeta ?? {}),
        },
      }
    );
  }
}

async function upsertShiftTypes(qi: QueryInterface, transaction: Transaction): Promise<void> {
  for (const seed of shiftTypeSeeds) {
    await qi.sequelize.query(
      `INSERT INTO shift_types (key, name, description, created_at, updated_at)
       VALUES (:key, :name, :description, NOW(), NOW())
       ON CONFLICT (key)
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW();`,
      {
        transaction,
        replacements: seed,
      }
    );
  }
}

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    const usersTable = await qi.describeTable('users');

    if (!('role' in usersTable)) {
      await qi.addColumn('users', 'role', {
        type: DataTypes.ENUM('owner', 'admin', 'assistant_manager', 'guide'),
        allowNull: false,
        defaultValue: 'guide',
      }, { transaction });
    } else {
      await qi.sequelize.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${USER_ROLE_ENUM}') THEN
            CREATE TYPE "${USER_ROLE_ENUM}" AS ENUM ('owner', 'admin', 'assistant_manager', 'guide');
            ALTER TABLE users ALTER COLUMN role TYPE "${USER_ROLE_ENUM}" USING role::text::"${USER_ROLE_ENUM}";
          ELSE
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum e
              WHERE e.enumtypid = (SELECT oid FROM pg_type WHERE typname = '${USER_ROLE_ENUM}')
                AND e.enumlabel = 'assistant_manager'
            ) THEN
              ALTER TYPE "${USER_ROLE_ENUM}" ADD VALUE 'assistant_manager';
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum e
              WHERE e.enumtypid = (SELECT oid FROM pg_type WHERE typname = '${USER_ROLE_ENUM}')
                AND e.enumlabel = 'owner'
            ) THEN
              ALTER TYPE "${USER_ROLE_ENUM}" ADD VALUE 'owner';
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum e
              WHERE e.enumtypid = (SELECT oid FROM pg_type WHERE typname = '${USER_ROLE_ENUM}')
                AND e.enumlabel = 'admin'
            ) THEN
              ALTER TYPE "${USER_ROLE_ENUM}" ADD VALUE 'admin';
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum e
              WHERE e.enumtypid = (SELECT oid FROM pg_type WHERE typname = '${USER_ROLE_ENUM}')
                AND e.enumlabel = 'guide'
            ) THEN
              ALTER TYPE "${USER_ROLE_ENUM}" ADD VALUE 'guide';
            END IF;
          END IF;
        END$$;`,
        { transaction }
      );

      await qi.changeColumn('users', 'role', {
        type: DataTypes.ENUM('owner', 'admin', 'assistant_manager', 'guide'),
        allowNull: false,
        defaultValue: 'guide',
      }, { transaction });
    }

    await qi.addIndex('users', ['role'], {
      transaction,
      name: 'users_role_idx',
    }).catch(() => {});

    await qi.createTable('staff_profiles', {
      user_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      staff_type: {
        type: DataTypes.ENUM('volunteer', 'long_term'),
        allowNull: false,
      },
      lives_in_accom: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.createTable('shift_types', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.createTable('schedule_weeks', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      iso_week: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      tz: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: DEFAULT_TZ,
      },
      state: {
        type: DataTypes.ENUM('collecting', 'locked', 'assigned', 'published'),
        allowNull: false,
        defaultValue: 'collecting',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.addConstraint('schedule_weeks', {
      fields: ['year', 'iso_week'],
      type: 'unique',
      name: 'schedule_weeks_year_week_uq',
      transaction,
    });

    await qi.createTable('shift_templates', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      shift_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'shift_types',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      default_start_time: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      default_end_time: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      default_capacity: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      requires_leader: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      default_roles: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      default_meta: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.addIndex('shift_templates', ['shift_type_id'], {
      transaction,
      name: 'shift_templates_shift_type_idx',
    });

    await qi.addConstraint('shift_templates', {
      type: 'unique',
      name: 'shift_templates_shift_type_name_uq',
      fields: ['shift_type_id', 'name'],
      transaction,
    });

    await qi.createTable('shift_instances', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      schedule_week_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'schedule_weeks',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      shift_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'shift_types',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      shift_template_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'shift_templates',
          key: 'id',
        },
        onUpdate: 'SET NULL',
        onDelete: 'SET NULL',
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      time_start: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      time_end: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      capacity: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      required_roles: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      meta: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.addIndex('shift_instances', ['schedule_week_id'], {
      transaction,
      name: 'shift_instances_schedule_week_idx',
    });

    await qi.addIndex('shift_instances', ['date', 'time_start'], {
      transaction,
      name: 'shift_instances_datetime_idx',
    });

    await qi.createTable('availabilities', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      schedule_week_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'schedule_weeks',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      day: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      start_time: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      end_time: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      shift_type_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'shift_types',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: DataTypes.ENUM('available', 'unavailable'),
        allowNull: false,
        defaultValue: 'available',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.addIndex('availabilities', ['user_id', 'schedule_week_id'], {
      transaction,
      name: 'availabilities_user_week_idx',
    });

    await qi.createTable('shift_assignments', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      shift_instance_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'shift_instances',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role_in_shift: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.addConstraint('shift_assignments', {
      type: 'unique',
      name: 'shift_assignments_unique_member',
      fields: ['shift_instance_id', 'user_id'],
      transaction,
    });

    await qi.createTable('swap_requests', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      from_assignment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'shift_assignments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      to_assignment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'shift_assignments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      requester_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      partner_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: DataTypes.ENUM('pending_partner', 'pending_manager', 'approved', 'denied', 'canceled'),
        allowNull: false,
        defaultValue: 'pending_partner',
      },
      manager_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      decision_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, { transaction });

    await qi.addIndex('swap_requests', ['status'], {
      transaction,
      name: 'swap_requests_status_idx',
    });

    await qi.createTable('exports', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      schedule_week_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'schedule_weeks',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      drive_file_id: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      url: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });

    await qi.addIndex('exports', ['schedule_week_id'], {
      transaction,
      name: 'exports_schedule_week_idx',
    });

    await qi.createTable('notifications', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      channel: {
        type: DataTypes.ENUM('in_app', 'email'),
        allowNull: false,
      },
      template_key: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      payload_json: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      sent_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });

    await qi.addIndex('notifications', ['user_id'], {
      transaction,
      name: 'notifications_user_idx',
    });

    await qi.createTable('audit_logs', {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      actor_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      entity: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      meta_json: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });

    await qi.addIndex('audit_logs', ['entity', 'entity_id'], {
      transaction,
      name: 'audit_logs_entity_idx',
    });

    await qi.addIndex('audit_logs', ['created_at'], {
      transaction,
      name: 'audit_logs_created_idx',
    });

    await qi.sequelize.query(
      `CREATE UNIQUE INDEX availabilities_unique_span
       ON availabilities (
         user_id,
         schedule_week_id,
         day,
         COALESCE(shift_type_id, -1),
         COALESCE(start_time, TIME '00:00:00'),
         COALESCE(end_time, TIME '23:59:59')
       );`,
      { transaction }
    );

    await upsertShiftTypes(qi, transaction);
    await upsertShiftTemplates(qi, transaction);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.removeIndex('audit_logs', 'audit_logs_created_idx', { transaction }).catch(() => {});
    await qi.removeIndex('audit_logs', 'audit_logs_entity_idx', { transaction }).catch(() => {});
    await qi.dropTable('audit_logs', { transaction }).catch(() => {});

    await qi.removeIndex('notifications', 'notifications_user_idx', { transaction }).catch(() => {});
    await qi.dropTable('notifications', { transaction }).catch(() => {});

    await qi.removeIndex('exports', 'exports_schedule_week_idx', { transaction }).catch(() => {});
    await qi.dropTable('exports', { transaction }).catch(() => {});

    await qi.removeIndex('swap_requests', 'swap_requests_status_idx', { transaction }).catch(() => {});
    await qi.dropTable('swap_requests', { transaction }).catch(() => {});

    await qi.removeConstraint('shift_assignments', 'shift_assignments_unique_member', { transaction }).catch(() => {});
    await qi.dropTable('shift_assignments', { transaction }).catch(() => {});

    await qi.removeIndex('availabilities', 'availabilities_user_week_idx', { transaction }).catch(() => {});
    await qi.sequelize.query('DROP INDEX IF EXISTS availabilities_unique_span;', { transaction });
    await qi.dropTable('availabilities', { transaction }).catch(() => {});

    await qi.removeIndex('shift_instances', 'shift_instances_schedule_week_idx', { transaction }).catch(() => {});
    await qi.removeIndex('shift_instances', 'shift_instances_datetime_idx', { transaction }).catch(() => {});
    await qi.dropTable('shift_instances', { transaction }).catch(() => {});

    await qi.removeConstraint('shift_templates', 'shift_templates_shift_type_name_uq', { transaction }).catch(() => {});
    await qi.removeIndex('shift_templates', 'shift_templates_shift_type_idx', { transaction }).catch(() => {});
    await qi.dropTable('shift_templates', { transaction }).catch(() => {});

    await qi.removeConstraint('schedule_weeks', 'schedule_weeks_year_week_uq', { transaction }).catch(() => {});
    await qi.dropTable('schedule_weeks', { transaction }).catch(() => {});

    await qi.dropTable('shift_types', { transaction }).catch(() => {});

    await qi.dropTable('staff_profiles', { transaction }).catch(() => {});

    await qi.removeIndex('users', 'users_role_idx', { transaction }).catch(() => {});
    await qi.removeColumn('users', 'role', { transaction }).catch(() => {});

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  await qi.sequelize.query(`DROP TYPE IF EXISTS "${STAFF_TYPE_ENUM}";`).catch(() => {});
  await qi.sequelize.query(`DROP TYPE IF EXISTS "${WEEK_STATE_ENUM}";`).catch(() => {});
  await qi.sequelize.query(`DROP TYPE IF EXISTS "${AVAILABILITY_STATUS_ENUM}";`).catch(() => {});
  await qi.sequelize.query(`DROP TYPE IF EXISTS "${SWAP_STATUS_ENUM}";`).catch(() => {});
  await qi.sequelize.query(`DROP TYPE IF EXISTS "${NOTIFICATION_CHANNEL_ENUM}";`).catch(() => {});
  await qi.sequelize.query(`DROP TYPE IF EXISTS "${USER_ROLE_ENUM}";`).catch(() => {});
}
