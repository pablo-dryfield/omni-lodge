import net from "node:net";
import type { ConfigDefinition } from "./appConfigRegistry.js";

export const SYSTEM_ACTIONS = [
  "view",
  "connectTerminal",
  "readFiles",
  "writeFiles",
  "deleteFiles",
  "changePermissions",
  "transfer",
  "viewLogs",
  "controlServices",
  "runOperations",
  "manageHosts",
  "manageCredentials",
  "viewActivity",
  "viewRecordings",
  "terminateOthers",
] as const;
export type SystemAction = (typeof SYSTEM_ACTIONS)[number];
export type SystemRoot = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
  managed: boolean;
};
export type SystemHost = {
  id: string;
  name: string;
  environment: "production" | "staging" | "development";
  hostname: string;
  port: number;
  addresses: string[];
  fingerprints: string[];
  enabled: boolean;
  managed: boolean;
  identities: Record<
    string,
    {
      username: string;
      credentialId: string;
      fileUsername?: string;
      fileCredentialId?: string;
    }
  >;
  roots: SystemRoot[];
  services: string[];
};
export const SYSTEM_DEFAULTS = {
  SESSION_POLICY: {
    stepUpSeconds: 600,
    idleSeconds: 900,
    absoluteSeconds: 7200,
    detachSeconds: 120,
    authoritySeconds: 15,
    remoteLeaseSeconds: 60,
  },
  TERMINAL_LIMITS: {
    perActor: 2,
    total: 4,
    scrollback: 10000,
    ringBytes: 2097152,
    inputBytes: 65536,
  },
  TRANSFER_LIMITS: {
    total: 2,
    perActor: 1,
    chunkBytes: 4194304,
    fileBytes: 10737418240,
    files: 10000,
    depth: 32,
  },
  FILE_POLICY: { editBytes: 2097152, inventoryEntries: 100000 },
  STORAGE_POLICY: {
    artifactBytes: 134217728,
    reserveBytes: 1073741824,
    reservePercent: 15,
    trashBytes: 268435456,
  },
  RETENTION: {
    activityDays: 90,
    transferDays: 30,
    tempHours: 24,
    trashDays: 7,
    recordingDays: 7,
  },
  JOURNAL_LIMITS: { jobs: 4000, events: 90000, bytes: 100663296 },
  RECORDING: { enabled: false, sessionBytes: 10485760, totalBytes: 67108864 },
  BROKER_BUDGET: { memoryMiB: 256, cpuPercent: 25, tasks: 64 },
  REMOTE_BUDGET: { memoryMiB: 256, cpuPercent: 25, tasks: 64 },
};
const json = (
  suffix: string,
  label: string,
  value: unknown,
  secret = false,
): ConfigDefinition => ({
  key: `SYSTEM_MANAGEMENT_${suffix}`,
  label,
  category: "System Management",
  valueType: "json",
  defaultValue: JSON.stringify(value),
  isSecret: secret,
  isRevealable: !secret,
  impact: "high",
  description:
    "SSH/SFTP administration policy. Changes invalidate affected sessions and reviews. Root-owned host policy is an additional ceiling. Secrets are encrypted; never include credentials in public profiles.",
  validation: {
    maxLength: secret ? 262144 : 131072,
    format: "system-management",
  },
});
export const SYSTEM_MANAGEMENT_CONFIG: ConfigDefinition[] = [
  {
    key: "SYSTEM_MANAGEMENT_ENABLED",
    label: "System Management enabled",
    category: "System Management",
    valueType: "boolean",
    defaultValue: false,
    impact: "high",
    description:
      "Admit administration sessions only after isolated-origin, broker, identity and resource checks pass. Disabling revokes active management authority.",
  },
  {
    key: "SYSTEM_MANAGEMENT_ORIGIN",
    label: "System Management browser origin",
    category: "System Management",
    valueType: "string",
    defaultValue: "https://system.omni-lodge.com",
    validation: { format: "system-management-origin", maxLength: 256 },
    impact: "high",
    description:
      "Dedicated isolated HTTPS origin. DNS/TLS and ingress must already be provisioned. Never point this at the main application origin.",
  },
  json("HOSTS", "SSH/SFTP server profiles", []),
  json("CREDENTIALS", "SSH credentials", {}, true),
  json("HOST_GRANTS", "Server access grants", []),
  ...Object.entries(SYSTEM_DEFAULTS).map(([key, value]) =>
    json(key, key.toLowerCase().replace(/_/g, " "), value),
  ),
];
const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
export function validateSystemManagementValue(key: string, raw: string): void {
  const value: unknown = JSON.parse(raw);
  if (key.endsWith("_HOSTS")) {
    if (!Array.isArray(value) || value.length > 20)
      throw new Error("At most 20 server profiles are supported.");
    const ids = new Set<string>();
    for (const h of value) {
      if (
        !record(h) ||
        typeof h.id !== "string" ||
        !id.test(h.id) ||
        ids.has(h.id)
      )
        throw new Error("Server IDs must be unique alphanumeric identifiers.");
      ids.add(h.id);
      if (
        Object.keys(h).some(
          (key) =>
            ![
              "id",
              "name",
              "environment",
              "hostname",
              "port",
              "addresses",
              "fingerprints",
              "enabled",
              "managed",
              "identities",
              "roots",
              "services",
            ].includes(key),
        )
      )
        throw new Error(
          "Server profiles must contain only public connection metadata; use encrypted credentials for secrets.",
        );
      if (
        typeof h.name !== "string" ||
        h.name.length < 1 ||
        h.name.length > 100 ||
        typeof h.hostname !== "string" ||
        !/^[a-zA-Z0-9.:-]{1,253}$/.test(h.hostname)
      )
        throw new Error("A valid server name and hostname are required.");
      if (
        !Number.isInteger(h.port) ||
        Number(h.port) < 1 ||
        Number(h.port) > 65535 ||
        !["production", "staging", "development"].includes(
          String(h.environment),
        ) ||
        typeof h.enabled !== "boolean" ||
        typeof h.managed !== "boolean"
      )
        throw new Error("Invalid server environment, port or flags.");
      if (
        !Array.isArray(h.addresses) ||
        !h.addresses.length ||
        h.addresses.length > 32 ||
        h.addresses.some((x) => typeof x !== "string" || net.isIP(x) === 0)
      )
        throw new Error("Explicit permitted IP addresses are required.");
      if (
        !Array.isArray(h.fingerprints) ||
        !h.fingerprints.length ||
        h.fingerprints.some(
          (x) => typeof x !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(x),
        )
      )
        throw new Error(
          "Independently verified SHA256 host-key fingerprints are required.",
        );
      if (!record(h.identities) || Object.keys(h.identities).length > 100)
        throw new Error(
          "Explicit administrator identity mappings are required.",
        );
      for (const [actor, identity] of Object.entries(h.identities)) {
        if (
          !/^[1-9][0-9]*$/.test(actor) ||
          !record(identity) ||
          Object.keys(identity).some(
            (key) =>
              ![
                "username",
                "credentialId",
                "fileUsername",
                "fileCredentialId",
              ].includes(key),
          ) ||
          typeof identity.username !== "string" ||
          !id.test(identity.username) ||
          ["root", "0"].includes(identity.username) ||
          typeof identity.credentialId !== "string" ||
          !id.test(identity.credentialId)
        )
          throw new Error("Invalid actor identity mapping.");
        for (const key of ["fileUsername", "fileCredentialId"])
          if (
            identity[key] !== undefined &&
            (typeof identity[key] !== "string" ||
              !id.test(identity[key] as string) ||
              (key === "fileUsername" &&
                ["root", "0"].includes(identity[key] as string)))
          )
            throw new Error("Invalid SFTP identity.");
      }
      if (
        !Array.isArray(h.roots) ||
        h.roots.length > 20 ||
        new Set(h.roots.map((r: Record<string, unknown>) => r.id)).size !==
          h.roots.length ||
        h.roots.some(
          (r) =>
            !record(r) ||
            Object.keys(r).some(
              (key) =>
                !["id", "name", "path", "writable", "managed"].includes(key),
            ) ||
            typeof r.id !== "string" ||
            !id.test(r.id) ||
            typeof r.name !== "string" ||
            typeof r.path !== "string" ||
            !r.path.startsWith("/") ||
            r.path === "/" ||
            (r.path.endsWith("/") && r.path.length > 1) ||
            r.path.includes("//") ||
            r.path
              .split("/")
              .some((x) => x === "." || x.startsWith(".omnilodge-")) ||
            r.path.includes("\0") ||
            r.path.split("/").includes("..") ||
            typeof r.writable !== "boolean" ||
            typeof r.managed !== "boolean",
        )
      )
        throw new Error("Invalid approved file root.");
      if (
        !Array.isArray(h.services) ||
        h.services.some((x) => typeof x !== "string" || !id.test(x))
      )
        throw new Error("Invalid service IDs.");
    }
  } else if (key.endsWith("_CREDENTIALS")) {
    if (!record(value) || Object.keys(value).length > 200)
      throw new Error("Credentials must be an ID-keyed object.");
    for (const [key, v] of Object.entries(value))
      if (
        !id.test(key) ||
        !record(v) ||
        Object.values(v).some((value) => typeof value !== "string") ||
        !["privateKey", "password"].some(
          (k) => typeof v[k] === "string" && (v[k] as string).length > 0,
        ) ||
        Object.keys(v).some(
          (k) =>
            !["privateKey", "password", "passphrase", "revision"].includes(k),
        )
      )
        throw new Error("Invalid encrypted credential entry.");
  } else if (key.endsWith("_HOST_GRANTS")) {
    if (
      !Array.isArray(value) ||
      value.length > 1000 ||
      value.some(
        (v) =>
          !record(v) ||
          !Number.isSafeInteger(v.actorId) ||
          Number(v.actorId) < 1 ||
          typeof v.hostId !== "string" ||
          !id.test(v.hostId) ||
          !Array.isArray(v.actions) ||
          v.actions.some((a) => !SYSTEM_ACTIONS.includes(a as SystemAction)),
      )
    )
      throw new Error("Grants require actorId, hostId and valid actions.");
  } else {
    const suffix = key.replace(
      "SYSTEM_MANAGEMENT_",
      "",
    ) as keyof typeof SYSTEM_DEFAULTS;
    const defaults = SYSTEM_DEFAULTS[suffix];
    if (
      !defaults ||
      !record(value) ||
      Object.keys(value).some((k) => !Object.hasOwn(defaults, k))
    )
      throw new Error("Invalid policy fields.");
    for (const [k, expected] of Object.entries(defaults)) {
      const v = value[k];
      if (
        typeof expected === "boolean"
          ? typeof v !== "boolean"
          : !Number.isSafeInteger(v) ||
            Number(v) < 1 ||
            Number(v) > Math.max(Number(expected) * 10, 100)
      )
        throw new Error(`Invalid ${k} limit.`);
    }
    if (
      suffix === "JOURNAL_LIMITS" &&
      (Number(value.jobs) > 4000 ||
        Number(value.events) > 90000 ||
        Number(value.bytes) > 100663296)
    )
      throw new Error(
        "Journal admission must leave room below the root-owned database quota for final outcomes.",
      );
    if (
      ["BROKER_BUDGET", "REMOTE_BUDGET"].includes(suffix) &&
      (Number(value.memoryMiB) < 64 ||
        Number(value.memoryMiB) > 256 ||
        Number(value.cpuPercent) > 25 ||
        Number(value.tasks) < 16 ||
        Number(value.tasks) > 64)
    )
      throw new Error(
        "Resource policy exceeds the provisioned host ceiling (64?256 MiB, 1?25% CPU, 16?64 tasks).",
      );
    if (
      suffix === "TRANSFER_LIMITS" &&
      (Number(value.total) > 2 ||
        Number(value.perActor) > 1 ||
        Number(value.chunkBytes) > 4194304 ||
        Number(value.files) > 10000 ||
        Number(value.depth) > 32)
    )
      throw new Error("Transfer batch limits exceed the protocol ceiling.");
    if (
      suffix === "STORAGE_POLICY" &&
      (Number(value.reserveBytes) < 1073741824 ||
        Number(value.reservePercent) < 15 ||
        Number(value.reservePercent) > 50 ||
        Number(value.trashBytes) > 268435456)
    )
      throw new Error(
        "Storage reserve must remain at least 1 GiB and 15%, and trash cannot exceed the provisioned 256 MiB ceiling.",
      );
    if (suffix === "RETENTION" && Number(value.trashDays) > 30)
      throw new Error("Trash retention cannot exceed 30 days.");
    if (
      suffix === "SESSION_POLICY" &&
      (Number(value.authoritySeconds) > 15 ||
        Number(value.absoluteSeconds) > 7200 ||
        Number(value.remoteLeaseSeconds) > 60 ||
        Number(value.remoteLeaseSeconds) < 30 ||
        Number(value.remoteLeaseSeconds) < 2 * Number(value.authoritySeconds))
    )
      throw new Error(
        "Session authority/lifetime exceeds the security ceiling.",
      );
  }
}

export function validateManagementOrigin(raw: string): void {
  const url = new URL(raw);
  if (
    url.origin !== raw ||
    url.protocol !== "https:" ||
    url.hostname !== "system.omni-lodge.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error(
      "Use the provisioned isolated origin https://system.omni-lodge.com. Changing ingress requires a reviewed host bootstrap update.",
    );
}
