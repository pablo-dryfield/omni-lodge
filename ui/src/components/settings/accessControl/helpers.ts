import dayjs from "dayjs";

export type StatusFilter = "all" | "active" | "inactive";

export const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Inactive only" },
] as const;

export const toNumber = (value: string | number | null | undefined, fallback = 0): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const includesSearch = (
  query: string,
  ...values: Array<string | number | null | undefined>
) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalized));
};

export const matchesStatus = (statusFilter: StatusFilter, isActive: boolean | null | undefined) => {
  if (statusFilter === "all") {
    return true;
  }
  return statusFilter === "active" ? Boolean(isActive) : !Boolean(isActive);
};

export const formatDate = (value: string | Date | null | undefined) => {
  if (!value) {
    return "n/a";
  }
  return dayjs(value).format("YYYY-MM-DD HH:mm");
};

