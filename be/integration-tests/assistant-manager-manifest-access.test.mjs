import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize } from 'sequelize';
import { up, down, verify } from '../src/migrations/202611200001-assistant-manager-manifest-access.ts';

test('manifest access migration grants both bank-transfer permissions only to assistant managers', async () => {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST), 'Use a local PostgreSQL test connection');
  const database = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    dialect: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), logging: false,
  });
  let transaction;
  try {
    transaction = await database.transaction();
    const query = (sql, options = {}) => database.query(sql, { ...options, transaction });
    const context = { sequelize: { query, transaction: async work => work(transaction) } };
    // A transaction-local schema keeps the cloned application database untouched.
    await query(`CREATE SCHEMA "manifest_access_test_${process.pid}";
      SET LOCAL search_path = "manifest_access_test_${process.pid}";
      CREATE TABLE "userTypes" (id int PRIMARY KEY, slug text);
      CREATE TABLE modules (id int PRIMARY KEY, slug text);
      CREATE TABLE actions (id int PRIMARY KEY, key text);
      CREATE TABLE "roleModulePermissions" (
        "userTypeId" int REFERENCES "userTypes", "moduleId" int REFERENCES modules,
        "actionId" int REFERENCES actions, allowed boolean, status boolean,
        "createdAt" timestamptz, "updatedAt" timestamptz,
        UNIQUE ("userTypeId", "moduleId", "actionId")
      );
      INSERT INTO "userTypes" VALUES (1,'assistant-manager'),(2,'Assistant_Manager'),(3,'assistmanager'),(4,'guide'),(5,'manager');
      INSERT INTO modules VALUES (1,'bank-transfer-booking-management'),(2,'booking-management');
      INSERT INTO actions VALUES (1,'view'),(2,'update'),(3,'create'),(4,'delete');
      INSERT INTO "roleModulePermissions" VALUES (1,1,1,false,false,NOW(),NOW()),(4,1,1,true,true,NOW(),NOW());`);
    assert.equal((await verify({ context })).ok, false, 'missing access must fail verification');
    await up({ context });
    await up({ context });
    assert.equal((await verify({ context })).ok, true);
    const [rows] = await query('SELECT "userTypeId", "moduleId", "actionId", allowed, status FROM "roleModulePermissions" ORDER BY 1,2,3');
    assert.deepEqual(rows, [1, 2, 3].flatMap(role => [1, 2].map(action => ({
      userTypeId: role, moduleId: 1, actionId: action, allowed: true, status: true,
    }))).concat([{ userTypeId: 4, moduleId: 1, actionId: 1, allowed: true, status: true }]));
    await down({ context });
    assert.equal((await verify({ context })).ok, true, 'rollback must not revoke preexisting or edited permissions');
    await query('UPDATE "roleModulePermissions" SET status=false WHERE "userTypeId"=2 AND "actionId"=2');
    assert.equal((await verify({ context })).ok, false, 'every matched role must have both active grants');
  } finally {
    await transaction?.rollback();
    await database.close();
  }
});
