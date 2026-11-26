import type {QueryInterface} from 'sequelize';
type Params={context:QueryInterface};
export async function up({context:qi}:Params):Promise<void>{
  await qi.sequelize.transaction(async transaction=>{
    await qi.sequelize.query(`ALTER TABLE website_enquiry_deliveries
      ADD COLUMN redacted_at TIMESTAMPTZ,
      ADD COLUMN redacted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD CONSTRAINT customer_enquiry_redacted_contents_ck CHECK(redacted_at IS NULL OR
        (enquiry_data IS NULL AND customer_name IS NULL AND customer_email IS NULL AND subject IS NULL
         AND staff_notes='' AND assigned_to IS NULL AND handling_status='closed' AND status='sent'));
      CREATE FUNCTION guard_customer_enquiry_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.redacted_at IS NOT NULL AND (NEW.redacted_at IS DISTINCT FROM OLD.redacted_at
          OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash OR NEW.request_id IS DISTINCT FROM OLD.request_id
          OR NEW.rfc_message_id IS DISTINCT FROM OLD.rfc_message_id OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id) THEN
          RAISE EXCEPTION 'Retain the enquiry removal tombstone and delivery identity';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER customer_enquiry_redaction_guard BEFORE UPDATE ON website_enquiry_deliveries
        FOR EACH ROW EXECUTE FUNCTION guard_customer_enquiry_redaction();`,{transaction});
    // Separate delete permission; ordinary inbox editors receive no new power.
    await qi.sequelize.query(`INSERT INTO "moduleActions"("moduleId","actionId",enabled,"createdAt","updatedAt")
      SELECT m.id,a.id,true,NOW(),NOW() FROM modules m CROSS JOIN actions a
      WHERE m.slug='customer-enquiries-inbox' AND a.key='delete' ON CONFLICT("moduleId","actionId") DO NOTHING;
      INSERT INTO "roleModulePermissions"("userTypeId","moduleId","actionId",allowed,status,"createdAt","updatedAt")
      SELECT ut.id,m.id,a.id,true,true,NOW(),NOW() FROM "userTypes" ut CROSS JOIN modules m CROSS JOIN actions a
      WHERE ut.slug IN('admin','administrator','owner') AND m.slug='customer-enquiries-inbox' AND a.key='delete'
      ON CONFLICT("userTypeId","moduleId","actionId") DO NOTHING;`,{transaction});
  });
}
export async function down({context:qi}:Params):Promise<void>{
  await qi.sequelize.transaction(async transaction=>{
    await qi.sequelize.query('LOCK TABLE website_enquiry_deliveries IN ACCESS EXCLUSIVE MODE',{transaction});
    const [rows]=await qi.sequelize.query('SELECT 1 FROM website_enquiry_deliveries WHERE redacted_at IS NOT NULL LIMIT 1',{transaction});
    if((rows as unknown[]).length)throw new Error('Retain enquiry removal receipts: redacted records cannot be rolled back.');
    await qi.sequelize.query(`DROP TRIGGER customer_enquiry_redaction_guard ON website_enquiry_deliveries;
      DROP FUNCTION guard_customer_enquiry_redaction();
      ALTER TABLE website_enquiry_deliveries DROP CONSTRAINT customer_enquiry_redacted_contents_ck,
        DROP COLUMN redacted_at,DROP COLUMN redacted_by;`,{transaction});
    // Preserve administrator-edited permission rows.
  });
}
