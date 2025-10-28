import type { JwtPayload } from 'jsonwebtoken';
import type { AuthorizationContext } from './AuthenticatedRequest';

declare global {
  namespace Express {
    interface Request {
      user?: string | JwtPayload;
      authContext?: AuthorizationContext;
      permissionCache?: Map<string, Set<string>>;
      file?: Express.Multer.File;
      files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
    }
  }
}

export {};
