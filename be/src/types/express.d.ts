import type { JwtPayload } from 'jsonwebtoken';
import type { AuthorizationContext } from './AuthenticatedRequest';

declare global {
  namespace Express {
    interface Request {
      user?: string | JwtPayload;
      authContext?: AuthorizationContext;
      permissionCache?: Map<string, Set<string>>;
      /** Server-derived identity used by the public error-ingestion endpoint. */
      monitoringUserId?: number;
      /** Set only after validating the private UI-server telemetry secret. */
      monitoringTrustedInternal?: boolean;
      file?: Express.Multer.File;
      files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
    }
  }
}

export {};
