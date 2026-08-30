import devConfig from "../config/devConfig";
import prodConfig from "../config/prodConfig";
import type { StaffPayoutReceiptPayload } from "./requiredActions";

const config = process.env.NODE_ENV === "production" ? prodConfig : devConfig;

const apiUrl = (path: string): string =>
  `${config.baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

export type ReceiptOnlyAccessGrant = {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  expiresInSeconds: number;
  receiptId: number;
  actionId: number;
};

export type ReceiptOnlyPayoutPayload = StaffPayoutReceiptPayload & {
  items?: Array<{
    id: number;
    label: string;
    amount: number;
    amountMinor: number;
  }>;
};

export type ReceiptOnlyAccessResponse = {
  actionId: number;
  receipt: ReceiptOnlyPayoutPayload;
};

export class StaffPayoutReceiptAccessError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffPayoutReceiptAccessError";
    this.status = status;
  }
}

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const getErrorMessage = (body: unknown, fallback: string): string => {
  if (Array.isArray(body)) {
    const first = body[0] as { message?: unknown } | undefined;
    if (typeof first?.message === "string" && first.message.trim()) {
      return first.message.trim();
    }
  }
  if (body && typeof body === "object") {
    const candidate = body as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message.trim();
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return candidate.error.trim();
    }
  }
  return fallback;
};

const requestReceiptAccess = async <T>(
  path: string,
  init: RequestInit,
  fallbackError: string,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      // This public flow must stay isolated from a normal OmniLodge login.
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new StaffPayoutReceiptAccessError(0, "Unable to reach OmniLodge. Check your connection and try again.");
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new StaffPayoutReceiptAccessError(
      response.status,
      getErrorMessage(body, fallbackError),
    );
  }
  return body as T;
};

export const exchangeStaffPayoutReceiptAccess = async (params: {
  receiptId: number;
  identity: string;
  password: string;
}): Promise<ReceiptOnlyAccessGrant> =>
  requestReceiptAccess<ReceiptOnlyAccessGrant>(
    "/required-actions/staff-payout-receipts/access",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    "Unable to verify your payout receipt access.",
  );

export const getStaffPayoutReceiptWithAccess = async (params: {
  receiptId: number;
  accessToken: string;
}): Promise<ReceiptOnlyAccessResponse> =>
  requestReceiptAccess<ReceiptOnlyAccessResponse>(
    `/required-actions/staff-payout-receipts/${params.receiptId}/access`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${params.accessToken}` },
    },
    "Unable to load this payout receipt.",
  );

export const confirmStaffPayoutReceiptWithAccess = async (params: {
  receiptId: number;
  accessToken: string;
  photo: File;
  signature: Record<string, unknown>;
  acknowledgedAmount: string;
  acknowledgedAt: string;
}): Promise<{ completed: boolean; receipt: ReceiptOnlyPayoutPayload }> => {
  const formData = new FormData();
  formData.append("photo", params.photo);
  formData.append("signature", JSON.stringify(params.signature));
  formData.append("acknowledgedAmount", params.acknowledgedAmount);
  formData.append("acknowledgedAt", params.acknowledgedAt);

  return requestReceiptAccess<{ completed: boolean; receipt: ReceiptOnlyPayoutPayload }>(
    `/required-actions/staff-payout-receipts/${params.receiptId}/access/confirm`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}` },
      body: formData,
    },
    "Unable to confirm this payout receipt.",
  );
};

export const isExpiredReceiptAccessError = (error: unknown): boolean =>
  error instanceof StaffPayoutReceiptAccessError && error.status === 401;

export const getReceiptAccessErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;
