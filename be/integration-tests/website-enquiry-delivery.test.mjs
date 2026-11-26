import{test}from'node:test';import assert from'node:assert/strict';import{randomBytes,randomUUID}from'node:crypto';import fs from'node:fs';import dotenv from'dotenv';import pg from'pg';import{Sequelize}from'sequelize-typescript';
import WebsiteEnquiryDelivery from'../src/models/WebsiteEnquiryDelivery.ts';
import CustomerEnquiryEvent from'../src/models/CustomerEnquiryEvent.ts';
import{up,down}from'../src/migrations/202611220001-website-enquiry-deliveries.ts';
import{up as upInbox,down as downInbox}from'../src/migrations/202611230001-customer-enquiries.ts';
import{up as upRemoval,down as downRemoval}from'../src/migrations/202611260001-customer-enquiry-removal.ts';
import{previewEnquiryRemoval,removeEnquiryContents}from'../src/services/customerEnquiryRemoval.ts';
import{websiteEnquiryRepository}from'../src/services/websiteEnquiryRepository.ts';
import{createWebsiteEnquiryService}from'../src/services/websiteEnquiryService.ts';
import{ENQUIRY_FORMS,ENQUIRY_SCHEMA_SHA256}from'../src/services/websiteEnquiryContract.ts';

test('local PostgreSQL uniquely reserves enquiry deliveries, retains uncertainty, and refuses destructive rollback',async()=>{
 const envPath=process.env.KTK_LOCAL_TEST_ENV_FILE||'.env.dev';
 const env={...(fs.existsSync(envPath)?dotenv.parse(fs.readFileSync(envPath)):{}),...process.env};
 assert.ok(['127.0.0.1','localhost','::1'].includes(env.DB_HOST),'Explicit local PostgreSQL required');
 const config={host:env.DB_HOST,port:Number(env.DB_PORT||5432),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD};
 assert.ok(config.database&&config.user,'Explicit local test credentials required');
 const schema='ktk_enquiry_test_'+process.pid+'_'+randomBytes(6).toString('hex');assert.match(schema,/^ktk_enquiry_test_\d+_[a-f0-9]{12}$/);
 const control=new pg.Client(config);await control.connect();let created=false,orm;
 try{
  await control.query(`CREATE SCHEMA "${schema}"`);created=true;
  await control.query(`SET search_path TO "${schema}"`);
  const context={sequelize:{
   query:async sql=>{const result=await control.query(sql);return[result.rows,result];},
   transaction:async fn=>{await control.query('BEGIN');try{const value=await fn({});await control.query('COMMIT');return value;}catch(error){await control.query('ROLLBACK');throw error;}},
  }};
  await up({context});
  // Minimal local access-control fixtures let the actual inbox migration run in the owned schema.
  await control.query(`CREATE TABLE users(id INTEGER PRIMARY KEY);
   CREATE TABLE "userTypes"(id INTEGER PRIMARY KEY,slug TEXT UNIQUE NOT NULL);
   CREATE TABLE pages(id SERIAL PRIMARY KEY,slug TEXT UNIQUE,name TEXT,description TEXT,"sortOrder" INTEGER,status BOOLEAN,"createdAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ);
   CREATE TABLE modules(id SERIAL PRIMARY KEY,"pageId" INTEGER,slug TEXT UNIQUE,name TEXT,"componentRef" TEXT,"sortOrder" INTEGER,status BOOLEAN,"createdAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ);
   CREATE TABLE actions(id SERIAL PRIMARY KEY,key TEXT UNIQUE);
   CREATE TABLE "moduleActions"("moduleId" INTEGER,"actionId" INTEGER,enabled BOOLEAN,"createdAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ,UNIQUE("moduleId","actionId"));
   CREATE TABLE "rolePagePermissions"("userTypeId" INTEGER,"pageId" INTEGER,"canView" BOOLEAN,status BOOLEAN,"createdAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ,UNIQUE("userTypeId","pageId"));
   CREATE TABLE "roleModulePermissions"("userTypeId" INTEGER,"moduleId" INTEGER,"actionId" INTEGER,allowed BOOLEAN,status BOOLEAN,"createdAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ,UNIQUE("userTypeId","moduleId","actionId"));
   INSERT INTO users VALUES(1);INSERT INTO "userTypes" VALUES(1,'admin'),(2,'owner'),(3,'manager');INSERT INTO actions(key)VALUES('view'),('update'),('create'),('delete');`);
  const legacyId=randomUUID();await control.query(`INSERT INTO website_enquiry_deliveries(request_id,form_id,payload_hash,status,rfc_message_id)VALUES($1,'contact',$2,'sent','<historical@test>')`,[legacyId,'a'.repeat(64)]);
  await upInbox({context});
  await upRemoval({context});
  assert.equal((await control.query('SELECT enquiry_data FROM website_enquiry_deliveries WHERE request_id=$1',[legacyId])).rows[0].enquiry_data,null,'Historical contents are never invented or imported');
  assert.equal((await control.query('SELECT count(*)::int AS n FROM "roleModulePermissions" WHERE "userTypeId"=3')).rows[0].n,0,'New inbox is not granted to other roles');
  orm=new Sequelize({dialect:'postgres',host:config.host,port:config.port,database:config.database,username:config.user,password:config.password,logging:false,models:[WebsiteEnquiryDelivery,CustomerEnquiryEvent],define:{schema},pool:{max:3,min:0}});
  assert.equal(WebsiteEnquiryDelivery.getTableName().schema,schema,'ORM and migration must share only the owned schema');
  let release;const pending=new Promise(resolve=>{release=resolve;});const captured=[];
  const service=createWebsiteEnquiryService({repository:websiteEnquiryRepository,getConfig:key=>key==='STOREFRONT_EMAIL_FROM_ADDRESS'?'pubthroughkrakow@gmail.com':key==='STOREFRONT_EMAIL_FROM_NAME'?'Krawl Through Krakow':undefined,
   assertOutboundAllowed:()=>{},sendMail:async mail=>{captured.push(mail);return pending;}});
  const fields=Object.fromEntries(ENQUIRY_FORMS[0].fields.map(f=>[f.id,f.type==='email'?'local-postgres@example.test':'INTERNAL LOCAL TEST']));
  const payload={requestId:randomUUID(),formId:'contact',schemaSha256:ENQUIRY_SCHEMA_SHA256,fields};
  const first=service(payload);
  for(let i=0;i<100&&!captured.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(captured.length,1,'First unique reservation sends only to the capture stub');
  await assert.rejects(service(payload),error=>error.status===409&&error.details.code==='delivery_unconfirmed');
  assert.equal(captured.length,1);release({id:'captured-postgres-receipt'});assert.equal((await first).deduplicated,false);
  assert.equal((await service(payload)).deduplicated,true);assert.equal(captured.length,1);
  await assert.rejects(service({...payload,fields:{...fields,message:'Changed body'}}),error=>error.status===409);
  const fail=createWebsiteEnquiryService({repository:websiteEnquiryRepository,getConfig:key=>key==='STOREFRONT_EMAIL_FROM_ADDRESS'?'pubthroughkrakow@gmail.com':undefined,assertOutboundAllowed:()=>{},sendMail:async()=>{throw Error('Simulated unknown transport');}});
  const unknown={...payload,requestId:randomUUID()};await assert.rejects(fail(unknown),error=>error.status===503);
  await assert.rejects(fail(unknown),error=>error.status===409);
  assert.equal((await WebsiteEnquiryDelivery.findByPk(unknown.requestId)).status,'uncertain');
  const records=await WebsiteEnquiryDelivery.findAll({raw:true});assert.equal(records.length,3);
  const saved=records.find(r=>r.requestId===payload.requestId);assert.equal(saved.customerEmail,'local-postgres@example.test');assert.deepEqual(saved.enquiryData.fields,fields);
  assert.equal(saved.handlingStatus,'new');assert.equal(saved.sourceEnvironment,'staging');assert.equal(saved.enquiryData.notification.subject,saved.subject);
  assert.deepEqual(records.find(r=>r.requestId===unknown.requestId).enquiryData.fields,fields,'Uncertain email still retains the enquiry');
  // Actual transactional removal in this task-owned schema, never a production row or Gmail call.
  await control.query(`CREATE TABLE protected_fixture(id INTEGER PRIMARY KEY,contents JSONB NOT NULL);
    INSERT INTO protected_fixture VALUES(1,'{"booking":"untouched","payment":"untouched","recovery":"untouched"}');`);
  const protectedBefore=(await control.query('SELECT * FROM protected_fixture')).rows;
  const removable=await WebsiteEnquiryDelivery.findByPk(payload.requestId);
  await removable.update({handlingStatus:'closed',staffNotes:'LOCAL PRIVATE NOTE',assignedTo:1,version:2});
  await CustomerEnquiryEvent.create({requestId:payload.requestId,formId:'contact',kind:'enquiry.updated',actorId:1,changes:{privateDetail:'LOCAL AUDIT CONTENT'}});
  const history=await CustomerEnquiryEvent.findAll({where:{requestId:payload.requestId},order:[['id','ASC']]});
  const preview=previewEnquiryRemoval(removable,history,true);
  const confirmation={version:2,fingerprint:preview.fingerprint,confirmation:payload.requestId,reviewedRetention:true,understandsOtherCopies:true,reason:'purpose_ended'};
  assert.equal(preview.canExecute,true);assert.equal(previewEnquiryRemoval(removable,history,false).canExecute,false);
  const immutableBefore=Object.fromEntries(['requestId','payloadHash','rfcMessageId','providerMessageId','status','sentAt','createdAt'].map(k=>[k,removable[k]]));
  // A failure after the writes must roll back contents and activity, not leave partial erasure.
  await assert.rejects(orm.transaction(async transaction=>{await removeEnquiryContents(payload.requestId,confirmation,1,transaction);throw Error('SIMULATED COMMIT REFUSAL');}),/SIMULATED COMMIT REFUSAL/);
  assert.equal((await WebsiteEnquiryDelivery.findByPk(payload.requestId)).staffNotes,'LOCAL PRIVATE NOTE');
  assert.equal((await CustomerEnquiryEvent.findAll({where:{requestId:payload.requestId}})).length,1);
  // Concurrent confirmations serialize: exactly one succeeds and one reports the retained tombstone.
  const parallel=await Promise.allSettled([1,2].map(()=>orm.transaction(transaction=>removeEnquiryContents(payload.requestId,confirmation,1,transaction))));
  assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(parallel.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  const removed=await WebsiteEnquiryDelivery.findByPk(payload.requestId);
  assert.ok(removed.redactedAt);assert.equal(removed.version,3);assert.equal(removed.enquiryData,null);assert.equal(removed.customerEmail,null);assert.equal(removed.customerName,null);assert.equal(removed.subject,null);assert.equal(removed.staffNotes,'');assert.equal(removed.assignedTo,null);
  assert.deepEqual(Object.fromEntries(Object.keys(immutableBefore).map(k=>[k,removed[k]])),immutableBefore);
  const retainedEvents=await CustomerEnquiryEvent.findAll({where:{requestId:payload.requestId},order:[['id','ASC']]});
  assert.equal(retainedEvents.length,2);assert.deepEqual(retainedEvents[0].changes,{detailsRemoved:true});assert.equal(retainedEvents[1].kind,'enquiry.contents_removed');
  assert.equal((await service(payload)).deduplicated,true);assert.equal(captured.length,1,'Removed contents must never reset a send reservation');
  await assert.rejects(control.query('UPDATE website_enquiry_deliveries SET customer_email=$1 WHERE request_id=$2',['restore@example.test',payload.requestId]),/customer_enquiry_redacted_contents_ck/);
  await assert.rejects(control.query('UPDATE website_enquiry_deliveries SET redacted_at=NULL WHERE request_id=$1',[payload.requestId]),/Retain the enquiry removal tombstone/);
  await assert.rejects(downRemoval({context}),/redacted records cannot be rolled back/);
  assert.deepEqual((await control.query('SELECT * FROM protected_fixture')).rows,protectedBefore);
  await assert.rejects(downInbox({context}),/non-empty data cannot be rolled back/);
  assert.equal((await control.query('SELECT count(*)::int AS n FROM website_enquiry_deliveries')).rows[0].n,3);
  await assert.rejects(control.query(`INSERT INTO customer_enquiry_templates(form_id,subject_template,body_template,layout)VALUES('contact','Subject','Body','script')`),/check constraint/);
  await control.query(`INSERT INTO customer_enquiry_templates(form_id,subject_template,body_template,updated_by)VALUES('contact','Subject','Body',1)`);
  await assert.rejects(control.query(`INSERT INTO customer_enquiry_templates(form_id,subject_template,body_template)VALUES('contact','Other','Other')`),/duplicate key/);
  await control.query(`DELETE FROM customer_enquiry_templates WHERE form_id='contact'`);
  await assert.rejects(control.query(`INSERT INTO website_enquiry_deliveries(request_id,form_id,payload_hash,status,rfc_message_id) VALUES($1,'contact',$2,'invalid','<local@test>')`,[randomUUID(),'f'.repeat(64)]),/website_enquiry_delivery_status_ck/);
  await assert.rejects(down({context}),/non-empty delivery table cannot be removed/);
  assert.equal((await WebsiteEnquiryDelivery.count()),3,'Refused rollback retains old and new deduplication records');
  await CustomerEnquiryEvent.destroy({where:{requestId:records.map(x=>x.requestId)}});
  await WebsiteEnquiryDelivery.destroy({where:{requestId:records.map(x=>x.requestId)}});
  await downRemoval({context});
  await downInbox({context});
  await down({context});
 }finally{
  if(orm)await orm.close();
  if(created){assert.match(schema,/^ktk_enquiry_test_\d+_[a-f0-9]{12}$/);await control.query('SET search_path TO public');await control.query(`DROP SCHEMA "${schema}" CASCADE`);assert.equal((await control.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount,0,'Owned test schema must be absent after cleanup');}
  await control.end();
 }
});
