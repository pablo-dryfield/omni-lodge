import { Request } from 'express';
import { JwtPayload } from 'jsonwebtoken';

export interface AuthorizationContext {
  id: number;
  userTypeId: number | null;
  roleSlug: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: string | JwtPayload;
  authContext?: AuthorizationContext;
  permissionCache?: Map<string, Set<string>>;
}

