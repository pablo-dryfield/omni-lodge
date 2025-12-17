import { Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import dotenv from 'dotenv';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest';

dotenv.config();

const normalizeRoleSlug = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const withHyphens = trimmed.replace(/[\s_]+/g, '-');
  const collapsed = withHyphens.replace(/-/g, '');

  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistantmanager' || collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr' || collapsed === 'manager') {
    return 'manager';
  }
  return withHyphens;
};

const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies['token'];

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as JwtPayload;

    if (!decoded || typeof decoded === 'string' || typeof decoded.id !== 'number') {
      res.status(403).json({ error: 'Forbidden, invalid or expired token' });
      return;
    }

    const user = await User.findByPk(decoded.id, {
      include: [{ model: UserType, as: 'role', attributes: ['id', 'slug', 'name'] }],
    });

    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const role = (user as unknown as { role?: UserType | null }).role ?? null;
    const explicitRole = (user as unknown as { roleKey?: string | null }).roleKey ?? null;
    const roleSlug = normalizeRoleSlug(role?.slug ?? explicitRole ?? null);

    req.user = decoded;
    req.authContext = {
      id: user.id,
      userTypeId: user.userTypeId ?? null,
      roleSlug,
    };
    req.permissionCache = new Map();

    next();
  } catch (error) {
    res.status(403).json({ error: 'Forbidden, invalid or expired token' });
  }
};

export default authenticateJWT;
