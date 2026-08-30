import { Request } from 'express';
import { JwtPayload } from 'jsonwebtoken';

export interface AuthorizationContext {
  id: number;
  userTypeId: number | null;
  roleSlug: string | null;
  userTypeSlug?: string | null;
  roleName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  shiftRoleSlugs?: string[];
}

export interface StaffPayoutReceiptAccessContext {
  userId: number;
  receiptId: number;
  actionId: number;
  tokenId: string;
  expiresAt: number;
}

export interface AuthenticatedRequest extends Request {
  user?: string | JwtPayload;
  authContext?: AuthorizationContext;
  receiptAccess?: StaffPayoutReceiptAccessContext;
  permissionCache?: Map<string, Set<string>>;
  file?: Express.Multer.File;
  files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
}
