import type { QueryInterface } from 'sequelize';
type Params={context:QueryInterface};
export async function up({context:qi}:Params):Promise<void>{
  await qi.sequelize.transaction(async transaction=>{
    await qi.sequelize.query(`ALTER TABLE website_enquiry_deliveries
      ADD COLUMN enquiry_data JSONB,
      ADD COLUMN customer_name TEXT, ADD COLUMN customer_email TEXT, ADD COLUMN subject TEXT,
      ADD COLUMN source_environment VARCHAR(20) NOT NULL DEFAULT 'staging' CHECK(source_environment IN ('staging')),
      ADD COLUMN handling_status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK(handling_status IN ('new','in_progress','replied','closed')),
      ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN staff_notes TEXT NOT NULL DEFAULT '', ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
      CREATE INDEX customer_enquiries_queue_idx ON website_enquiry_deliveries(handling_status,created_at DESC,request_id);
      CREATE TABLE customer_enquiry_templates(
        form_id VARCHAR(80) PRIMARY KEY, subject_template VARCHAR(512) NOT NULL, body_template TEXT NOT NULL,
        layout VARCHAR(20) NOT NULL DEFAULT 'plain_text' CHECK(layout IN ('plain_text','branded')),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE customer_enquiry_events(
        id BIGSERIAL PRIMARY KEY, request_id UUID REFERENCES website_enquiry_deliveries(request_id), form_id VARCHAR(80),
        kind VARCHAR(40) NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), changes JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX customer_enquiry_events_request_idx ON customer_enquiry_events(request_id,id);`,{transaction});
    await qi.sequelize.query(`INSERT INTO pages(slug,name,description,"sortOrder",status,"createdAt","updatedAt")
      VALUES('customer-enquiries','Customer Enquiries','Website enquiries and notification templates',10,true,NOW(),NOW()) ON CONFLICT(slug) DO NOTHING;
      INSERT INTO modules("pageId",slug,name,"componentRef","sortOrder",status,"createdAt","updatedAt")
      SELECT id,'customer-enquiries-inbox','Customer Enquiries Inbox','CustomerEnquiries',1,true,NOW(),NOW() FROM pages WHERE slug='customer-enquiries' ON CONFLICT(slug) DO NOTHING;
      INSERT INTO modules("pageId",slug,name,"componentRef","sortOrder",status,"createdAt","updatedAt")
      SELECT id,'customer-enquiry-templates','Enquiry Email Templates','CustomerEnquiries',2,true,NOW(),NOW() FROM pages WHERE slug='customer-enquiries' ON CONFLICT(slug) DO NOTHING;
      INSERT INTO "moduleActions"("moduleId","actionId",enabled,"createdAt","updatedAt")
      SELECT m.id,a.id,true,NOW(),NOW() FROM modules m CROSS JOIN actions a
      WHERE m.slug IN('customer-enquiries-inbox','customer-enquiry-templates') AND a.key IN('view','update') ON CONFLICT("moduleId","actionId") DO NOTHING;
      INSERT INTO "rolePagePermissions"("userTypeId","pageId","canView",status,"createdAt","updatedAt")
      SELECT ut.id,p.id,true,true,NOW(),NOW() FROM "userTypes" ut CROSS JOIN pages p
      WHERE ut.slug IN('admin','administrator','owner') AND p.slug='customer-enquiries' ON CONFLICT("userTypeId","pageId") DO NOTHING;
      INSERT INTO "roleModulePermissions"("userTypeId","moduleId","actionId",allowed,status,"createdAt","updatedAt")
      SELECT ut.id,m.id,a.id,true,true,NOW(),NOW() FROM "userTypes" ut CROSS JOIN modules m CROSS JOIN actions a
      WHERE ut.slug IN('admin','administrator','owner') AND m.slug IN('customer-enquiries-inbox','customer-enquiry-templates') AND a.key IN('view','update')
      ON CONFLICT("userTypeId","moduleId","actionId") DO NOTHING;`,{transaction});
  });
}
export async function down({context:qi}:Params):Promise<void>{
  await qi.sequelize.transaction(async transaction=>{
    await qi.sequelize.query('LOCK TABLE website_enquiry_deliveries,customer_enquiry_templates,customer_enquiry_events IN ACCESS EXCLUSIVE MODE',{transaction});
    const [rows]=await qi.sequelize.query(`SELECT 1 FROM website_enquiry_deliveries WHERE enquiry_data IS NOT NULL
      UNION ALL SELECT 1 FROM customer_enquiry_templates UNION ALL SELECT 1 FROM customer_enquiry_events LIMIT 1`,{transaction});
    if((rows as unknown[]).length)throw new Error('Retain customer enquiry contents, templates and audit history: non-empty data cannot be rolled back.');
    await qi.sequelize.query(`DROP TABLE customer_enquiry_events,customer_enquiry_templates;
      ALTER TABLE website_enquiry_deliveries DROP COLUMN enquiry_data,DROP COLUMN customer_name,DROP COLUMN customer_email,
      DROP COLUMN subject,DROP COLUMN source_environment,DROP COLUMN handling_status,DROP COLUMN assigned_to,DROP COLUMN staff_notes,DROP COLUMN version;`,{transaction});
    // Preserve administrator-edited permissions and the original delivery identities.
  });
}
