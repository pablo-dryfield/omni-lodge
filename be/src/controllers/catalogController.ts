import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import Addon from '../models/Addon.js';
import Channel from '../models/Channel.js';
import PaymentMethod from '../models/PaymentMethod.js';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';
import ShiftRole from '../models/ShiftRole.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import { toAddonConfig } from '../services/counterMetricUtils.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { listScheduledStaffForProduct } from '../services/scheduleService.js';

const LATE_BOOKING_CHANNELS = new Set(['Ecwid', 'Walk-In']);

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const getCounterSetupCatalog = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeScheduledStaff =
      normalizeOptionalString(req.query.includeScheduledStaff)?.toLowerCase() === 'true';
    const requestedDate = normalizeOptionalString(req.query.date);
    const requestedProductIdRaw = normalizeOptionalString(req.query.productId);
    const requestedProductName = normalizeOptionalString(req.query.productName);
    const requestedProductId = requestedProductIdRaw ? Number(requestedProductIdRaw) : null;
    const [
      users,
      products,
      channels,
      addons,
      shiftRoles,
      shiftRoleAssignments,
    ] = await Promise.all([
      User.findAll({
        where: { status: true },
        include: [{ model: UserType, as: 'role' }],
        order: [['firstName', 'ASC']],
      }),
      Product.findAll({
        where: { status: { [Op.ne]: false } },
        order: [['name', 'ASC']],
        include: [
          {
            model: ProductAddon,
            as: 'productAddons',
            include: [{ model: Addon, as: 'addon' }],
            required: false,
            separate: true,
            order: [['sortOrder', 'ASC']],
          },
        ],
      }),
      Channel.findAll({
        order: [['name', 'ASC']],
        include: [{ model: PaymentMethod, as: 'paymentMethod', attributes: ['id', 'name'] }],
      }),
      Addon.findAll({
        where: { isActive: true },
        order: [['name', 'ASC']],
      }),
      ShiftRole.findAll({ order: [['name', 'ASC']] }),
      User.findAll({
        where: { status: true },
        order: [
          ['firstName', 'ASC'],
          ['lastName', 'ASC'],
        ],
        attributes: ['id', 'firstName', 'lastName'],
        include: [
          { model: ShiftRole, as: 'shiftRoles', through: { attributes: [] } },
          { model: StaffProfile, as: 'staffProfile', attributes: ['livesInAccom', 'active'] },
        ],
      }),
    ]);

    const userPayload = users.map((user) => {
      const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      const role = (user as User & { role?: UserType }).role;
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

    const productPayload = products.map((product) => {
      const productAddons = (product as Product & { productAddons?: ProductAddon[] }).productAddons ?? [];
      const allowedAddOns = productAddons
        .filter((record) => {
          const addon = record.addon as { isActive?: boolean; name?: string } | undefined;
          return addon?.isActive !== false;
        })
        .map((record, index) => {
          const addon = record.addon as { isActive?: boolean; name?: string } | undefined;
          return {
            ...toAddonConfig({
              addonId: record.addonId,
              name: addon?.name ?? `Addon ${record.addonId}`,
              maxPerAttendee: record.maxPerAttendee ?? null,
              sortOrder: record.sortOrder ?? index,
            }),
            priceOverride: record.priceOverride ?? null,
          };
        });

      return {
        id: product.id,
        name: product.name,
        status: product.status,
        productTypeId: product.productTypeId,
        price: product.price,
        allowedAddOns,
      };
    });

    const channelPayload = channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      lateBookingAllowed: LATE_BOOKING_CHANNELS.has(channel.name),
      paymentMethodId: channel.paymentMethodId,
      paymentMethodName: channel.paymentMethod?.name ?? null,
    }));

    const addonPayload = addons.map((addon, index) => ({
      ...toAddonConfig({
        addonId: addon.id,
        name: addon.name,
        maxPerAttendee: null,
        sortOrder: index,
      }),
      basePrice: addon.basePrice != null ? Number(addon.basePrice) : null,
      taxRate: addon.taxRate != null ? Number(addon.taxRate) : null,
      isActive: addon.isActive,
    }));

    const assignmentPayload = shiftRoleAssignments.map((userRecord) => {
      const relatedRoles = (userRecord as User & { shiftRoles?: ShiftRole[] }).shiftRoles ?? [];
      const profile = (userRecord as User & { staffProfile?: StaffProfile }).staffProfile;
      const hasActiveProfile = Boolean(profile?.active);
      return {
        userId: userRecord.id,
        firstName: userRecord.firstName,
        lastName: userRecord.lastName,
        roleIds: relatedRoles.map((role) => role.id),
        livesInAccom: Boolean(profile?.livesInAccom),
        staffProfileActive: hasActiveProfile,
      };
    });

    let scheduledStaff: {
      date: string;
      productId: number;
      userIds: number[];
      managerIds: number[];
    } | null = null;

    if (includeScheduledStaff && requestedDate) {
      let resolvedProductId = Number.isFinite(requestedProductId ?? NaN) ? (requestedProductId as number) : null;
      if (!resolvedProductId && requestedProductName) {
        const normalizedName = requestedProductName.toLowerCase();
        const match = productPayload.find(
          (product) => (product.name ?? '').toLowerCase() === normalizedName,
        );
        resolvedProductId = match?.id ?? null;
      }
      if (!resolvedProductId && productPayload.length > 0) {
        resolvedProductId = productPayload[0]?.id ?? null;
      }
      if (resolvedProductId) {
        const staffPayload = await listScheduledStaffForProduct(requestedDate, resolvedProductId);
        scheduledStaff = {
          date: requestedDate,
          productId: resolvedProductId,
          userIds: staffPayload.userIds ?? [],
          managerIds: staffPayload.managerIds ?? [],
        };
      }
    }

    res.status(200).json({
      users: userPayload,
      products: productPayload,
      channels: channelPayload,
      addons: addonPayload,
      shiftRoles,
      shiftRoleAssignments: assignmentPayload,
      scheduledStaff,
    });
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};
