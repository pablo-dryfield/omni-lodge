import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_TEMPLATES = 'am_task_templates';
const DEFAULT_CATEGORY = 'Assistant Manager Tasks';
const DEFAULT_SUBGROUP = 'General';

const SOCIAL_AND_CONTENT = [
  'Daily - Social story',
  'Daily - Photo workflow and Facebook album',
  'Weekly - IG and TikTok posts',
  'Weekly - Content planning meeting',
];

const BOOKINGS_AND_COMMS = [
  'Daily - Check booking numbers',
  'Daily - Prepare WhatsApp group',
  'Daily - Rejoin message to previous day group',
  'Daily - Send picture link to previous day group',
];

const SHIFT_PREP = [
  'Daily - Charge camera and lights',
  'Daily - Prepare wristbands',
  'Daily - Prepare booking add-ons',
  'Daily - Power Hour update 17:00',
  'Daily - Power Hour update 20:00',
  'Daily - Power Hour update 21:00',
];

const NIGHT_SUPERVISION = [
  'Daily - Arrive at 20:45 and check late staff',
  'Daily - Supervise night and take photos',
  'Daily - Deliver city rules flyers',
  'Daily - Enforce city rules during the night',
];

const TEAM_AND_SAFETY = [
  'Daily - Monitor KTK Promotion chat',
  'Daily - Review KTK House Cleaning photos',
  'Daily - Monitor staff and guest condition',
  'Weekly - Secretly review volunteer promotion',
  'Weekly - Buy staff supplies',
];

const SHARED_DUTIES = [
  'Shared Duty - Brunch host',
  'Shared Duty - New volunteer accommodation onboarding',
  'Shared Duty - Staff induction',
  'Shared Duty - Pablo ad hoc request',
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      TABLE_TEMPLATES,
      'category',
      {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: DEFAULT_CATEGORY,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_TEMPLATES,
      'subgroup',
      {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: DEFAULT_SUBGROUP,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET
        category = :defaultCategory,
        subgroup = CASE
          WHEN name IN (:socialAndContent) THEN 'Social and Content'
          WHEN name IN (:bookingsAndComms) THEN 'Bookings and Guest Comms'
          WHEN name IN (:shiftPrep) THEN 'Shift Preparation'
          WHEN name IN (:nightSupervision) THEN 'Night Supervision'
          WHEN name IN (:teamAndSafety) THEN 'Team Oversight and Safety'
          WHEN name IN (:sharedDuties) THEN 'Shared Duties'
          ELSE COALESCE(NULLIF(subgroup, ''), :defaultSubgroup)
        END;
      `,
      {
        transaction,
        replacements: {
          defaultCategory: DEFAULT_CATEGORY,
          defaultSubgroup: DEFAULT_SUBGROUP,
          socialAndContent: SOCIAL_AND_CONTENT,
          bookingsAndComms: BOOKINGS_AND_COMMS,
          shiftPrep: SHIFT_PREP,
          nightSupervision: NIGHT_SUPERVISION,
          teamAndSafety: TEAM_AND_SAFETY,
          sharedDuties: SHARED_DUTIES,
        },
      },
    );

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
    await qi.removeColumn(TABLE_TEMPLATES, 'subgroup', { transaction });
    await qi.removeColumn(TABLE_TEMPLATES, 'category', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
