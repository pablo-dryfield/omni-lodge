import type { QueryInterface } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TEMPLATE_NAME = 'T-Shirt Size Selection';
const TEMPLATE_DESCRIPTION =
  'Automatic customer request for T-shirt sizes. Available variants come from live inventory; customers reply with their preferred sizes.';

export const TSHIRT_SIZE_EMAIL_TEMPLATE_SOURCE = `/* @react-email-template-source */
const { Html, Head, Preview, Body, Container, Section, Text, Heading } = components;
const sizes = Array.isArray(availableTshirtSizes) ? availableTshirtSizes : [];
const count = Math.max(1, Number(tshirtsCount || extrasTshirts || 1));
return (
  <Html>
    <Head />
    <Preview>Please choose your T-shirt size{count === 1 ? '' : 's'}</Preview>
    <Body style={{ backgroundColor: '#f5f7fb', fontFamily: 'Arial, sans-serif', margin: 0, padding: '28px 12px' }}>
      <Container style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px', margin: '0 auto', maxWidth: '600px', padding: '32px' }}>
        <Heading style={{ color: '#111827', fontSize: '24px', margin: '0 0 18px' }}>Choose your T-shirt size{count === 1 ? '' : 's'}</Heading>
        <Text style={{ color: '#374151', fontSize: '16px', lineHeight: '24px' }}>Hi {customerName || 'there'},</Text>
        <Text style={{ color: '#374151', fontSize: '16px', lineHeight: '24px' }}>
          Your booking includes {count} T-shirt{count === 1 ? '' : 's'}. Please reply to this email with one size for each T-shirt.
        </Text>
        <Section style={{ backgroundColor: '#eff6ff', borderRadius: '10px', margin: '22px 0', padding: '18px' }}>
          <Text style={{ color: '#1e3a8a', fontSize: '14px', fontWeight: 'bold', margin: '0 0 12px' }}>AVAILABLE SIZES</Text>
          <Text style={{ color: '#1d4ed8', fontSize: '18px', fontWeight: 'bold', margin: 0 }}>
            {sizes.length > 0 ? sizes.join('  ·  ') : 'Please contact us for current availability'}
          </Text>
        </Section>
        <Text style={{ color: '#6b7280', fontSize: '14px', lineHeight: '21px' }}>
          Booking: {bookingReference || platformBookingId || bookingId} · {productName || 'Experience'}{bookingDateDisplay ? ' · ' + bookingDateDisplay : ''}
        </Text>
        <Text style={{ color: '#374151', fontSize: '16px', lineHeight: '24px', marginTop: '24px' }}>Best regards,<br />Omni Lodge</Text>
      </Container>
    </Body>
  </Html>
);`;

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.addColumn('bookings', 'tshirt_size_email_status', {
      type: DataTypes.STRING(20),
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_attempted_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_sent_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_message_id', {
      type: DataTypes.STRING(256),
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_error', {
      type: DataTypes.TEXT,
      allowNull: true,
    }, { transaction });
    await context.addIndex('bookings', ['tshirt_size_email_status'], {
      name: 'bookings_tshirt_size_email_status_idx',
      transaction,
    });

    const existing = await context.sequelize.query<{ id: number }>(
      'SELECT id FROM email_templates WHERE lower(name) = lower(:name) LIMIT 1;',
      { replacements: { name: TEMPLATE_NAME }, type: QueryTypes.SELECT, transaction },
    );
    if (existing.length === 0) {
      await context.sequelize.query(
        `INSERT INTO email_templates
          (name, description, template_type, subject_template, body_template, is_active, created_at, updated_at)
         VALUES
          (:name, :description, 'react_email', :subject, :body, true, NOW(), NOW());`,
        {
          replacements: {
            name: TEMPLATE_NAME,
            description: TEMPLATE_DESCRIPTION,
            subject: 'Choose your T-shirt sizes - Booking {{bookingReference}}',
            body: TSHIRT_SIZE_EMAIL_TEMPLATE_SOURCE,
          },
          transaction,
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
  const transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      'DELETE FROM email_templates WHERE lower(name) = lower(:name) AND description = :description;',
      { replacements: { name: TEMPLATE_NAME, description: TEMPLATE_DESCRIPTION }, transaction },
    );
    await context.removeIndex('bookings', 'bookings_tshirt_size_email_status_idx', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_error', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_message_id', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_sent_at', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_attempted_at', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_status', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
