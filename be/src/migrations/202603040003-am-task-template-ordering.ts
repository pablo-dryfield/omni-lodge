import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_TEMPLATES = 'am_task_templates';

const SOCIAL_AND_CONTENT = [
  ['Daily - Social story', 1],
  ['Daily - Photo workflow and Facebook album', 2],
  ['Weekly - IG and TikTok posts', 3],
  ['Weekly - Content planning meeting', 4],
] as const;

const BOOKINGS_AND_COMMS = [
  ['Daily - Check booking numbers', 1],
  ['Daily - Prepare WhatsApp group', 2],
  ['Daily - Rejoin message to previous day group', 3],
  ['Daily - Send picture link to previous day group', 4],
] as const;

const SHIFT_PREPARATION = [
  ['Daily - Charge camera and lights', 1],
  ['Daily - Prepare wristbands', 2],
  ['Daily - Prepare booking add-ons', 3],
  ['Daily - Power Hour update 17:00', 4],
  ['Daily - Power Hour update 20:00', 5],
  ['Daily - Power Hour update 21:00', 6],
] as const;

const NIGHT_SUPERVISION = [
  ['Daily - Arrive at 20:45 and check late staff', 1],
  ['Daily - Supervise night and take photos', 2],
  ['Daily - Deliver city rules flyers', 3],
  ['Daily - Enforce city rules during the night', 4],
] as const;

const TEAM_OVERSIGHT_AND_SAFETY = [
  ['Daily - Monitor KTK Promotion chat', 1],
  ['Daily - Review KTK House Cleaning photos', 2],
  ['Daily - Monitor staff and guest condition', 3],
  ['Weekly - Secretly review volunteer promotion', 4],
  ['Weekly - Buy staff supplies', 5],
] as const;

const SHARED_DUTIES = [
  ['Shared Duty - Brunch host', 1],
  ['Shared Duty - New volunteer accommodation onboarding', 2],
  ['Shared Duty - Staff induction', 3],
  ['Shared Duty - Pablo ad hoc request', 4],
] as const;

const updateTemplateOrdering = async (
  qi: QueryInterface,
  entries: readonly (readonly [string, number])[],
  subgroup: string,
  subgroupOrder: number,
  transaction: Transaction,
) => {
  for (const [name, templateOrder] of entries) {
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET
        category_order = 1,
        subgroup_order = :subgroupOrder,
        template_order = :templateOrder,
        subgroup = :subgroup,
        updated_at = NOW()
      WHERE category = 'Assistant Manager Tasks'
        AND name = :name;
      `,
      {
        transaction,
        replacements: {
          subgroup,
          subgroupOrder,
          templateOrder,
          name,
        },
      },
    );
  }
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      TABLE_TEMPLATES,
      'category_order',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_TEMPLATES,
      'subgroup_order',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_TEMPLATES,
      'template_order',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET
        category_order = CASE
          WHEN category = 'Assistant Manager Tasks' THEN 1
          ELSE 100
        END,
        subgroup_order = COALESCE(subgroup_order, 100),
        template_order = COALESCE(template_order, 100);
      `,
      { transaction },
    );

    await updateTemplateOrdering(qi, SOCIAL_AND_CONTENT, 'Social and Content', 1, transaction);
    await updateTemplateOrdering(qi, BOOKINGS_AND_COMMS, 'Bookings and Guest Comms', 2, transaction);
    await updateTemplateOrdering(qi, SHIFT_PREPARATION, 'Shift Preparation', 3, transaction);
    await updateTemplateOrdering(qi, NIGHT_SUPERVISION, 'Night Supervision', 4, transaction);
    await updateTemplateOrdering(qi, TEAM_OVERSIGHT_AND_SAFETY, 'Team Oversight and Safety', 5, transaction);
    await updateTemplateOrdering(qi, SHARED_DUTIES, 'Shared Duties', 6, transaction);

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
    await qi.removeColumn(TABLE_TEMPLATES, 'template_order', { transaction });
    await qi.removeColumn(TABLE_TEMPLATES, 'subgroup_order', { transaction });
    await qi.removeColumn(TABLE_TEMPLATES, 'category_order', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
