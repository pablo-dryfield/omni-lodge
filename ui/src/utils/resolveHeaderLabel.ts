export const resolveHeaderLabel = (header: unknown, fallback?: string) => {
  if (typeof header === "string" || typeof header === "number") {
    return String(header);
  }

  return fallback;
};