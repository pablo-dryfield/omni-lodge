export type Action =
  | "view"
  | "connectTerminal"
  | "readFiles"
  | "writeFiles"
  | "deleteFiles"
  | "changePermissions"
  | "transfer"
  | "viewLogs"
  | "controlServices"
  | "runOperations"
  | "manageHosts"
  | "manageCredentials"
  | "viewActivity"
  | "viewRecordings"
  | "terminateOthers"
  | "rootFiles";
export type Root = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
  managed: boolean;
  privileged?: boolean;
};
export type Host = {
  id: string;
  name: string;
  environment: string;
  hostname: string;
  port: number;
  addresses: string[];
  fingerprints: string[];
  managed: boolean;
  rootFiles?: boolean;
  roots: Root[];
  services: string[];
  username: string;
};
export type Context = {
  actorId: number;
  name: string;
  actions: Action[];
  policyHash: string;
  expiresAt: string;
  stepUpUntil: string | null;
  hosts: Host[];
  limits: Record<string, unknown>;
};
export type Credential = {
  privateKey?: string;
  password?: string;
  passphrase?: string;
  revision?: string;
};
export type Connection = {
  connectionLimits?: { perActor: number; total: number };
  host: Host;
  username: string;
  credential: Credential;
  actorId: number;
  policyHash: string;
};
export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new Fault(status, code, message);
}
export function limit(
  ctx: Context,
  key: string,
  field: string,
  fallback: number,
): number {
  const value = (
    ctx.limits[`SYSTEM_MANAGEMENT_${key}`] as
      | Record<string, unknown>
      | undefined
  )?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}
