import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import axiosInstance from '../utils/axiosInstance';
import type {
  AddonConfig,
  CatalogProduct,
  StaffOption,
} from '../types/counters/CounterRegistry';
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

export const loadCatalog = createAsyncThunk<CatalogPayload, void, { rejectValue: string }>(
  'catalog/load',
  async (_, { rejectWithValue }) => {
    try {
      const [
        userResponse,
        productResponse,
        channelResponse,
        addonResponse,
      ] = await Promise.all([
        axiosInstance.get<CompactUserResponse[]>('/users', {
          params: {
            format: 'compact',
            types: 'manager,assistant-manager,pub-crawl-guide',
            active: 'true',
          },
          withCredentials: true,
        }),
        axiosInstance.get<CompactProductResponse[]>('/products', {
          params: { format: 'compact', active: 'true' },
          withCredentials: true,
        }),
        axiosInstance.get<CompactChannelResponse[]>('/channels', {
          params: { format: 'compact' },
          withCredentials: true,
        }),
        axiosInstance.get<AddonResponse[]>('/addons', {
          params: { active: 'true' },
          withCredentials: true,
        }),
      ]);

      const allUsers = userResponse.data.map(mapUserToStaffOption);
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

      const products: CatalogProduct[] = productResponse.data.map((product) => ({
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

      const channels: CatalogChannel[] = channelResponse.data.map((channel) => ({
        id: channel.id,
        name: channel.name,
        description: channel.description ?? null,
        lateBookingAllowed: Boolean(channel.lateBookingAllowed),
        paymentMethodId: channel.paymentMethodId,
        paymentMethodName: channel.paymentMethodName ?? null,
      }));

      const addons: AddonConfig[] = addonResponse.data.map((addon, index) => ({
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
