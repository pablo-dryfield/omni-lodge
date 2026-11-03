import type { QueryInterface } from 'sequelize';
import { ensureDatabaseWorkspaceAccess } from '../services/databaseWorkspace/accessSeed.js';
type Params={context:QueryInterface};
export async function up(_params:Params):Promise<void>{await ensureDatabaseWorkspaceAccess();}
export async function down({context}:Params):Promise<void>{
  await context.sequelize.query(`UPDATE "rolePagePermissions" SET "canView"=false WHERE "pageId" IN (SELECT id FROM pages WHERE slug='settings-sql-helper')`);
}
