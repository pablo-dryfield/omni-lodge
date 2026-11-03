jest.mock('../authMiddleware.js',()=>({__esModule:true,default:jest.fn(async(_req,_res,next)=>next())}));
import authenticate from '../authMiddleware';
import { authenticateWorkspace } from '../databaseWorkspaceAuthentication';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import type { Response } from 'express';
it('authenticates before parsing and avoids repeating authentication only on the identical request',async()=>{
  const req={} as AuthenticatedRequest,res={} as Response,next=jest.fn();
  await authenticateWorkspace(req,res,next);await authenticateWorkspace(req,res,next);
  expect(authenticate).toHaveBeenCalledTimes(1);expect(next).toHaveBeenCalledTimes(2);
  await authenticateWorkspace({} as AuthenticatedRequest,res,next);expect(authenticate).toHaveBeenCalledTimes(2);
});
it('never marks a rejected request as authenticated',async()=>{
  (authenticate as jest.Mock).mockImplementation(async()=>{});const req={} as AuthenticatedRequest,next=jest.fn();
  await authenticateWorkspace(req,{} as Response,next);await authenticateWorkspace(req,{} as Response,next);expect(next).not.toHaveBeenCalled();
});
