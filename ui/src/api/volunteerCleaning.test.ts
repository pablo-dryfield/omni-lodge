import axiosInstance from "../utils/axiosInstance";
import { cleaningKeys, fetchCleaningPhoto, fetchCleaningSubmission, fetchMyCleaningSubmissions, getCleaningError, isTransientCleaningQueryError, reviewCleaningPhoto, uploadCleaningPhoto, waiveCanceledCleaningTask } from "./volunteerCleaning";

jest.mock("../utils/axiosInstance", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
const get = axiosInstance.get as jest.Mock;
const post = axiosInstance.post as jest.Mock;
const patch = axiosInstance.patch as jest.Mock;

describe("Cleaning API", () => {
  beforeEach(() => jest.clearAllMocks());
  it("loads own submissions and the review queue with one request", async () => {
    const payload = { submissions: [{ id: 1 }], reviewSubmissions: [{ id: 2 }], taskIssues: [{ taskLogId: 3, code: "no_active_cleaners", canWaive: true }] };
    get.mockResolvedValue({ data: payload });
    expect(await fetchMyCleaningSubmissions()).toEqual(payload);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/cleaningSubmissions/me");
  });
  it("reads detail and downloads the authenticated photo endpoint", async () => {
    get.mockResolvedValueOnce({ data: { submission: { id: 2 } } });
    expect(await fetchCleaningSubmission(2)).toEqual({ id: 2 });
    const blob = new Blob(["photo"], { type: "image/jpeg" });
    const signal = new AbortController().signal;
    get.mockResolvedValueOnce({ data: blob });
    expect(await fetchCleaningPhoto(2, 9, signal)).toBe(blob);
    expect(get).toHaveBeenLastCalledWith("/cleaningSubmissions/2/photos/9", { responseType: "blob", signal });
  });
  it("sends revision and file as multipart without overriding the browser boundary", async () => {
    post.mockResolvedValue({ data: { submission: { id: 2 } } });
    const file = new File(["photo"], "clean.jpg", { type: "image/jpeg" });
    await uploadCleaningPhoto({ submissionId: 2, slotKey: "bathroom/floor", expectedRevision: 4, file });
    const [url, form, options] = post.mock.calls[0];
    expect(url).toBe("/cleaningSubmissions/2/slots/bathroom%2Ffloor/photos");
    expect(form.get("file")).toBe(file);
    expect(form.get("expectedRevision")).toBe("4");
    expect(options).toBeUndefined();
  });
  it("uses the review workflow with separate rejection and escalation reasons", async () => {
    patch.mockResolvedValue({ data: {} });
    await reviewCleaningPhoto({ submissionId: 2, photoId: 3, expectedRevision: 5, decision: "rejected", reason: "Show the sink", escalationReason: "No scheduled reviewer" });
    expect(patch).toHaveBeenCalledWith("/cleaningSubmissions/2/photos/3/review", { expectedRevision: 5, decision: "rejected", reason: "Show the sink", escalationReason: "No scheduled reviewer" });
  });
  it("retains specific validation and conflict messages", () => {
    expect(getCleaningError({ response: { data: [{ message: "Reload the latest revision" }] } })).toBe("Reload the latest revision");
    expect(getCleaningError({ response: { data: { error: "Access denied" } } })).toBe("Access denied");
    expect(getCleaningError(new Error("network"), "Try again")).toBe("Try again");
  });
  it("distinguishes recoverable refresh failures from authoritative resource and access errors", () => {
    expect(isTransientCleaningQueryError(null)).toBe(false);
    expect(isTransientCleaningQueryError(new Error("Network error"))).toBe(true);
    for (const status of [0, 408, 429, 500, 502, 503]) {
      expect(isTransientCleaningQueryError({ response: { status } })).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isTransientCleaningQueryError({ response: { status } })).toBe(false);
    }
  });
  it("sends an explicit cancellation reason and freshness token through the dedicated waiver endpoint", async () => {
    post.mockResolvedValue({ data: { taskLogId: 3, status: "waived" } });
    expect(await waiveCanceledCleaningTask({ taskLogId: 3, reason: "Cleaning canceled", expectedUpdatedAt: "2026-09-07T12:00:00Z" })).toEqual({ taskLogId: 3, status: "waived" });
    expect(post).toHaveBeenCalledWith("/cleaningSubmissions/tasks/3/waive", { reason: "Cleaning canceled", expectedUpdatedAt: "2026-09-07T12:00:00Z" });
  });
  it("isolates cached submissions and review permissions by signed-in user", () => {
    expect(cleaningKeys.mine(1)).not.toEqual(cleaningKeys.mine(2));
    expect(cleaningKeys.detail(9, 1)).not.toEqual(cleaningKeys.detail(9, 2));
  });
});
