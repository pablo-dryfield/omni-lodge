import{test}from'node:test';import assert from'node:assert/strict';import{randomBytes,randomUUID}from'node:crypto';import fs from'node:fs';import dotenv from'dotenv';import pg from'pg';import{Sequelize}from'sequelize-typescript';
import WebsiteEnquiryDelivery from'../src/models/WebsiteEnquiryDelivery.ts';
import{up,down}from'../src/migrations/202611220001-website-enquiry-deliveries.ts';
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
  orm=new Sequelize({dialect:'postgres',host:config.host,port:config.port,database:config.database,username:config.user,password:config.password,logging:false,models:[WebsiteEnquiryDelivery],define:{schema},pool:{max:3,min:0}});
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
  const records=await WebsiteEnquiryDelivery.findAll({raw:true});assert.equal(records.length,2);
  assert.ok(!JSON.stringify(records).includes('local-postgres@example.test'));assert.ok(!JSON.stringify(records).includes('INTERNAL LOCAL TEST'));
  await assert.rejects(control.query(`INSERT INTO website_enquiry_deliveries(request_id,form_id,payload_hash,status,rfc_message_id) VALUES($1,'contact',$2,'invalid','<local@test>')`,[randomUUID(),'f'.repeat(64)]),/website_enquiry_delivery_status_ck/);
  await assert.rejects(down({context}),/non-empty delivery table cannot be removed/);
  assert.equal((await WebsiteEnquiryDelivery.count()),2,'Refused rollback retains both deduplication records');
  await WebsiteEnquiryDelivery.destroy({where:{requestId:records.map(x=>x.requestId)}});
  await down({context});
 }finally{
  if(orm)await orm.close();
  if(created){assert.match(schema,/^ktk_enquiry_test_\d+_[a-f0-9]{12}$/);await control.query('SET search_path TO public');await control.query(`DROP SCHEMA "${schema}" CASCADE`);assert.equal((await control.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount,0,'Owned test schema must be absent after cleanup');}
  await control.end();
 }
});
