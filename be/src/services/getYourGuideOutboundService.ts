import axios, { AxiosError, AxiosInstance } from 'axios';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import HttpError from '../errors/HttpError.js';
import { getConfigValue } from './configService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export type GygOutboundMode = 'test' | 'prod';

export type GygTicketCategory =
  | 'ADULT'
  | 'CHILD'
  | 'YOUTH'
  | 'INFANT'
  | 'SENIOR'
  | 'STUDENT'
  | 'EU_CITIZEN'
  | 'MILITARY'
  | 'EU_CITIZEN_STUDENT'
  | 'GROUP';

export type GygAvailabilityItem = {
  dateTime: string;
  vacancies?: number;
  vacanciesByCategory?: Array<{ category: Exclude<GygTicketCategory, 'GROUP'>; vacancies: number }>;
  openingTimes?: Array<{ fromTime: string; toTime: string }>;
  currency?: string;
  pricesByCategory?: {
    retailPrices: Array<{ category: GygTicketCategory; price: number }>;
  };
  tieredPricesByCategory?: {
    retailPrices: Array<{
      category: GygTicketCategory;
      tiers: Array<{ lowerBound: number; upperBound?: number | null; price: number }>;
    }>;
  };
};

export type GygNotifyAvailabilityUpdateRequest = {
  data: {
    productId: string;
    availabilities: GygAvailabilityItem[];
  };
};

export type GygCreateDealRequest = {
  data: {
    externalProductId: string;
    dealName: string;
    dateRange: {
      start: string;
      end: string;
    };
    dealType: 'standard' | 'early_bird' | 'last_minute';
    maxVacancies?: number;
    discountPercentage: number;
    noticePeriodDays?: number;
  };
};

export type GygCreateDealResponse = {
  deals: Array<{
    dealId: number;
    gygTourOptionId: number;
  }>;
};

export type GygGetDealsResponse = {
  deals: Array<{
    dealId: number;
    dealName: string;
    dateRange: {
      start: string;
      end: string;
    };
    dealType: 'standard' | 'early_bird' | 'last_minute';
    maxVacancies?: number | null;
    discountPercentage: number;
    gygTourOptionId: number;
  }>;
};

export type GygCreateSupplierRequest = {
  data: {
    externalSupplierId: string;
    firstName: string;
    lastName: string;
    legalCompanyName: string;
    websiteUrl: string;
    country: string;
    currency: string;
    email: string;
    legalStatus: 'individual' | 'company';
    mobileNumber?: string;
    city?: string;
    postalCode?: string;
    stateOrRegion?: string;
  };
};

export type GygReactivateProductRequest = {
  data: {
    externalProductId: string;
  };
};

export type GygRedemptionTicketCodeRequest = {
  data: {
    ticketCode: string;
    gygBookingReference: string;
  };
};

export type GygRedemptionBookingReferenceRequest = {
  data: {
    gygBookingReference: string;
  };
};

export type GygRedemptionSuccessResponse = {
  success: boolean;
};

type GygClientSignature = string;

type GygRequestConfig = {
  params?: Record<string, string | number | boolean | null | undefined>;
};

type GygSelfTestStepResult = {
  name: string;
  ok: boolean;
  statusCode: number | null;
  responseBody: unknown;
  errorMessage: string | null;
};

export type GygOutboundSelfTestSummary = {
  mode: GygOutboundMode;
  steps: GygSelfTestStepResult[];
  success: boolean;
};

const DEFAULT_BASE_URLS: Record<GygOutboundMode, string> = {
  test: 'https://supplier-api.getyourguide.com/sandbox/1',
  prod: 'https://supplier-api.getyourguide.com/1',
};

const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_TEST_PRODUCT_ID = 'prod123';
const DEFAULT_TEST_EXTERNAL_PRODUCT_ID = 'PPYM1U';
const DEFAULT_TEST_SUPPLIER_ID = '12345XYZ';
const DEFAULT_TEST_EXTERNAL_OPTION_ID = 3764930;

const clientCache = new Map<GygClientSignature, AxiosInstance>();

const readConfigString = (key: string): string | null => {
  const value = getConfigValue(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const resolveBaseUrl = (mode: GygOutboundMode): string => {
  const configured =
    mode === 'test'
      ? readConfigString('GYG_SUPPLIER_API_BASE_URL_TEST')
      : readConfigString('GYG_SUPPLIER_API_BASE_URL_PROD');
  return (configured ?? DEFAULT_BASE_URLS[mode]).replace(/\/+$/, '');
};

const resolveCredentials = (mode: GygOutboundMode): { username: string; password: string } => {
  const username =
    mode === 'test'
      ? readConfigString('GYG_OUTBOUND_SUPPLIER_API_USERNAME_TEST') ??
        readConfigString('GYG_TEST_SUPPLIER_API_USERNAME')
      : readConfigString('GYG_OUTBOUND_SUPPLIER_API_USERNAME_PROD') ??
        readConfigString('GYG_PROD_SUPPLIER_API_USERNAME');
  const password =
    mode === 'test'
      ? readConfigString('GYG_OUTBOUND_SUPPLIER_API_PASSWORD_TEST') ??
        readConfigString('GYG_TEST_SUPPLIER_API_PASSWORD')
      : readConfigString('GYG_OUTBOUND_SUPPLIER_API_PASSWORD_PROD') ??
        readConfigString('GYG_PROD_SUPPLIER_API_PASSWORD');

  if (!username) {
    throw new HttpError(400, `Outbound GetYourGuide ${mode} username is not configured`);
  }
  if (!password) {
    throw new HttpError(400, `Outbound GetYourGuide ${mode} password is not configured`);
  }

  return { username, password };
};

const getClient = (mode: GygOutboundMode): AxiosInstance => {
  const baseUrl = resolveBaseUrl(mode);
  const { username, password } = resolveCredentials(mode);
  const signature = JSON.stringify({ mode, baseUrl, username, password });

  const existing = clientCache.get(signature);
  if (existing) {
    return existing;
  }

  const client = axios.create({
    baseURL: baseUrl,
    auth: { username, password },
    timeout: 15000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  clientCache.set(signature, client);
  return client;
};

const normalizePayload = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as T;

const buildDateTime = (dayOffset: number, time: string, timezoneName = DEFAULT_TIMEZONE): string => {
  const targetDate = dayjs().tz(timezoneName).add(dayOffset, 'day').format('YYYY-MM-DD');
  const parsed = dayjs.tz(`${targetDate} ${time}`, 'YYYY-MM-DD HH:mm', timezoneName);
  return parsed.format('YYYY-MM-DDTHH:mm:ssZ');
};

const buildAvailabilityItems = (): GygAvailabilityItem[] => {
  const dateOne = buildDateTime(1, '10:00');
  const dateTwo = buildDateTime(1, '15:00');

  return [
    {
      dateTime: dateOne,
      vacancies: 0,
    },
    {
      dateTime: dateTwo,
      vacancies: 1,
    },
  ];
};

const buildAvailabilityPayload = (
  productId: string,
  variant: 'basic' | 'with-price' | 'with-category',
): GygNotifyAvailabilityUpdateRequest => {
  const availabilities = buildAvailabilityItems();

  if (variant === 'with-price') {
    return {
      data: {
        productId,
        availabilities: availabilities.map((availability) =>
          normalizePayload({
            ...availability,
            currency: DEFAULT_CURRENCY,
            pricesByCategory: {
              retailPrices: [
                { category: 'ADULT', price: 1500 },
                { category: 'CHILD', price: 1000 },
              ],
            },
          }),
        ),
      },
    };
  }

  if (variant === 'with-category') {
    return {
      data: {
        productId,
        availabilities: availabilities.map((availability) =>
          normalizePayload({
            ...availability,
            currency: DEFAULT_CURRENCY,
            vacanciesByCategory: [
              { category: 'ADULT', vacancies: availability.vacancies ?? 0 },
              { category: 'CHILD', vacancies: availability.vacancies ?? 0 },
            ],
          }),
        ),
      },
    };
  }

  return {
    data: {
      productId,
      availabilities,
    },
  };
};

const buildDealRequest = (externalProductId: string): GygCreateDealRequest => {
  const startDate = dayjs().tz(DEFAULT_TIMEZONE).add(3, 'day').format('YYYY-MM-DD');
  const endDate = dayjs().tz(DEFAULT_TIMEZONE).add(10, 'day').format('YYYY-MM-DD');

  return {
    data: {
      externalProductId,
      dealName: 'Last minute deal',
      dateRange: {
        start: startDate,
        end: endDate,
      },
      dealType: 'last_minute',
      maxVacancies: 10,
      discountPercentage: 10.5,
      noticePeriodDays: 3,
    },
  };
};

const buildSupplierRequest = (externalSupplierId: string): GygCreateSupplierRequest => ({
  data: {
    externalSupplierId,
    firstName: 'John',
    lastName: 'Doe',
    legalCompanyName: 'Omni Lodge',
    websiteUrl: 'https://omni-lodge.com',
    country: 'POL',
    currency: 'PLN',
    email: 'contact@omni-lodge.com',
    legalStatus: 'company',
    mobileNumber: '+48123123123',
    city: 'PL WAW',
    postalCode: '00-001',
    stateOrRegion: 'Mazowieckie',
  },
});

const buildReactivateProductRequest = (externalProductId: string): GygReactivateProductRequest => ({
  data: { externalProductId },
});

const buildRedemptionTicketCodeRequest = (gygBookingReference: string): GygRedemptionTicketCodeRequest => ({
  data: {
    ticketCode: 'TICKET238',
    gygBookingReference,
  },
});

const buildRedemptionBookingReferenceRequest = (gygBookingReference: string): GygRedemptionBookingReferenceRequest => ({
  data: {
    gygBookingReference,
  },
});

const handleAxiosError = (error: unknown, operation: string): never => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<Record<string, unknown>>;
    throw new HttpError(
      axiosError.response?.status ?? 502,
      `${operation} failed`,
      {
        statusCode: axiosError.response?.status ?? null,
        responseBody: axiosError.response?.data ?? null,
        responseHeaders: axiosError.response?.headers ?? null,
        requestUrl: axiosError.config?.url ?? null,
      },
    );
  }

  if (error instanceof Error) {
    throw new HttpError(502, `${operation} failed`, { cause: error.message });
  }

  throw new HttpError(502, `${operation} failed`, { cause: String(error) });
};

const requestJson = async <TResponse>(
  mode: GygOutboundMode,
  operation: string,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  config: GygRequestConfig = {},
  data?: unknown,
): Promise<{ statusCode: number; body: TResponse | null }> => {
  try {
    const response = await getClient(mode).request<TResponse>({
      method,
      url: path,
      params: config.params,
      data,
    });

    return {
      statusCode: response.status,
      body: (response.data ?? null) as TResponse | null,
    };
  } catch (error) {
    return handleAxiosError(error, operation);
  }
};

export const notifyAvailabilityUpdate = async (
  payload: GygNotifyAvailabilityUpdateRequest,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: { data?: { message?: string } } | null }> => {
  return requestJson(mode, 'Notify availability update', 'post', '/notify-availability-update', {}, payload);
};

export const createDeal = async (
  payload: GygCreateDealRequest,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: GygCreateDealResponse | null }> => {
  return requestJson(mode, 'Create deal', 'post', '/deals', {}, payload);
};

export const listDeals = async (
  externalProductId: string,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: GygGetDealsResponse | null }> => {
  return requestJson(mode, 'List deals', 'get', '/deals', { params: { externalProductId } });
};

export const deleteDeal = async (
  dealId: number,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: null }> => {
  return requestJson(mode, 'Delete deal', 'delete', `/deals/${dealId}`);
};

export const registerSupplier = async (
  payload: GygCreateSupplierRequest,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: { data?: { message?: string } } | null }> => {
  return requestJson(mode, 'Register supplier', 'post', '/suppliers', {}, payload);
};

export const reactivateProduct = async (
  externalProductId: string,
  gygOptionId: number,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: { data?: { message?: string } } | null }> => {
  return requestJson(
    mode,
    'Reactivate product',
    'patch',
    `/products/${gygOptionId}/activate`,
    {},
    buildReactivateProductRequest(externalProductId),
  );
};

export const redeemTicketCode = async (
  gygBookingReference: string,
  ticketCode: string,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: GygRedemptionSuccessResponse | null }> => {
  return requestJson(
    mode,
    'Redeem ticket code',
    'post',
    '/redeem-ticket',
    {},
    {
      data: {
        ticketCode,
        gygBookingReference,
      },
    } satisfies GygRedemptionTicketCodeRequest,
  );
};

export const redeemBookingReference = async (
  gygBookingReference: string,
  mode: GygOutboundMode = 'test',
): Promise<{ statusCode: number; body: GygRedemptionSuccessResponse | null }> => {
  return requestJson(
    mode,
    'Redeem booking reference',
    'post',
    '/redeem-booking',
    {},
    buildRedemptionBookingReferenceRequest(gygBookingReference),
  );
};

export type GygOutboundSelfTestOptions = {
  mode?: GygOutboundMode;
  productId?: string;
  externalProductId?: string;
  supplierExternalId?: string;
  gygOptionId?: number;
  gygBookingReference?: string;
  ticketCode?: string;
  includeAdditionalEndpoints?: boolean;
};

export const runGetYourGuideOutboundSelfTest = async (
  options: GygOutboundSelfTestOptions = {},
): Promise<GygOutboundSelfTestSummary> => {
  const mode = options.mode ?? 'test';
  const productId = options.productId ?? DEFAULT_TEST_PRODUCT_ID;
  const externalProductId = options.externalProductId ?? DEFAULT_TEST_EXTERNAL_PRODUCT_ID;
  const supplierExternalId = options.supplierExternalId ?? DEFAULT_TEST_SUPPLIER_ID;
  const gygOptionId = options.gygOptionId ?? DEFAULT_TEST_EXTERNAL_OPTION_ID;
  const gygBookingReference = options.gygBookingReference ?? `GYG${Date.now().toString(36).toUpperCase()}`;
  const ticketCode = options.ticketCode ?? 'TICKET238';
  const includeAdditionalEndpoints = options.includeAdditionalEndpoints ?? false;

  const steps: GygSelfTestStepResult[] = [];

  const runStep = async <TResponse>(
    name: string,
    action: () => Promise<{ statusCode: number; body: TResponse | null }>,
    expectedStatusCodes: number[],
  ): Promise<void> => {
    try {
      const response = await action();
      steps.push({
        name,
        ok: expectedStatusCodes.includes(response.statusCode),
        statusCode: response.statusCode,
        responseBody: response.body,
        errorMessage: expectedStatusCodes.includes(response.statusCode)
          ? null
          : `Unexpected status code ${response.statusCode}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        name,
        ok: false,
        statusCode: error instanceof HttpError && typeof error.status === 'number' ? error.status : null,
        responseBody: error instanceof HttpError ? error.details ?? null : null,
        errorMessage: message,
      });
    }
  };

  await runStep('Notify availability update: basic', () => notifyAvailabilityUpdate(buildAvailabilityPayload(productId, 'basic'), mode), [202]);
  await runStep('Notify availability update: with price', () => notifyAvailabilityUpdate(buildAvailabilityPayload(productId, 'with-price'), mode), [202]);
  await runStep(
    'Notify availability update: with ticket categories',
    () => notifyAvailabilityUpdate(buildAvailabilityPayload(productId, 'with-category'), mode),
    [202],
  );

  let createdDealId: number | null = null;
  await runStep('Create deal', async () => {
    const response = await createDeal(buildDealRequest(externalProductId), mode);
    createdDealId = response.body?.deals?.[0]?.dealId ?? null;
    return response;
  }, [201]);

  await runStep('List deals', () => listDeals(externalProductId, mode), [200]);

  if (createdDealId !== null) {
    await runStep('Delete deal', () => deleteDeal(createdDealId as number, mode), [204]);
  } else {
    steps.push({
      name: 'Delete deal',
      ok: false,
      statusCode: null,
      responseBody: null,
      errorMessage: 'Skipped because no dealId was returned by create deal',
    });
  }

  await runStep('Register supplier', () => registerSupplier(buildSupplierRequest(supplierExternalId), mode), [202]);

  if (includeAdditionalEndpoints) {
    await runStep(
      'Reactivate product',
      () => reactivateProduct(externalProductId, gygOptionId, mode),
      [200],
    );

    await runStep(
      'Redeem ticket code',
      () => redeemTicketCode(gygBookingReference, ticketCode, mode),
      [200],
    );

    await runStep(
      'Redeem booking reference',
      () => redeemBookingReference(gygBookingReference, mode),
      [200],
    );
  }

  return {
    mode,
    steps,
    success: steps.every((step) => step.ok),
  };
};

export const getGetYourGuideOutboundDefaults = (): {
  productId: string;
  externalProductId: string;
  supplierExternalId: string;
} => ({
  productId: DEFAULT_TEST_PRODUCT_ID,
  externalProductId: DEFAULT_TEST_EXTERNAL_PRODUCT_ID,
  supplierExternalId: DEFAULT_TEST_SUPPLIER_ID,
});
