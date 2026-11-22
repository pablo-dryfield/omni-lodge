import type { QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export const CREATE_DELIVERY_TABLE_SQL = `CREATE TABLE website_enquiry_deliveries (
  request_id UUID NOT NULL PRIMARY KEY,
  form_id VARCHAR(80) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CONSTRAINT website_enquiry_delivery_status_ck CHECK (status IN ('sending','sent','uncertain')),
  rfc_message_id VARCHAR(160) NOT NULL,
  provider_message_id VARCHAR(200), sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
export async function up({context: qi}: Params): Promise<void> {
  await qi.sequelize.query(CREATE_DELIVERY_TABLE_SQL);
}
export async function down({context: qi}: Params): Promise<void> {
  await qi.sequelize.transaction(async transaction => {
    await qi.sequelize.query('LOCK TABLE website_enquiry_deliveries IN ACCESS EXCLUSIVE MODE', {transaction});
    const [rows] = await qi.sequelize.query('SELECT 1 FROM website_enquiry_deliveries LIMIT 1', {transaction});
    if ((rows as unknown[]).length) throw new Error('Retain enquiry delivery identities: a non-empty delivery table cannot be removed');
    await qi.sequelize.query('DROP TABLE website_enquiry_deliveries', {transaction});
  });
}
