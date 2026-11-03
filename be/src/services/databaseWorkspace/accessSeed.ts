import Page from '../../models/Page.js';
import Module from '../../models/Module.js';
import Action from '../../models/Action.js';
import ModuleAction from '../../models/ModuleAction.js';
import RolePagePermission from '../../models/RolePagePermission.js';
import RoleModulePermission from '../../models/RoleModulePermission.js';
import UserType from '../../models/UserType.js';
import { WORKSPACE_ACTIONS } from './access.js';

export async function ensureDatabaseWorkspaceAccess():Promise<void> {
  const [page]=await Page.findOrCreate({where:{slug:'settings-sql-helper'},defaults:{name:'Database Workspace',description:'PostgreSQL query development and administration',sortOrder:24,status:true}});
  const [module]=await Module.findOrCreate({where:{slug:'database-workspace'},defaults:{name:'Database Workspace',pageId:page.id,description:'Controlled PostgreSQL workbench',componentRef:'DatabaseWorkspace',sortOrder:1,status:true}});
  const roles=await UserType.findAll({where:{slug:['admin','administrator']}});
  for(const role of roles)await RolePagePermission.findOrCreate({where:{userTypeId:role.id,pageId:page.id},defaults:{canView:true,status:true}});
  for(const key of WORKSPACE_ACTIONS){
    const [action]=await Action.findOrCreate({where:{key},defaults:{name:key[0].toUpperCase()+key.slice(1),description:`${key} operation`,isAssignable:true,status:true}});
    await ModuleAction.findOrCreate({where:{moduleId:module.id,actionId:action.id},defaults:{enabled:true}});
    for(const role of roles)await RoleModulePermission.findOrCreate({where:{userTypeId:role.id,moduleId:module.id,actionId:action.id},defaults:{allowed:true,status:true}});
  }
}
