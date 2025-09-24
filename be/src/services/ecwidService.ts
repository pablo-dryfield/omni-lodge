import axios from 'axios';

const ECWID_BASE_URL = process.env.ECWID_BASE_URL ?? 'https://app.ecwid.com/api/v3';
const STORE_ID = 100323031 //process.env.ECWID_STORE_ID; 
const API_TOKEN = 'secret_irQQxVweXvCFtrLyphyxncNJGE2zn25v' //process.env.ECWID_API_TOKEN;

if (!STORE_ID) {
  throw new Error('ECWID_STORE_ID is not configured');
}

if (!API_TOKEN) {
  throw new Error('ECWID_API_TOKEN is not configured');
}

type EcwidOrderResponse = {
  total: number;
  count: number;
  offset: number;
  limit: number;
  items: any[];
};

type FetchOrdersParams = {
  pickupFrom?: string;
  pickupTo?: string;
  createdFrom?: string;
  createdTo?: string;
  offset?: string;
  limit?: string;
  sortBy?: string;
};

const ecwidClient = axios.create({
  baseURL: `${ECWID_BASE_URL}/${STORE_ID}`,
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
  },
});

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

  const response = await ecwidClient.get<EcwidOrderResponse>(`/orders?${searchParams.toString()}`);
  return response.data;
};