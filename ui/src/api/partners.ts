import axios from '../utils/axiosInstance';

export type PartnerCommissionRule = { type: 'fixed' | 'percentage'; basis: 'person' | 'experience' | 'booking'; value: number };
export type PartnerCommissionCalculation = { version: 1; currency: 'PLN'; total: number; commission: number;
  groups: Array<{ productId: number | null; rule: PartnerCommissionRule; units: number; base: number; commission: number }> };
export type PartnerQuote = { total: number; items: Array<{ productName: string; total: number; quantity: number }>; partnerCommission?: PartnerCommissionCalculation };
export type PartnerAgreement = { productIds: number[]; commissionPercent: number; commissionRule?: PartnerCommissionRule | null; productCommissions?: Array<{ productId: number; rule: PartnerCommissionRule }>; paymentModes: string[]; creditLimit: number; connectSplit: boolean; allowCancellation: boolean; allowAmendment: boolean; allowRefunds: boolean; cancellationHours: number; allowedOrigins: string[] };
export type PartnerSummary = { id: number; name: string; channelId: number; status: string; role: string };
export type PartnerCatalogProduct = { id: number; name: string; price: { amount: number; currency: string }; config: { participantMode?: string; minParticipants?: number; maxParticipants?: number; startTimes?: string[]; defaultStartTime?: string; availability?: { fixedDate?: string }; content?: { meetingPoint?: { name?: string } } }; addons: Array<{ id: number; name: string; price: { amount: number } | null; config: { selectionMode?: string; options?: Array<{ value: string; label: string }> }; inventory: { variantSelectionRequired: boolean; variants: Array<{ value: string; label: string; inStock: boolean }> } }> };
export type PartnerOverview = { bookingsEnabled?: boolean; partner: PartnerSummary & { agreement: PartnerAgreement; version: number }; role: string; admin: boolean; catalog: PartnerCatalogProduct[]; salesUrl: string; connectEnabled: boolean; metrics: { confirmed: number; requests: number; awaitingPayment: number; confirmedValue: string }; members: Array<{ id: number; userId: number; role: string; active: boolean; user?: { firstName: string; lastName: string; username: string } }>; offerings: Array<{ id: number; code: string; kind: string; name: string; active: boolean; items: Array<{ productId: number; quantity: number; experienceTime?: string }> }> };
export type BookingLine = { productId: number; quantity: number; experienceDate: string; experienceTime: string; options?: Record<string, unknown>; addons?: Array<{ addonId: number; quantity: number; value?: string; variants?: Array<{ value: string; quantity: number }> }> };
export type PartnerBookingInput = { reference: string; customer: { firstName: string; lastName: string; email: string; phone?: string }; items: BookingLine[]; paymentMode: string; paymentReference?: string; requestApproval?: boolean; discountCode?: string; offeringCode?: string };
export type PartnerBookingRow = { commissionCalculation?: PartnerCommissionCalculation | null; paymentReceived?: boolean; commissionEarned?: number; currentTotal?: number; discountCode?: string | null; amendments?: Array<{ id: number; reference: string; status: string; difference: number; checkoutUrl: string | null; failureReason: string | null }>; id: number; reference: string; status: string; paymentMode: string; total: number; commission: number; refundedAmount: number; settledAmount: number; checkoutUrl: string | null; customer: PartnerBookingInput['customer']; items: BookingLine[]; createdAt: string; reconciliationError?: string; bookings: Array<{ id: number; status: string; productName: string; experienceDate: string; partySizeTotal: number }> };
export type PartnerStatement = { id: number; reference: string; status: string; currency: string; paymentMode: string; customerTotal: number; refunded: number; commission: number; transferred: number; partnerOwes: number; commissionOutstanding: number; partnerCredit: number; commissionOverpaid: number; manualSettlementAllowed: boolean; manualReturnAllowed?: boolean; reconciliationError: string | null };
export type PartnerIntegrations = { apiBase: string; sandbox: boolean; credentials: Array<{ id: number; label: string; scopes: string[]; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null }>; webhook: { url: string; active: boolean } | null; deliveries: Array<{ id: number; eventId: number; status: string; attempts: number; lastStatus: number | null }> };
export const partnerApi = {
  list: async () => (await axios.get<{ admin: boolean; partners: PartnerSummary[]; channels: Array<{ id: number; name: string }>; products: Array<{ id: number; name: string }>; defaultAgreement: PartnerAgreement }>('/partners')).data,
  get: async <T,>(id: number, path: string, params?: Record<string, unknown>): Promise<T> => (await axios.get<T>(`/partners/${id}/${path}`, { params })).data,
  post: async <T,>(id: number, path: string, body: unknown): Promise<T> => (await axios.post<T>(`/partners/${id}/${path}`, body)).data,
  put: async (id: number, path: string, body: unknown) => (await axios.put(`/partners/${id}/${path}`, body)).data,
  revoke: async (id: number, tokenId: number) => axios.delete(`/partners/${id}/credentials/${tokenId}`),
  create: async (body: unknown) => (await axios.post<{ id: number }>('/partners', body)).data,
};
export function partnerError(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string; error?: string } | Array<{ message?: string }> } }).response?.data;
  return (Array.isArray(data) ? data[0]?.message : data?.message || data?.error) || 'The request could not be completed. Please retry.';
}
export const paymentLabel = (mode: string) => ({ platform: 'Customer pays OmniLodge', partner: 'Customer paid partner', arrival: 'Pay at arrival' }[mode] || mode);
export const formatPartnerMoney = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'PLN' }).format(value);

export const partnerCommissionRule = (agreement: PartnerAgreement): PartnerCommissionRule => agreement.commissionRule ?? { type: 'percentage', basis: 'booking', value: agreement.commissionPercent };
export const partnerCommissionLabel = (agreement: PartnerAgreement): string => {
  const rule = partnerCommissionRule(agreement);
  const rate = rule.type === 'fixed' ? formatPartnerMoney(rule.value) : `${rule.value}%`;
  return `${rate} per ${{ person: 'guest place', experience: 'experience', booking: 'booking' }[rule.basis]}${agreement.productCommissions?.length ? ` + ${agreement.productCommissions.length} product rules` : ''}`;
};
