jest.mock('../../middleware/authorizationMiddleware.js',()=>({hasModuleActionPermission:jest.fn(async()=>true)}));
jest.mock('../../models/RolePagePermission.js',()=>({__esModule:true,default:{count:jest.fn(async()=>1)}}));
jest.mock('../../models/ModuleAction.js',()=>({__esModule:true,default:{count:jest.fn(async()=>1)}}));
jest.mock('../../models/User.js',()=>({__esModule:true,default:{findByPk:jest.fn()}}));
jest.mock('../../models/UserType.js',()=>({__esModule:true,default:{}}));
jest.mock('../../models/UserTypeProductType.js',()=>({__esModule:true,default:{count:jest.fn(async()=>0)}}));
jest.mock('../../models/Page.js',()=>({__esModule:true,default:{}}));
jest.mock('../../models/Module.js',()=>({__esModule:true,default:{}}));
jest.mock('../../models/Action.js',()=>({__esModule:true,default:{}}));
jest.mock('../databaseWorkspace/config.js',()=>({workspaceConfiguration:jest.fn(async()=>({enabled:true,policyHash:'current'}))}));

import { workspaceAccess, reauthorizeExecution, WORKSPACE_ACTIONS } from '../databaseWorkspace/access';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware';
import RolePagePermission from '../../models/RolePagePermission';
import ModuleAction from '../../models/ModuleAction';
import User from '../../models/User';
import UserTypeProductType from '../../models/UserTypeProductType';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
const req=(roleSlug='admin',scoped=false)=>({authContext:{id:7,userTypeId:2,roleSlug},...(scoped?{productTypeScope:[3]}:{})}) as AuthenticatedRequest;
beforeEach(()=>{jest.clearAllMocks();(hasModuleActionPermission as jest.Mock).mockResolvedValue(true);(RolePagePermission.count as jest.Mock).mockResolvedValue(1);(ModuleAction.count as jest.Mock).mockResolvedValue(1);(UserTypeProductType.count as jest.Mock).mockResolvedValue(0);(User.findByPk as jest.Mock).mockResolvedValue({id:7,userTypeId:2,status:true,approved:true,role:{slug:'admin',status:true}});});
it.each(WORKSPACE_ACTIONS)('denies %s to anonymous, ordinary, company-owner and product-scoped administrator accounts',async action=>{
  for(const r of [{} as AuthenticatedRequest,req('user'),req('manager'),req('owner'),req('food-tour-owner',true),req('admin',true)])await expect(workspaceAccess(r,action)).rejects.toMatchObject({status:403});
  expect(RolePagePermission.count).not.toHaveBeenCalled();
});
it.each(['admin','administrator'])('requires page, view, active action and action grant for %s',async role=>{
  await expect(workspaceAccess(req(role),'write')).resolves.toBe(7);
  (RolePagePermission.count as jest.Mock).mockResolvedValueOnce(0);await expect(workspaceAccess(req(role),'read')).rejects.toMatchObject({code:'CAPABILITY_REQUIRED'});
  (hasModuleActionPermission as jest.Mock).mockImplementation(async(_r,_m,a)=>a!=='write');await expect(workspaceAccess(req(role),'write')).rejects.toMatchObject({status:403});
  (hasModuleActionPermission as jest.Mock).mockResolvedValue(true);(ModuleAction.count as jest.Mock).mockResolvedValue(0);await expect(workspaceAccess(req(role),'read')).rejects.toMatchObject({status:403});
});
it('reauthorizes current account approval, product scope, grants and exact policy before execution',async()=>{
  await expect(reauthorizeExecution(7,'write','current')).resolves.toBeUndefined();
  await expect(reauthorizeExecution(7,'read','old')).rejects.toMatchObject({code:'POLICY_CHANGED'});
  (UserTypeProductType.count as jest.Mock).mockResolvedValue(1);await expect(reauthorizeExecution(7,'read','current')).rejects.toMatchObject({code:'AUTHORITY_REVOKED'});
  (UserTypeProductType.count as jest.Mock).mockResolvedValue(0);(User.findByPk as jest.Mock).mockResolvedValue({status:false});await expect(reauthorizeExecution(7,'read','current')).rejects.toMatchObject({code:'AUTHORITY_REVOKED'});
});
