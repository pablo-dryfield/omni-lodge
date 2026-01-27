import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import axiosInstance from '../utils/axiosInstance';
import type {
  AddonConfig,
  CatalogProduct,
  StaffOption,
} from '../types/counters/CounterRegistry';
import type { ShiftRole } from '../types/shiftRoles/ShiftRole';
import type { UserShiftRoleAssignment } from '../types/shiftRoles/UserShiftRoleAssignment';
import type { RootState } from './store';

type CatalogChannel = {
  id: number;
  name: string;
  description?: string | null;
  lateBookingAllowed: boolean;
  paymentMethodId?: number;
  paymentMethodName?: string | null;
};

type CatalogPayload = {
  managers: StaffOption[];
  staff: StaffOption[];
  users: StaffOption[];
  shiftRoles: ShiftRole[];
  shiftRoleAssignments: UserShiftRoleAssignment[];
  scheduledStaff: {
    date: string;
    productId: number;
    userIds: number[];
    managerIds: number[];
  } | null;
  products: CatalogProduct[];
  channels: CatalogChannel[];
  addons: AddonConfig[];
};

type CatalogState = CatalogPayload & {
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

const initialState: CatalogState = {
  loading: false,
  loaded: false,
  error: null,
  managers: [],
  staff: [],
  users: [],
  shiftRoles: [],
  shiftRoleAssignments: [],
  scheduledStaff: null,
  products: [],
  channels: [],
  addons: [],
};

type CompactUserResponse = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  userTypeId: number | null;
  userTypeSlug: string | null;
  userTypeName: string | null;
};

type CompactChannelResponse = {
  id: number;
  name: string;
  description?: string | null;
  lateBookingAllowed?: boolean;
  paymentMethodId?: number;
  paymentMethodName?: string | null;
};

type CompactProductResponse = {
  id: number;
  name: string;
  status: boolean;
  productTypeId: number;
  price: number;
  allowedAddOns: Array<
    AddonConfig & {
      priceOverride?: number | null;
    }
  >;
};

type AddonResponse = AddonConfig & {
  basePrice?: number | null;
  taxRate?: number | null;
  isActive?: boolean;
};

type CatalogBulkResponse = {
  users: CompactUserResponse[];
  products: CompactProductResponse[];
  channels: CompactChannelResponse[];
  addons: AddonResponse[];
  shiftRoles: ShiftRole[];
  shiftRoleAssignments: UserShiftRoleAssignment[];
  scheduledStaff?: {
    date: string;
    productId: number;
    userIds: number[];
    managerIds: number[];
  } | null;
};

const mapUserToStaffOption = (user: CompactUserResponse): StaffOption => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: user.fullName,
  userTypeSlug: user.userTypeSlug,
  userTypeName: user.userTypeName,
});

const uniqueById = <T extends { id: number }>(items: T[]): T[] => {
  const map = new Map<number, T>();
  items.forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
};

type CatalogLoadOptions = {
  date?: string;
  productId?: number;
  productName?: string;
  includeScheduledStaff?: boolean;
};

export const loadCatalog = createAsyncThunk<CatalogPayload, CatalogLoadOptions | void, { rejectValue: string }>(
  'catalog/load',
  async (options, { rejectWithValue }) => {
    try {
      const includeScheduledStaff = options?.includeScheduledStaff ?? false;
      const response = await axiosInstance.get<CatalogBulkResponse>('/catalog/counter-setup', {
        params: {
          ...(includeScheduledStaff && options?.date ? { includeScheduledStaff: true, date: options.date } : {}),
          ...(includeScheduledStaff && options?.productId ? { productId: options.productId } : {}),
          ...(includeScheduledStaff && options?.productName ? { productName: options.productName } : {}),
        },
        withCredentials: true,
      });
      const payload = response.data;

      const allUsers = payload.users.map(mapUserToStaffOption);
      const managers = uniqueById(
        allUsers.filter((user) => {
          const slug = user.userTypeSlug?.toLowerCase();
          return slug === 'manager' || slug === 'assistant-manager';
        }),
      );
      const staff = uniqueById(
        allUsers.filter((user) => {
          const slug = user.userTypeSlug?.toLowerCase();
          return slug === 'pub-crawl-guide' || slug === 'assistant-manager';
        }),
      );

      const products: CatalogProduct[] = payload.products.map((product) => ({
        id: product.id,
        name: product.name,
        status: product.status,
        productTypeId: product.productTypeId,
        price: product.price,
        allowedAddOns: product.allowedAddOns.map((addon) => ({
          addonId: addon.addonId,
          name: addon.name,
          key: addon.key,
          maxPerAttendee: addon.maxPerAttendee ?? null,
          sortOrder: addon.sortOrder,
          priceOverride: addon.priceOverride ?? null,
          basePrice: addon.basePrice ?? null,
        })),
      }));

      const channels: CatalogChannel[] = payload.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        description: channel.description ?? null,
        lateBookingAllowed: Boolean(channel.lateBookingAllowed),
        paymentMethodId: channel.paymentMethodId,
        paymentMethodName: channel.paymentMethodName ?? null,
      }));

      const addons: AddonConfig[] = payload.addons.map((addon, index) => ({
        addonId: addon.addonId,
        name: addon.name,
        key: addon.key,
        maxPerAttendee: addon.maxPerAttendee ?? null,
        sortOrder: addon.sortOrder ?? index,
        priceOverride: addon.priceOverride ?? null,
        basePrice: addon.basePrice ?? null,
      }));

      return {
        managers,
        staff,
        users: allUsers,
        shiftRoles: payload.shiftRoles ?? [],
        shiftRoleAssignments: payload.shiftRoleAssignments ?? [],
        scheduledStaff: payload.scheduledStaff ?? null,
        products,
        channels,
        addons,
      };
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to load catalog');
    }
  },
);

const catalogSlice = createSlice({
  name: 'catalog',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadCatalog.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadCatalog.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = null;
        state.managers = action.payload.managers;
        state.staff = action.payload.staff;
        state.users = action.payload.users;
        state.shiftRoles = action.payload.shiftRoles;
        state.shiftRoleAssignments = action.payload.shiftRoleAssignments;
        state.scheduledStaff = action.payload.scheduledStaff;
        state.products = action.payload.products;
        state.channels = action.payload.channels;
        state.addons = action.payload.addons;
      })
      .addCase(loadCatalog.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to load catalog';
      });
  },
});

export const selectCatalog = (state: RootState) => state.catalog;

export type { CatalogChannel };

export default catalogSlice.reducer;
