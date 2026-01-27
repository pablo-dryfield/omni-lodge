import axios, { AxiosInstance } from 'axios';
import { getConfigValue } from './configService.js';

const DEFAULT_BASE_URL = 'https://app.ecwid.com/api/v3';
const DEFAULT_STORE_ID = '100323031';
const DEFAULT_API_TOKEN = 'secret_irQQxVweXvCFtrLyphyxncNJGE2zn25v';

const resolveBaseUrl = () =>
  ((getConfigValue('ECWID_BASE_URL') as string | null) ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

const resolveCredentials = () => {
  const storeId = ((getConfigValue('ECWID_STORE_ID') as string | null) ?? DEFAULT_STORE_ID).trim();
  const apiToken = ((getConfigValue('ECWID_API_TOKEN') as string | null) ?? DEFAULT_API_TOKEN).trim();

  if (!storeId) {
    throw new Error('ECWID_STORE_ID is not configured');
  }

  if (!apiToken) {
    throw new Error('ECWID_API_TOKEN is not configured');
  }

  return { storeId, apiToken };
};

let client: AxiosInstance | null = null;
let clientSignature: string | null = null;

const getEcwidClient = (): AxiosInstance => {
  const { storeId, apiToken } = resolveCredentials();
  const signature = JSON.stringify({ storeId, apiToken, baseUrl: resolveBaseUrl() });

  if (client && clientSignature === signature) {
    return client;
  }

  client = axios.create({
    baseURL: `${resolveBaseUrl()}/${storeId}`,
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    timeout: 15000,
  });
  clientSignature = signature;

  return client;
};

export type EcwidOrderResponse = {
  total: number;
  count: number;
  offset: number;
  limit: number;
  items: EcwidOrder[];
};

export type EcwidOptionSelection = {
  name?: string;
  value?: string | number | null;
  selectionTitle?: string;
};

export type EcwidOption = {
  name?: string;
  value?: string | number | null;
  selectionTitle?: string;
  selections?: EcwidOptionSelection[];
};

export type EcwidExtraField = {
  id?: string;
  name?: string;
  value?: string | number | null;
  customerInputType?: string;
  title?: string;
  orderDetailsDisplaySection?: string;
  orderBy?: string | number;
};

export type EcwidOrderItem = {
  id?: string | number;
  productId?: string | number;
  sku?: string;
  name?: string;
  quantity?: number;
  options?: EcwidOption[];
  selectedOptions?: EcwidOption[];
  pickupTime?: string;
};

export type EcwidPerson = {
  name?: string;
  phone?: string;
};

export type EcwidOrder = {
  id: string | number;
  externalTransactionId?: string | number;
  items: EcwidOrderItem[];
  createDate?: string;
  pickupTime?: string;
  orderExtraFields?: EcwidExtraField[];
  extraFields?: Record<string, string>;
  shippingPerson?: EcwidPerson;
  billingPerson?: EcwidPerson;
};

export type FetchOrdersParams = {
  pickupFrom?: string;
  pickupTo?: string;
  createdFrom?: string;
  createdTo?: string;
  offset?: string;
  limit?: string;
  sortBy?: string;
};

export const resetEcwidClient = (): void => {
  client = null;
};

export const fetchEcwidOrders = async (params: FetchOrdersParams = {}): Promise<EcwidOrderResponse> => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.append(key, value);
    }
  });

  if (!searchParams.has('limit')) {
    searchParams.append('limit', '200');
  }

  if (!searchParams.has('sortBy')) {
    searchParams.append('sortBy', 'pickupTime:asc');
  }

  const query = searchParams.toString();
  const ecwidClient = getEcwidClient();
  const response = await ecwidClient.get<EcwidOrderResponse>(`/orders${query ? `?${query}` : ''}`);
  return response.data;
};

export const getEcwidOrder = async (orderId: string | number): Promise<EcwidOrder> => {
  const trimmedId = String(orderId ?? '').trim();
  if (!trimmedId) {
    throw new Error('Order ID is required');
  }

  const ecwidClient = getEcwidClient();
  const response = await ecwidClient.get<EcwidOrder>(`/orders/${encodeURIComponent(trimmedId)}`);
  return response.data;
};

export type UpdateEcwidOrderPayload = {
  pickupTime?: string;
  orderExtraFields?: EcwidExtraField[];
  [key: string]: unknown;
};

export const updateEcwidOrder = async (
  orderId: string | number,
  payload: UpdateEcwidOrderPayload,
): Promise<unknown> => {
  const trimmedId = String(orderId ?? '').trim();
  if (!trimmedId) {
    throw new Error('Order ID is required to update Ecwid');
  }

  if (!payload || Object.keys(payload).length === 0) {
    throw new Error('No update payload provided for Ecwid order');
  }

  const ecwidClient = getEcwidClient();
  const response = await ecwidClient.put(`/orders/${encodeURIComponent(trimmedId)}`, payload);
  return response.data;
};
