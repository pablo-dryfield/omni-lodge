import axios, { AxiosInstance } from 'axios';

const DEFAULT_BASE_URL = 'https://app.ecwid.com/api/v3';
const DEFAULT_STORE_ID = '100323031';
const DEFAULT_API_TOKEN = 'secret_irQQxVweXvCFtrLyphyxncNJGE2zn25v';

const resolveBaseUrl = () => (process.env.ECWID_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

const resolveCredentials = () => {
  const storeId = (process.env.ECWID_STORE_ID ?? DEFAULT_STORE_ID).trim();
  const apiToken = (process.env.ECWID_API_TOKEN ?? DEFAULT_API_TOKEN).trim();

  if (!storeId) {
    throw new Error('ECWID_STORE_ID is not configured');
  }

  if (!apiToken) {
    throw new Error('ECWID_API_TOKEN is not configured');
  }

  return { storeId, apiToken };
};

let client: AxiosInstance | null = null;

const getEcwidClient = (): AxiosInstance => {
  if (!client) {
    const { storeId, apiToken } = resolveCredentials();
    client = axios.create({
      baseURL: `${resolveBaseUrl()}/${storeId}`,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      timeout: 15000,
    });
  }

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
  selections?: EcwidOptionSelection[];
};

export type EcwidExtraField = {
  id?: string;
  name?: string;
  value?: string | number | null;
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

