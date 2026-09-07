import type { RequiredActionItem } from "../../api/requiredActions";

const STORAGE_KEY = "omni-cleaning-review-deferred-v1";

export const cleaningReviewDeferralKey = (action: RequiredActionItem, userId: number): string | null => {
  if (action.type !== "cleaning_review" || action.source !== "required_action" || action.blocking) return null;
  return `${userId}:${action.id}:${action.payload.cleaningSubmission?.revision ?? 0}`;
};

export const readDeferredCleaningReviews = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch { return new Set(); }
};

export const saveDeferredCleaningReviews = (keys: Set<string>): void => {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(keys).slice(-300))); }
  catch { /* In-memory dismissal still works when session storage is unavailable. */ }
};
