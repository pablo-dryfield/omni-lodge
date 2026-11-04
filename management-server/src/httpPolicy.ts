import { requireValue } from "./types.js";

const readOnly = new Set([
  "/management/session",
  "/management/sessions",
  "/management/files/list",
  "/management/files/inventory",
  "/management/files/resolve-link",
  "/management/files/content",
  "/management/download",
  "/management/jobs",
  "/management/activity",
  "/management/overview",
  "/management/services",
  "/management/logs",
  "/management/profiles",
  "/management/credential-metadata",
  "/management/job-details",
  "/management/download-folder",
  "/management/trash",
  "/management/recordings",
  "/management/recording",
  "/management/recording/download",
]);

export function requireRequestMethod(method: string | undefined, route: string) {
  requireValue(
    method === (readOnly.has(route) ? "GET" : route.endsWith("/chunks") ? "PUT" : "POST"),
    405,
    "METHOD_NOT_ALLOWED",
    "This operation does not support that HTTP method.",
  );
}
