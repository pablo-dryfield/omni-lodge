import type { QueryInterface } from 'sequelize';
import { QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_EMAIL_TEMPLATES = 'email_templates';

type SeedTemplate = {
  name: string;
  description: string;
  templateType: 'react_email';
  subjectTemplate: string;
  bodyTemplate: string;
};

const SEEDED_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Basic Email',
    description:
      'General purpose styled email. Supports placeholders and optional messageLines in templateContext.',
    templateType: 'react_email',
    subjectTemplate: 'Update - {{productName}}',
    bodyTemplate:
      'Hi {{customerName}},\n\nWe are contacting you with an update about {{productName}} scheduled on {{bookingDateDisplay}}.\n\nBest regards,',
  },
  {
    name: 'Booking Refund',
    description:
      'Refund confirmation template that detects full vs partial refund and explains addon/people-change reasons.',
    templateType: 'react_email',
    subjectTemplate: 'Refund update - Booking {{bookingReference}}',
    bodyTemplate:
      'Refunded amount: {{refundedAmount}} {{currency}} for booking {{bookingReference}}. We will keep you updated.',
  },
  {
    name: 'Supply Order',
    description:
      'Operations supply order template with formatted item list, delivery date and request metadata.',
    templateType: 'react_email',
    subjectTemplate: 'Supply Order Request - {{supplierName}} - {{deliveryDate}}',
    bodyTemplate: 'Please process the supply order request for {{supplierName}}.',
  },
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  for (const template of SEEDED_TEMPLATES) {
    const existing = await qi.sequelize.query<{ id: number }>(
      `SELECT id FROM ${TABLE_EMAIL_TEMPLATES} WHERE lower(name) = lower(:name) LIMIT 1;`,
      {
        replacements: { name: template.name },
        type: QueryTypes.SELECT,
      },
    );
    if (existing.length > 0) {
      continue;
    }

    await qi.sequelize.query(
      `
      INSERT INTO ${TABLE_EMAIL_TEMPLATES}
      (name, description, template_type, subject_template, body_template, is_active, created_at, updated_at)
      VALUES (:name, :description, :templateType, :subjectTemplate, :bodyTemplate, true, NOW(), NOW());
      `,
      {
        replacements: {
          name: template.name,
          description: template.description,
          templateType: template.templateType,
          subjectTemplate: template.subjectTemplate,
          bodyTemplate: template.bodyTemplate,
        },
      },
    );
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(
    `
    DELETE FROM ${TABLE_EMAIL_TEMPLATES}
    WHERE name IN (:names);
    `,
    {
      replacements: { names: SEEDED_TEMPLATES.map((template) => template.name) },
    },
  );
}
