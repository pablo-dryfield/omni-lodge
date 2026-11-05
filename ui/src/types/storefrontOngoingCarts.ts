export type OngoingCart = {
  publicId: string;
  status: string;
  customer: { fullName: string; email: string; phoneCountry: string; phone: string };
  quote: { items: Array<{
    productId?: number;
    productName: string;
    quantity: number;
    experienceDate: string | null;
    experienceTime: string | null;
    addons: Array<{ name: string; quantity: number; value: string | null; variants: Array<{ value: string; quantity: number }> }>;
    options: Record<string, unknown>;
  }> };
  total: number;
  currency: string;
  lastActivityAt: string;
  recoveryDueAt: string;
  recoverySentAt: string | null;
  firstRecoverySentAt: string | null;
  lastRecoverySentAt: string | null;
  recoveryOpenedAt: string | null;
  recoveredAt: string | null;
  recoveryCount: number;
  identityReview?: string | null;
  createdAt: string;
  orderPublicId: string | null;
  events: Array<{ id: string; type: string; severity: 'info' | 'warning' | 'error'; message: string; details: Record<string, unknown> | null; occurredAt: string }>;
};

export type OngoingCartPage = {
  data: OngoingCart[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; checkoutStarted: number; recoverySent: number; recoveryOpened: number };
  filters: { products: Array<{ value: string; label: string }>; countries: string[]; currencies: string[] };
};
