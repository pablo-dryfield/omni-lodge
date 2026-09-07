import type { RequiredActionItem } from "../../api/requiredActions";
import { cleaningReviewDeferralKey, readDeferredCleaningReviews, saveDeferredCleaningReviews } from "./cleaningReviewDeferral";

const action: RequiredActionItem = {
  id: "required_action:41", recordId: 41, source: "required_action", type: "cleaning_review", title: "Review cleaning", blocking: false,
  payload: { cleaningSubmission: { submissionId: 4, revision: 3 } },
};

describe("Nonblocking cleaning review deferral", () => {
  beforeEach(() => sessionStorage.clear());
  it("scopes dismissal to user, action, and current photo revision", () => {
    const key = cleaningReviewDeferralKey(action, 1)!;
    expect(key).not.toBe(cleaningReviewDeferralKey(action, 2));
    expect(key).not.toBe(cleaningReviewDeferralKey({ ...action, id: "required_action:42" }, 1));
    expect(key).not.toBe(cleaningReviewDeferralKey({ ...action, payload: { cleaningSubmission: { submissionId: 4, revision: 4 } } }, 1));
    saveDeferredCleaningReviews(new Set([key]));
    expect(readDeferredCleaningReviews().has(key)).toBe(true);
  });
  it.each(["staff_payout_receipt", "profile_fields", "policy_consent", "broadcast"] as const)("does not allow deferral of %s", (type) => {
    expect(cleaningReviewDeferralKey({ ...action, type }, 1)).toBeNull();
  });
  it("never defers blocking actions even if the action type is cleaning", () => {
    expect(cleaningReviewDeferralKey({ ...action, blocking: true }, 1)).toBeNull();
  });
  it("ignores corrupt session storage", () => {
    sessionStorage.setItem("omni-cleaning-review-deferred-v1", "not-json");
    expect(readDeferredCleaningReviews().size).toBe(0);
  });
});
