export type Host = {
  id: string;
  name: string;
  environment: string;
  username: string;
  hostname: string;
  port: number;
  addresses: string[];
  fingerprints: string[];
  enabled: boolean;
  managed: boolean;
  rootFiles?: boolean;
  roots: {
    id: string;
    name: string;
    path: string;
    writable: boolean;
    managed: boolean;
    privileged?: boolean;
  }[];
  services: string[];
};
export type Session = {
  actorId: number;
  name: string;
  actions: string[];
  csrf: string;
  policyHash: string;
  hosts: Host[];
  stepUpUntil: string | null;
  expiresAt: string;
  limits: Record<string, unknown>;
};
let csrf = "";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/management${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Management-CSRF": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.code || "REQUEST_FAILED",
      result.message || "Request failed.",
    );
  return result;
}
export const query = (value: Record<string, string>) =>
  new URLSearchParams(value).toString();
export async function uploadChunk(
  id: string,
  offset: number,
  bytes: Uint8Array,
  sha256: string,
) {
  const response = await fetch(`/management/transfers/${id}/chunks`, {
    method: "PUT",
    headers: {
      "X-Management-CSRF": csrf,
      "X-Upload-Offset": String(offset),
      "X-Chunk-SHA256": sha256,
      "Content-Type": "application/octet-stream",
    },
    body: bytes as unknown as BodyInit,
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.code, result.message);
  return result;
}
