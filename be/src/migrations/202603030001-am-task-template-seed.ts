import type { QueryInterface, Transaction } from 'sequelize';
import { QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_TEMPLATES = 'am_task_templates';
const TABLE_ASSIGNMENTS = 'am_task_assignments';

type TaskTemplateSeed = {
  name: string;
  description: string;
  cadence: 'daily' | 'weekly' | 'biweekly' | 'every_two_weeks' | 'monthly';
  scheduleConfig: Record<string, unknown>;
  assignToAssistantManager: boolean;
  assignToUserId?: number | null;
};

const SCHEDULED_TEMPLATE_SEEDS: TaskTemplateSeed[] = [
  {
    name: 'Daily - Social story',
    description: 'Post minimum 1 story on Instagram or Facebook.',
    cadence: 'daily',
    scheduleConfig: {
      time: '11:15',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['social', 'marketing', 'story'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Check booking numbers',
    description:
      'Check booking numbers in FareHarbor, Viator, GetYourGuide, Ecwid, and FreeTour.',
    cadence: 'daily',
    scheduleConfig: {
      time: '11:45',
      durationHours: 0.5,
      priority: 'high',
      points: 2,
      tags: ['bookings', 'operations'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Prepare WhatsApp group',
    description:
      'Check the WhatsApp group chat for the managed day and remove old participants so it is ready for the night.',
    cadence: 'daily',
    scheduleConfig: {
      time: '14:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['whatsapp', 'operations'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Photo workflow and Facebook album',
    description:
      'Import camera pictures into Lightroom, tune them, watermark them, upload to Google Drive by date, and post the album on Facebook. Meeting point and city rules flyer pictures are mandatory.',
    cadence: 'daily',
    scheduleConfig: {
      time: '09:00',
      durationHours: 2,
      priority: 'medium',
      points: 3,
      tags: ['photos', 'lightroom', 'google-drive', 'facebook'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Rejoin message to previous day group',
    description:
      'Send a message to the previous day WhatsApp group about joining the pub crawl again with the discounted code.',
    cadence: 'daily',
    scheduleConfig: {
      time: '12:30',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['whatsapp', 'retention'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Send picture link to previous day group',
    description:
      'Send a message to the previous day WhatsApp group with the Facebook pictures link.',
    cadence: 'daily',
    scheduleConfig: {
      time: '12:45',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['whatsapp', 'photos', 'facebook'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Charge camera and lights',
    description: 'Charge batteries for the camera, flash light, and LED light.',
    cadence: 'daily',
    scheduleConfig: {
      time: '17:15',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['equipment', 'camera'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Prepare wristbands',
    description:
      'Check the wristbands schedule, prepare needed normal and cocktail wristbands, and always bring 30 extra.',
    cadence: 'daily',
    scheduleConfig: {
      time: '17:30',
      durationHours: 0.5,
      priority: 'high',
      points: 2,
      tags: ['wristbands', 'operations'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Prepare booking add-ons',
    description:
      'Check booking add-ons and bring t-shirts or instant pictures when required.',
    cadence: 'daily',
    scheduleConfig: {
      time: '18:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['addons', 'operations'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Power Hour update 17:00',
    description:
      'Text Power Hour venue the real people count and whether cocktail options are needed by 17:00.',
    cadence: 'daily',
    scheduleConfig: {
      time: '17:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['venue', 'power-hour'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Power Hour update 20:00',
    description:
      'Send the 20:00 Power Hour venue update if numbers increased drastically.',
    cadence: 'daily',
    scheduleConfig: {
      time: '20:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['venue', 'power-hour'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Power Hour update 21:00',
    description:
      'Send the 21:00 Power Hour update and request pre-served drinks when there are 10 or more people.',
    cadence: 'daily',
    scheduleConfig: {
      time: '21:00',
      durationHours: 0.25,
      priority: 'high',
      points: 3,
      tags: ['venue', 'power-hour'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Arrive at 20:45 and check late staff',
    description:
      'Be on time at 20:45, check lateness, ask for reasons, issue a minor warning when needed, and escalate repeat issues to Pablo.',
    cadence: 'daily',
    scheduleConfig: {
      time: '20:45',
      durationHours: 0.25,
      priority: 'high',
      points: 3,
      tags: ['staff', 'attendance'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Supervise night and take photos',
    description:
      'Bring the camera, take pictures, and supervise the night to ensure operations run properly.',
    cadence: 'daily',
    scheduleConfig: {
      time: '21:45',
      durationHours: 1.5,
      priority: 'high',
      points: 4,
      tags: ['operations', 'camera', 'night'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Deliver city rules flyers',
    description:
      'Bring city rules flyers to the meeting point, deliver them to guests, and capture a picture when doing it.',
    cadence: 'daily',
    scheduleConfig: {
      time: '21:15',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['city-rules', 'guests'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Monitor KTK Promotion chat',
    description:
      'Check whether staff is on time for shift in KTK Promotion chat and keep monitoring their route during the shift.',
    cadence: 'daily',
    scheduleConfig: {
      time: '20:15',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['promotion', 'staff'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Review KTK House Cleaning photos',
    description:
      'Check cleaning pictures in KTK House Cleaning and make staff re-clean if the standard is not met.',
    cadence: 'daily',
    scheduleConfig: {
      time: '13:15',
      durationHours: 0.5,
      priority: 'medium',
      points: 2,
      tags: ['cleaning', 'staff'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Enforce city rules during the night',
    description: 'Make sure city rules are strictly applied during the night.',
    cadence: 'daily',
    scheduleConfig: {
      time: '23:15',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['city-rules', 'night'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Daily - Monitor staff and guest condition',
    description:
      'Check staff and guest behaviour and state, send unsafe people home when needed, and escalate to Pablo, city guard, or ambulance when necessary.',
    cadence: 'daily',
    scheduleConfig: {
      time: '23:45',
      durationHours: 0.5,
      priority: 'high',
      points: 4,
      tags: ['safety', 'staff', 'guests'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Weekly - IG and TikTok posts',
    description:
      'Post at least 2 posts or reels per week on Instagram and TikTok on the same day.',
    cadence: 'biweekly',
    scheduleConfig: {
      daysOfWeek: [1, 4],
      time: '15:00',
      durationHours: 0.75,
      timesPerWeekPerAssignedUser: 2,
      priority: 'medium',
      points: 2,
      tags: ['social', 'instagram', 'tiktok'],
      requireShift: false,
    },
    assignToAssistantManager: false,
    assignToUserId: 35,
  },
  {
    name: 'Weekly - Secretly review volunteer promotion',
    description:
      'Check once per week how volunteers are doing promotion without them knowing.',
    cadence: 'weekly',
    scheduleConfig: {
      daysOfWeek: [3],
      time: '15:00',
      durationHours: 0.5,
      priority: 'medium',
      points: 2,
      tags: ['volunteers', 'promotion'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Weekly - Content planning meeting',
    description:
      'Meet with managers and social media once per week to decide what content to film and prepare around 10 to 15 ideas. Prefer Monday or Tuesday.',
    cadence: 'weekly',
    scheduleConfig: {
      daysOfWeek: [1],
      time: '08:00',
      durationHours: 1,
      priority: 'medium',
      points: 2,
      tags: ['content', 'meeting'],
      requireShift: false,
    },
    assignToAssistantManager: true,
  },
  {
    name: 'Weekly - Buy staff supplies',
    description: 'Buy weekly staff supplies such as food and cleaning materials on Monday if managing.',
    cadence: 'weekly',
    scheduleConfig: {
      daysOfWeek: [1],
      time: '16:00',
      durationHours: 1,
      priority: 'medium',
      points: 2,
      tags: ['supplies', 'staff'],
      requireShift: true,
    },
    assignToAssistantManager: true,
  },
];

const MANUAL_TEMPLATE_SEEDS: TaskTemplateSeed[] = [
  {
    name: 'Shared Duty - Brunch host',
    description: 'Manual shared duty for brunch hosting. Host assignment rotates.',
    cadence: 'daily',
    scheduleConfig: {
      priority: 'medium',
      points: 2,
      tags: ['manual-only', 'brunch'],
      requireShift: false,
    },
    assignToAssistantManager: false,
  },
  {
    name: 'Shared Duty - New volunteer accommodation onboarding',
    description:
      'Manual shared duty for preparing accommodation, configuring door access, showing the space, assigning storage, and explaining house rules to a new volunteer.',
    cadence: 'daily',
    scheduleConfig: {
      priority: 'high',
      points: 4,
      tags: ['manual-only', 'volunteer', 'accommodation'],
      requireShift: true,
    },
    assignToAssistantManager: false,
  },
  {
    name: 'Shared Duty - Staff induction',
    description:
      'Manual shared duty for staff induction when a new volunteer arrives. Use the staff induction handbook.',
    cadence: 'daily',
    scheduleConfig: {
      priority: 'high',
      points: 3,
      tags: ['manual-only', 'staff', 'induction'],
      requireShift: true,
    },
    assignToAssistantManager: false,
  },
  {
    name: 'Shared Duty - Pablo ad hoc request',
    description:
      'Manual shared duty for ad hoc errands or purchases requested directly by Pablo.',
    cadence: 'daily',
    scheduleConfig: {
      priority: 'medium',
      points: 1,
      tags: ['manual-only', 'ad-hoc', 'pablo'],
      requireShift: true,
    },
    assignToAssistantManager: false,
  },
];

const ALL_TEMPLATE_SEEDS = [...SCHEDULED_TEMPLATE_SEEDS, ...MANUAL_TEMPLATE_SEEDS];

type TemplateRow = { id: number };

type AssignmentRow = { id: number };

const upsertTemplate = async (
  qi: QueryInterface,
  transaction: Transaction,
  seed: TaskTemplateSeed,
): Promise<number> => {
  const existing = await qi.sequelize.query<TemplateRow>(
    `
    SELECT id
    FROM ${TABLE_TEMPLATES}
    WHERE name = :name
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { name: seed.name },
    },
  );

  if (existing.length > 0) {
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET
        description = :description,
        cadence = :cadence,
        schedule_config = CAST(:scheduleConfig AS jsonb),
        is_active = true,
        updated_at = NOW()
      WHERE id = :id;
      `,
      {
        transaction,
        replacements: {
          id: existing[0].id,
          description: seed.description,
          cadence: seed.cadence,
          scheduleConfig: JSON.stringify(seed.scheduleConfig),
        },
      },
    );
    return existing[0].id;
  }

  const inserted = await qi.sequelize.query<TemplateRow>(
    `
    INSERT INTO ${TABLE_TEMPLATES}
      (name, description, cadence, schedule_config, is_active, created_at, updated_at)
    VALUES
      (:name, :description, :cadence, CAST(:scheduleConfig AS jsonb), true, NOW(), NOW())
    RETURNING id;
    `,
    {
      transaction,
      plain: true,
      type: QueryTypes.SELECT,
      replacements: {
        name: seed.name,
        description: seed.description,
        cadence: seed.cadence,
        scheduleConfig: JSON.stringify(seed.scheduleConfig),
      },
    },
  );

  if (!inserted?.id) {
    throw new Error(`Failed to insert assistant manager task template "${seed.name}"`);
  }

  return inserted.id;
};

const ensureAssistantManagerAssignment = async (
  qi: QueryInterface,
  transaction: Transaction,
  templateId: number,
): Promise<void> => {
  const existing = await qi.sequelize.query<AssignmentRow>(
    `
    SELECT id
    FROM ${TABLE_ASSIGNMENTS}
    WHERE template_id = :templateId
      AND target_scope = 'staff_type'
      AND staff_type = 'assistant_manager'
      AND user_id IS NULL
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { templateId },
    },
  );

  if (existing.length > 0) {
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_ASSIGNMENTS}
      SET
        effective_start = NULL,
        effective_end = NULL,
        is_active = true,
        updated_at = NOW()
      WHERE id = :id;
      `,
      {
        transaction,
        replacements: { id: existing[0].id },
      },
    );
    return;
  }

  await qi.sequelize.query(
    `
    INSERT INTO ${TABLE_ASSIGNMENTS}
      (template_id, target_scope, staff_type, user_id, effective_start, effective_end, is_active, created_at, updated_at)
    VALUES
      (:templateId, 'staff_type', 'assistant_manager', NULL, NULL, NULL, true, NOW(), NOW());
    `,
    {
      transaction,
      replacements: { templateId },
    },
  );
};

const ensureDirectUserAssignment = async (
  qi: QueryInterface,
  transaction: Transaction,
  templateId: number,
  userId: number,
): Promise<void> => {
  const existing = await qi.sequelize.query<AssignmentRow>(
    `
    SELECT id
    FROM ${TABLE_ASSIGNMENTS}
    WHERE template_id = :templateId
      AND target_scope = 'user'
      AND user_id = :userId
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { templateId, userId },
    },
  );

  if (existing.length > 0) {
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_ASSIGNMENTS}
      SET
        staff_type = NULL,
        effective_start = NULL,
        effective_end = NULL,
        is_active = true,
        updated_at = NOW()
      WHERE id = :id;
      `,
      {
        transaction,
        replacements: { id: existing[0].id },
      },
    );
    return;
  }

  await qi.sequelize.query(
    `
    INSERT INTO ${TABLE_ASSIGNMENTS}
      (template_id, target_scope, staff_type, user_id, effective_start, effective_end, is_active, created_at, updated_at)
    VALUES
      (:templateId, 'user', NULL, :userId, NULL, NULL, true, NOW(), NOW());
    `,
    {
      transaction,
      replacements: { templateId, userId },
    },
  );
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    for (const seed of ALL_TEMPLATE_SEEDS) {
      const templateId = await upsertTemplate(qi, transaction, seed);
      if (seed.assignToAssistantManager) {
        await ensureAssistantManagerAssignment(qi, transaction, templateId);
      }
      if (seed.assignToUserId) {
        await ensureDirectUserAssignment(qi, transaction, templateId, seed.assignToUserId);
      }
    }

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
    const templateNames = ALL_TEMPLATE_SEEDS.map((seed) => seed.name);

    const existing = await qi.sequelize.query<TemplateRow & { name: string }>(
      `
      SELECT id, name
      FROM ${TABLE_TEMPLATES}
      WHERE name = ANY(:templateNames);
      `,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: { templateNames },
      },
    );

    const templateIds = existing.map((row) => row.id);

    if (templateIds.length > 0) {
      await qi.sequelize.query(
        `
        DELETE FROM ${TABLE_ASSIGNMENTS}
        WHERE template_id = ANY(:templateIds);
        `,
        {
          transaction,
          replacements: { templateIds },
        },
      );

      await qi.sequelize.query(
        `
        DELETE FROM ${TABLE_TEMPLATES}
        WHERE id = ANY(:templateIds);
        `,
        {
          transaction,
          replacements: { templateIds },
        },
      );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
