import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import { Op, UniqueConstraintError, ValidationError } from 'sequelize';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import AuditLog from '../models/AuditLog.js';
import StaffProfile from '../models/StaffProfile.js';
import ShiftRole from '../models/ShiftRole.js';
import UserShiftRole from '../models/UserShiftRole.js';
import { deleteProfilePhoto, storeProfilePhoto, StoreProfilePhotoResult, openProfilePhotoStream } from '../services/profilePhotoStorageService.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { Env } from '../types/Env.js';
import logger from '../utils/logger.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  buildBadgeCampaignSourceName,
  resolveBadgeTemplateVariant,
  sendBadgeToPrint,
} from '../services/badgePrintService.js';
import { upsertBadgeAffiliateAssignment } from '../services/affiliateService.js';

const NAME_TO_SLUG: Record<string, string[]> = {
  guide: ['guide', 'pub-crawl-guide'],
  'pub crawl guide': ['pub-crawl-guide'],
  'pub_crawl_guide': ['pub-crawl-guide'],
  admin: ['admin', 'administrator'],
  administrator: ['administrator', 'admin'],
  manager: ['manager'],
  'assistant manager': ['assistant-manager'],
  'assistant-manager': ['assistant-manager'],
  'assistant_manager': ['assistant-manager'],
  'assistantmanager': ['assistant-manager'],
  owner: ['owner'],
};

const SIGNUP_STAFF_TYPES: Array<StaffProfile['staffType']> = ['volunteer', 'long_term'];
const DISALLOWED_SIGNUP_ROLE_SLUGS = new Set(['leader', 'manager']);
const SIGNUP_USER_TYPE_SLUGS = {
  guide: ['guide', 'pub-crawl-guide'],
  social_media: ['social-media', 'social_media'],
} as const;

type SignupUserTypeKey = keyof typeof SIGNUP_USER_TYPE_SLUGS;

const normalizeStaffType = (value: unknown): StaffProfile['staffType'] | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase() as StaffProfile['staffType'];
  return SIGNUP_STAFF_TYPES.find((type) => type === normalized);
};

const normalizeSignupUserType = (value: unknown): SignupUserTypeKey => {
  if (typeof value !== 'string') {
    return 'guide';
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized === 'social_media' ? 'social_media' : 'guide';
};

const signupUserTypeToRequestedValue = (value: SignupUserTypeKey): string =>
  value === 'social_media' ? 'social-media' : 'guide';

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(trimmed)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(trimmed)) {
      return false;
    }
  }
  return fallback;
};

const normalizeRoleIds = (value: unknown): number[] => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return normalizeRoleIds(parsed);
      }
    } catch {
      const csv = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (csv.length > 0) {
        return normalizeRoleIds(csv);
      }
    }
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => Number(entry))
        .filter((entry): entry is number => Number.isInteger(entry) && entry > 0),
    ),
  );
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const canManageOtherUserBadges = (request: AuthenticatedRequest): boolean => {
  const roleSlug = request.authContext?.roleSlug ?? null;
  return ['owner', 'admin', 'manager', 'assistant-manager'].includes(roleSlug ?? '');
};

const buildDisplayName = (user: Pick<User, 'firstName' | 'lastName' | 'username' | 'email'>): string => {
  const first = user.firstName?.trim() ?? '';
  const last = user.lastName?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  return combined || user.username || user.email;
};

export const recordUserAuditLog = async (options: {
  actorId?: number | null;
  action: string;
  userId: number;
  meta?: Record<string, unknown>;
}): Promise<void> => {
  await AuditLog.create({
    actorId: options.actorId ?? null,
    action: options.action,
    entity: 'user',
    entityId: String(options.userId),
    metaJson: options.meta ?? {},
  });
};

export const sendApprovedUserBadgeToPrint = async (options: {
  user: User;
  role: UserType | null;
  actorId?: number | null;
}): Promise<void> => {
  const badgeName = normalizeOptionalString(options.user.badgeName) ?? normalizeOptionalString(options.user.firstName);
  if (!badgeName) {
    await recordUserAuditLog({
      actorId: options.actorId,
      action: 'user.badge_print_skipped',
      userId: options.user.id,
      meta: {
        trigger: 'approval',
        reason: 'missing_badge_name',
      },
    });
    return;
  }

  const campaignSourceName = buildBadgeCampaignSourceName(options.user.firstName, options.user.id);
  const templateVariant = resolveBadgeTemplateVariant({
    userTypeSlug: options.role?.slug ?? options.user.requestedUserType ?? null,
    userTypeName: options.role?.name ?? null,
  });

  await sendBadgeToPrint({
    userDisplayName: buildDisplayName(options.user),
    badgeName,
    badgePrefixEmoji: options.user.badgePrefixEmoji,
    badgeSuffixEmoji: options.user.badgeSuffixEmoji,
    campaignSourceName,
    templateVariant,
  });
  await upsertBadgeAffiliateAssignment({
    userId: options.user.id,
    utmSource: campaignSourceName,
    actorId: options.actorId ?? null,
  });
  await recordUserAuditLog({
    actorId: options.actorId,
    action: 'user.badge_sent_to_print',
    userId: options.user.id,
    meta: {
      trigger: 'approval',
      campaignSourceName,
      templateVariant,
    },
  });
};

declare const process: {
  env: Env;
};

function buildUserColumns() {
  const attributes = User.getAttributes();
  const hiddenColumns = new Set(['badgeName', 'badgePrefixEmoji', 'badgeSuffixEmoji']);
  return Object.entries(attributes)
    .filter(([key]) => !hiddenColumns.has(key))
    .map(([key, attribute]) => ({
      header: key.charAt(0).toUpperCase() + key.slice(1),
      accessorKey: key,
      type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
    }));
}

export const registerUser = async (req: Request, res: Response): Promise<void> => {
  const profilePhotoFile = req.file;
  let uploadedPhotoPath: string | null = null;
  let uploadedPhotoShouldCleanup = false;
  try {
    const sequelize = User.sequelize;
    if (!sequelize) {
      res.status(500).json([{ message: 'Database connection is not available' }]);
      return;
    }

    const staffType = normalizeStaffType(req.body.staffType);
    const livesInAccom = normalizeBoolean(req.body.livesInAccom);
    const shiftRoleIds = normalizeRoleIds(req.body.shiftRoleIds);
    const signupUserType = normalizeSignupUserType(req.body.signupUserType);

    let createdUser: User | null = null;

    await sequelize.transaction(async (transaction) => {
      const signupRole = await UserType.findOne({
        where: {
          slug: {
            [Op.in]: [...SIGNUP_USER_TYPE_SLUGS[signupUserType]],
          },
        },
        transaction,
      });

      if (!signupRole) {
        throw new HttpError(400, 'Selected user type is not configured.');
      }

      const {
        username,
        email,
        password,
        firstName,
        lastName,
        phone,
        countryOfCitizenship,
        dateOfBirth,
        preferredPronouns,
        emergencyContactName,
        emergencyContactRelationship,
        emergencyContactPhone,
        emergencyContactEmail,
        arrivalDate,
        departureDate,
        dietaryRestrictions,
        allergies,
        medicalNotes,
        whatsappHandle,
        facebookProfileUrl,
        instagramProfileUrl,
        discoverySource,
        badgeName,
        badgePrefixEmoji,
        badgeSuffixEmoji,
      } = req.body;

      const existingUser = await User.findOne({
        where: {
          [Op.or]: [{ username }, { email }],
        },
        transaction,
      });
      if (existingUser) {
        if (existingUser.email === email) {
          throw new HttpError(409, 'Email is already registered.');
        }
        throw new HttpError(409, 'Username is already taken.');
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const userPayload = {
        username,
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone: normalizeOptionalString(phone),
        countryOfCitizenship: normalizeOptionalString(countryOfCitizenship),
        dateOfBirth: normalizeOptionalString(dateOfBirth),
        preferredPronouns: normalizeOptionalString(preferredPronouns),
        emergencyContactName: normalizeOptionalString(emergencyContactName),
        emergencyContactRelationship: normalizeOptionalString(emergencyContactRelationship),
        emergencyContactPhone: normalizeOptionalString(emergencyContactPhone),
        emergencyContactEmail: normalizeOptionalString(emergencyContactEmail),
        arrivalDate: normalizeOptionalString(arrivalDate),
        departureDate: normalizeOptionalString(departureDate),
        dietaryRestrictions: normalizeOptionalString(dietaryRestrictions),
        allergies: normalizeOptionalString(allergies),
        medicalNotes: normalizeOptionalString(medicalNotes),
        whatsappHandle: normalizeOptionalString(whatsappHandle),
        facebookProfileUrl: normalizeOptionalString(facebookProfileUrl),
        instagramProfileUrl: normalizeOptionalString(instagramProfileUrl),
        discoverySource: normalizeOptionalString(discoverySource),
        badgeName: normalizeOptionalString(badgeName),
        badgePrefixEmoji: normalizeOptionalString(badgePrefixEmoji),
        badgeSuffixEmoji: normalizeOptionalString(badgeSuffixEmoji),
        requestedUserType: signupUserTypeToRequestedValue(signupUserType),
        userTypeId: signupRole.id,
        approved: false,
      };

      const newUser = await User.create(userPayload, { transaction });
      createdUser = newUser;

      await AuditLog.create(
        {
          actorId: null,
          action: 'user.signup_created',
          entity: 'user',
          entityId: String(newUser.id),
          metaJson: {
            approved: false,
            requestedUserType: signupUserTypeToRequestedValue(signupUserType),
            userTypeId: signupRole.id,
            staffType: staffType ?? null,
          },
        },
        { transaction },
      );

      const shouldCreateStaffProfile = Boolean(staffType);
      let profilePhotoPathValue: string | null = null;
      let profilePhotoUrlValue: string | null = null;

      if (profilePhotoFile) {
        if (!shouldCreateStaffProfile) {
          throw new HttpError(400, 'Staff type selection is required to upload a profile photo.');
        }

        let uploadResult: StoreProfilePhotoResult | null = null;
        try {
          uploadResult = await storeProfilePhoto({
            userId: newUser.id,
            originalName: profilePhotoFile.originalname,
            mimeType: profilePhotoFile.mimetype,
            data: profilePhotoFile.buffer,
          });
        } catch (error) {
          logger.warn(`Failed to upload profile photo for user ${newUser.id}: ${(error as Error).message}`);
        }

        if (uploadResult) {
          uploadedPhotoPath = uploadResult.relativePath;
          uploadedPhotoShouldCleanup = true;
          profilePhotoPathValue = uploadResult.relativePath;
          profilePhotoUrlValue = uploadResult.driveWebViewLink ?? null;

          await newUser.update(
            {
              profilePhotoPath: profilePhotoPathValue,
              profilePhotoUrl: profilePhotoUrlValue,
            },
            { transaction },
          );
          newUser.profilePhotoPath = profilePhotoPathValue;
          newUser.profilePhotoUrl = profilePhotoUrlValue;
        }
      }

      if (shouldCreateStaffProfile) {
        await StaffProfile.create(
          {
            userId: newUser.id,
            staffType,
            livesInAccom,
            active: true,
          },
          { transaction },
        );
      }

      if (shiftRoleIds.length > 0) {
        const roles = await ShiftRole.findAll({
          where: { id: { [Op.in]: shiftRoleIds } },
          transaction,
        });

        if (roles.length !== shiftRoleIds.length) {
          throw new HttpError(400, 'One or more shift roles do not exist.');
        }

        const forbiddenRole = roles.find((role) => {
          const slug = (role.slug ?? role.name ?? '').trim().toLowerCase();
          return DISALLOWED_SIGNUP_ROLE_SLUGS.has(slug);
        });

        if (forbiddenRole) {
          throw new HttpError(400, 'Selected shift roles are not available during signup.');
        }

        const assignmentRows = roles.map((role) => ({
          userId: newUser.id,
          shiftRoleId: role.id,
        }));

        await UserShiftRole.bulkCreate(assignmentRows, { transaction });
      }
    });

    uploadedPhotoShouldCleanup = false;

    if (!createdUser) {
      res.status(500).json([{ message: 'Unable to create user.' }]);
      return;
    }

    res.status(201).json([createdUser]);
  } catch (error) {
    if (uploadedPhotoShouldCleanup && uploadedPhotoPath) {
      await deleteProfilePhoto(uploadedPhotoPath).catch(() => {});
    }

    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }

    if (error instanceof UniqueConstraintError) {
      const field = error.errors?.[0]?.path ?? null;
      if (field === 'email') {
        res.status(409).json([{ message: 'Email is already registered.' }]);
        return;
      }
      if (field === 'username') {
        res.status(409).json([{ message: 'Username is already taken.' }]);
        return;
      }
      res.status(409).json([{ message: 'User already exists with the provided data.' }]);
      return;
    }

    if (error instanceof ValidationError) {
      res.status(400).json([{ message: error.message }]);
      return;
    }

    logger.error(`[users] registerUser failed: ${(error as ErrorWithMessage).message}`);
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({
      where: {
        [Op.or]: [{ email }, { username: email }],
      },
    });

    if (!user) {
      res.status(404).json([{ message: 'Account not found. Double-check the username or email.' }]);
      return;
    }

    if (!user.status) {
      res.status(403).json([{ message: 'This account is inactive. Contact an administrator for access.' }]);
      return;
    }

    if (!user.approved || !user.userTypeId) {
      res.status(403).json([{ message: 'This account is waiting for approval. Contact an administrator for access.' }]);
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(400).json([{ message: 'Password is incorrect. Please try again.' }]);
      return;
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: oneWeekMs,
    });
    res.status(200).json([{ message: 'Logged in successfully', userId: user.id, token }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const logoutUser = async (req: Request, res: Response): Promise<void> => {
  try {
    res.cookie('token', '', {
      expires: new Date(0),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.status(200).json([{ message: 'Logged out successfully' }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format ?? req.query.view ?? '').toString().toLowerCase();
    const activeParam = typeof req.query.active === 'string' ? req.query.active.trim().toLowerCase() : undefined;
    const filterActive = activeParam === 'true';

    if (format === 'compact') {
      const typeFilter = typeof req.query.types === 'string' ? req.query.types : undefined;
      const typeSlugs = typeFilter
        ? typeFilter
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .flatMap((value) => NAME_TO_SLUG[value] ?? [value])
            .map((slug) => slug.trim().toLowerCase())
            .filter((slug) => slug.length > 0)
        : [];

      const normalizedSlugs = Array.from(
        new Set(
          typeSlugs.flatMap((slug) => {
            const lowered = slug.toLowerCase();
            const hyphenated = lowered.replace(/_/g, '-');
            const underscored = lowered.replace(/-/g, '_');
            return [lowered, hyphenated, underscored];
          }),
        ),
      );

      const userWhere: Record<string, unknown> = {};
      if (filterActive || normalizedSlugs.length > 0) {
        userWhere.status = true;
        userWhere.approved = true;
      }

      const users = await User.findAll({
        where: userWhere,
        include: [
          {
            model: UserType,
            as: 'role',
            required: normalizedSlugs.length > 0,
            where:
              normalizedSlugs.length > 0
                ? {
                    slug: {
                      [Op.in]: normalizedSlugs,
                    },
                  }
                : undefined,
          },
        ],
        order: [['firstName', 'ASC']],
      });

      const payload = users.map((user) => {
        const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        const role = (user as unknown as { role?: UserType }).role;
        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName,
          userTypeId: user.userTypeId,
          userTypeSlug: role?.slug ?? null,
          userTypeName: role?.name ?? null,
        };
      });

      res.status(200).json(payload);
      return;
    }

    const regularWhere: Record<string, unknown> = {};
    if (filterActive) {
      regularWhere.status = true;
      regularWhere.approved = true;
    }
    const regularWhereOptions = Object.keys(regularWhere).length > 0 ? { where: regularWhere } : {};
    const data = await User.findAll(regularWhereOptions);
    res.status(200).json([{ data, columns: buildUserColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getAllActiveUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await User.findAll({ where: { status: true, approved: true } });
    res.status(200).json([{ data, columns: buildUserColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await User.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildUserColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const request = req as AuthenticatedRequest;
    const { id } = req.params;
    const profilePhotoFile = req.file;
    const existingUser = await User.findByPk(id);

    if (!existingUser) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    const data: Record<string, unknown> = { ...req.body };
    const actorId = request.authContext?.id ?? null;
    const previousApproved = Boolean(existingUser.approved);
    const previousStatus = Boolean(existingUser.status);
    const previousUserTypeId = existingUser.userTypeId ?? null;

    [
      'approvedAt',
      'approvedBy',
      'approvalRevokedAt',
      'approvalRevokedBy',
      'deactivatedAt',
      'deactivatedBy',
      'reactivatedAt',
      'reactivatedBy',
      'approved_at',
      'approved_by',
      'approval_revoked_at',
      'approval_revoked_by',
      'deactivated_at',
      'deactivated_by',
      'reactivated_at',
      'reactivated_by',
    ].forEach((field) => {
      delete data[field];
    });

    if (typeof data.password === 'string' && data.password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(data.password, salt);
    } else {
      delete data.password;
    }

    const normalizeNullableValue = (value: unknown) => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return null;
        }
        if (trimmed.toLowerCase() === 'null') {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    const cleanupPreviousPhoto = async () => {
      if (existingUser.profilePhotoPath) {
        await deleteProfilePhoto(existingUser.profilePhotoPath).catch(() => {});
      }
    };

    if (profilePhotoFile) {
      let uploadResult: StoreProfilePhotoResult | null = null;
      try {
        uploadResult = await storeProfilePhoto({
          userId: existingUser.id,
          originalName: profilePhotoFile.originalname,
          mimeType: profilePhotoFile.mimetype,
          data: profilePhotoFile.buffer,
        });
      } catch (error) {
        logger.warn(`Failed to upload profile photo for user ${existingUser.id}: ${(error as Error).message}`);
      }

      if (uploadResult) {
        await cleanupPreviousPhoto();
        data.profilePhotoPath = uploadResult.relativePath;
        data.profilePhotoUrl = uploadResult.driveWebViewLink ?? null;
      }
    } else if (
      Object.prototype.hasOwnProperty.call(data, 'profilePhotoPath') ||
      Object.prototype.hasOwnProperty.call(data, 'profilePhotoUrl')
    ) {
      const normalizedPath = normalizeNullableValue(data.profilePhotoPath);
      const normalizedUrl = normalizeNullableValue(data.profilePhotoUrl);
      if (normalizedPath === null) {
        await cleanupPreviousPhoto();
      }
      data.profilePhotoPath = normalizedPath;
      data.profilePhotoUrl = normalizedUrl;
    }

    const now = new Date();
    const hasApprovedChange = Object.prototype.hasOwnProperty.call(data, 'approved');
    const nextApproved = hasApprovedChange ? normalizeBoolean(data.approved, previousApproved) : previousApproved;
    const hasStatusChange = Object.prototype.hasOwnProperty.call(data, 'status');
    const nextStatus = hasStatusChange ? normalizeBoolean(data.status, previousStatus) : previousStatus;
    const hasUserTypeChange = Object.prototype.hasOwnProperty.call(data, 'userTypeId');
    const nextUserTypeId = hasUserTypeChange && data.userTypeId != null ? Number(data.userTypeId) : previousUserTypeId;

    if (nextApproved && !nextUserTypeId) {
      res.status(400).json([{ message: 'A user type is required before approving the user.' }]);
      return;
    }

    if (hasApprovedChange) {
      data.approved = nextApproved;
      if (!previousApproved && nextApproved) {
        data.approvedAt = now;
        data.approvedBy = actorId;
      } else if (previousApproved && !nextApproved) {
        data.approvalRevokedAt = now;
        data.approvalRevokedBy = actorId;
      }
    }

    if (hasStatusChange) {
      data.status = nextStatus;
      if (previousStatus && !nextStatus) {
        data.deactivatedAt = now;
        data.deactivatedBy = actorId;
      } else if (!previousStatus && nextStatus) {
        data.reactivatedAt = now;
        data.reactivatedBy = actorId;
      }
    }

    await existingUser.update(data);

    const auditMeta = {
      previous: {
        approved: previousApproved,
        status: previousStatus,
        userTypeId: previousUserTypeId,
      },
      next: {
        approved: nextApproved,
        status: nextStatus,
        userTypeId: nextUserTypeId,
      },
    };

    if (hasApprovedChange && !previousApproved && nextApproved) {
      await recordUserAuditLog({
        actorId,
        action: 'user.approved',
        userId: existingUser.id,
        meta: auditMeta,
      });
      const approvedRole = nextUserTypeId
        ? await UserType.findByPk(nextUserTypeId, { attributes: ['slug', 'name'] })
        : null;
      await sendApprovedUserBadgeToPrint({
        user: existingUser,
        role: approvedRole,
        actorId,
      }).catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Unable to send badge to print';
        logger.error(`Failed to send approved user badge to print for user ${existingUser.id}: ${message}`);
        await recordUserAuditLog({
          actorId,
          action: 'user.badge_print_failed',
          userId: existingUser.id,
          meta: {
            trigger: 'approval',
            error: message,
          },
        }).catch(() => {});
      });
    } else if (hasApprovedChange && previousApproved && !nextApproved) {
      await recordUserAuditLog({
        actorId,
        action: 'user.approval_revoked',
        userId: existingUser.id,
        meta: auditMeta,
      });
    }

    if (hasStatusChange && previousStatus && !nextStatus) {
      await recordUserAuditLog({
        actorId,
        action: 'user.deactivated',
        userId: existingUser.id,
        meta: auditMeta,
      });
    } else if (hasStatusChange && !previousStatus && nextStatus) {
      await recordUserAuditLog({
        actorId,
        action: 'user.reactivated',
        userId: existingUser.id,
        meta: auditMeta,
      });
    }

    if (hasUserTypeChange && previousUserTypeId !== nextUserTypeId) {
      await recordUserAuditLog({
        actorId,
        action: 'user.role_changed',
        userId: existingUser.id,
        meta: auditMeta,
      });
    }

    res.status(200).json([existingUser]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const sendUserBadgeToPrint = async (req: Request, res: Response): Promise<void> => {
  try {
    const request = req as AuthenticatedRequest;
    const { id } = req.params;
    const userId = Number(id);
    const authenticatedUserId = request.authContext?.id ?? null;

    if (!authenticatedUserId) {
      res.status(401).json([{ message: 'Unauthorized' }]);
      return;
    }

    if (authenticatedUserId !== userId && !canManageOtherUserBadges(request)) {
      res.status(403).json([{ message: 'You are not allowed to send this badge to print.' }]);
      return;
    }

    const user = await User.findByPk(userId, {
      include: [
        {
          model: UserType,
          as: 'role',
          attributes: ['slug', 'name'],
        },
      ],
    });
    if (!user) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    const role = (user as unknown as { role?: UserType | null }).role ?? null;
    const badgeName = normalizeOptionalString(req.body.badgeName) ?? user.badgeName ?? null;
    const badgePrefixEmoji =
      normalizeOptionalString(req.body.badgePrefixEmoji) ?? user.badgePrefixEmoji ?? null;
    const badgeSuffixEmoji =
      normalizeOptionalString(req.body.badgeSuffixEmoji) ?? user.badgeSuffixEmoji ?? null;
    const campaignSourceName =
      normalizeOptionalString(req.body.campaignSourceName) ??
      buildBadgeCampaignSourceName(user.firstName, user.id);

    if (!badgeName) {
      res.status(400).json([{ message: 'Badge name is required before sending to print.' }]);
      return;
    }

    await sendBadgeToPrint({
      userDisplayName: buildDisplayName(user),
      badgeName,
      badgePrefixEmoji,
      badgeSuffixEmoji,
      campaignSourceName,
      templateVariant: resolveBadgeTemplateVariant({
        userTypeSlug: role?.slug ?? user.requestedUserType ?? null,
        userTypeName: role?.name ?? null,
      }),
    });
    await upsertBadgeAffiliateAssignment({
      userId: user.id,
      utmSource: campaignSourceName,
      actorId: authenticatedUserId,
    });

    res.status(200).json([{ message: 'Badge sent to print.' }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    logger.error(`Failed to send badge to print: ${errorMessage}`);
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await User.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const streamProfilePhoto = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user || !user.profilePhotoPath) {
      res.status(404).json([{ message: 'Profile photo not found' }]);
      return;
    }

    try {
      const { stream, mimeType } = await openProfilePhotoStream(user.profilePhotoPath);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json([{ message: 'Unable to read profile photo' }]);
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (error) {
      const message = (error as ErrorWithMessage).message;
      res.status(500).json([{ message }]);
    }
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};


