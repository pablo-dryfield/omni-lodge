import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../../api/volunteerCleaning";
import type { CleaningPhotoSlot, CleaningSubmission } from "../../api/volunteerCleaning";
import { compressImageFile } from "../../utils/imageCompression";
import CleaningSubmissionForm from "./CleaningSubmissionForm";
import CleaningReviewAction from "./CleaningReviewAction";
import HomeCleaningTasks from "./HomeCleaningTasks";

let mockAuthenticated = true;
jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("../../store/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) => selector({ session: { authenticated: mockAuthenticated, loggedUserId: 4 } }) }));
jest.mock("../../api/volunteerCleaning", () => ({
  ...jest.requireActual("../../api/volunteerCleaning"),
  useMyCleaningSubmissions: jest.fn(), useCleaningSubmission: jest.fn(), useUploadCleaningPhoto: jest.fn(), useReviewCleaningPhoto: jest.fn(), useWaiveCanceledCleaningTask: jest.fn(),
}));
jest.mock("../../utils/imageCompression", () => ({ compressImageFile: jest.fn() }));
jest.mock("./CleaningPhotoPreview", () => ({ __esModule: true, default: ({ label }: { label: string }) => <div>Saved {label}</div>, LocalCleaningPhotoPreview: ({ label }: { label: string }) => <div>Selected {label}</div> }));

const slot = (key: string, status: CleaningPhotoSlot["status"]): CleaningPhotoSlot => ({
  key, label: key, ruleKey: key, status, history: [],
  currentVersion: status === "missing" ? null : {
    id: key === "Bathroom" ? 11 : 12, version: 1, status, fileName: "proof.jpg", mimeType: "image/jpeg", fileSize: 100,
    uploadedAt: "2026-09-07T10:00:00Z", reviewedAt: null, reviewerName: status === "approved" ? "Manager One" : null,
    rejectionReason: status === "rejected" ? "Please clean the sink" : null, photoUrl: "unused",
  },
});
const submission = (overrides: Partial<CleaningSubmission> = {}): CleaningSubmission => ({
  id: 1, taskLogId: 2, shiftAssignmentId: 3, userId: 4, subjectName: "Alex Example", taskDate: "2026-09-07",
  title: "House cleaning", shiftName: "Cleaning", status: "awaiting_upload", revision: 1,
  reviewerMissing: false, canUpload: true, canReview: true, slots: [slot("Bathroom", "missing"), slot("Kitchen", "missing")], ...overrides,
});
const query = (data: unknown) => ({ data, isLoading: false, isSuccess: data != null, error: null, refetch: jest.fn() });
const upload = jest.fn();
const review = jest.fn();
const waive = jest.fn();
const view = (element: React.ReactNode) => render(<MantineProvider>{element}</MantineProvider>);

describe("Cleaning workflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upload.mockReset();
    review.mockReset();
    waive.mockReset();
    mockAuthenticated = true;
    Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((media) => ({ matches: false, media, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })) });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
    (api.useUploadCleaningPhoto as jest.Mock).mockReturnValue({ mutateAsync: upload, isPending: false });
    (api.useReviewCleaningPhoto as jest.Mock).mockReturnValue({ mutateAsync: review, isPending: false });
    (api.useWaiveCanceledCleaningTask as jest.Mock).mockReturnValue({ mutateAsync: waive, isPending: false });
    (api.useCleaningSubmission as jest.Mock).mockReturnValue(query(submission({ slots: [slot("Bathroom", "pending")] })));
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query({ submissions: [], reviewSubmissions: [] }));
    (compressImageFile as jest.Mock).mockImplementation(async (file) => file);
  });

  it("hides an empty homepage section and requests only the authenticated bulk endpoint", () => {
    const { rerender } = view(<HomeCleaningTasks />);
    expect(screen.queryByRole("region", { name: "Cleaning tasks" })).not.toBeInTheDocument();
    expect(api.useMyCleaningSubmissions).toHaveBeenLastCalledWith(true, 4);
    mockAuthenticated = false;
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(api.useMyCleaningSubmissions).toHaveBeenLastCalledWith(false, 4);
  });
  it("shows the review queue on the homepage and opens a deferred review", async () => {
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query({ submissions: [], reviewSubmissions: [submission()] }));
    view(<HomeCleaningTasks />);
    fireEvent.click(screen.getByRole("button", { name: "Review photos" }));
    expect(await screen.findByRole("dialog", { name: "Review cleaning photos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve photo" })).toBeInTheDocument();
  });
  it("lets staff refresh cross-device review decisions without polling and disables duplicate refreshes", () => {
    const refetch = jest.fn();
    const data = { submissions: [submission()], reviewSubmissions: [] };
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), refetch, isFetching: false });
    const { rerender } = view(<HomeCleaningTasks />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh cleaning" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), refetch, isFetching: true });
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(screen.getByRole("button", { name: "Refresh cleaning" })).toBeDisabled();
  });
  it.each([
    ["network", new Error("Network error")],
    ["server", { response: { status: 503 } }],
  ])("retains selected photos through a %s background refresh failure and recovery", async (_kind, error) => {
    const data = { submissions: [submission()], reviewSubmissions: [], taskIssues: [] };
    const refetch = jest.fn();
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), refetch });
    const { rerender } = view(<HomeCleaningTasks />);
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    await screen.findByRole("dialog", { name: "House cleaning" });
    fireEvent.change(screen.getByLabelText("Upload Bathroom photo"), { target: { files: [new File(["photo"], "proof.jpg", { type: "image/jpeg" })] } });
    await screen.findByText("Selected Bathroom");

    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), error, refetch });
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(screen.getByRole("dialog", { name: "House cleaning" })).toBeInTheDocument();
    expect(screen.getByText("Selected Bathroom")).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Cleaning refresh interrupted" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry cleaning refresh" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), refetch });
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(screen.queryByRole("alert", { name: "Cleaning refresh interrupted" })).not.toBeInTheDocument();
    expect(screen.getByText("Selected Bathroom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send photos for review" })).toBeEnabled();
  });
  it.each([401, 403, 404])("closes cached upload forms and hides assignments after an authoritative %s response", async (status) => {
    const data = { submissions: [submission()], reviewSubmissions: [], taskIssues: [] };
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query(data));
    const { rerender } = view(<HomeCleaningTasks />);
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    await screen.findByRole("dialog", { name: "House cleaning" });

    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), error: { response: { status, data: { message: "Cleaning access unavailable" } } } });
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(screen.getByRole("alert", { name: "Cleaning tasks unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "House cleaning" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cleaning tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send photos for review" })).not.toBeInTheDocument();
  });
  it("shows a blocking retry error when the first load fails and no cached submissions exist", () => {
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(undefined), error: new Error("Network error") });
    view(<HomeCleaningTasks />);
    expect(screen.getByRole("alert", { name: "Cleaning tasks unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cleaning tasks" })).not.toBeInTheDocument();
  });
  it("does not resurrect denied cached uploads after a network-failed retry, but accepts a successful refresh", () => {
    const data = { submissions: [submission()], reviewSubmissions: [], taskIssues: [] };
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), isSuccess: false, error: { response: { status: 403 } } });
    const { rerender } = view(<HomeCleaningTasks />);
    expect(screen.queryByRole("button", { name: "Add photos" })).not.toBeInTheDocument();
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue({ ...query(data), isSuccess: false, error: new Error("Network error") });
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(screen.queryByRole("button", { name: "Add photos" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Cleaning tasks unavailable" })).toBeInTheDocument();
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query(data));
    rerender(<MantineProvider><HomeCleaningTasks /></MantineProvider>);
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
  });
  it("retains approved photos and permits only the rejected slot to be retaken", () => {
    view(<CleaningSubmissionForm submission={submission({ slots: [slot("Bathroom", "approved"), slot("Kitchen", "rejected")] })} />);
    expect(screen.getByText("Saved Bathroom")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose photo for Bathroom" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose photo for Kitchen" })).toBeInTheDocument();
    expect(screen.getByText("Please clean the sink")).toBeInTheDocument();
  });
  it("shows manager task issues even when there are no submissions without offering an unsafe waiver", () => {
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query({ submissions: [], reviewSubmissions: [], taskIssues: [
      { taskLogId: 21, taskDate: "2026-09-07", title: "House cleaning", code: "settlement_reconciliation_required", message: "Reconcile the closed settlement before continuing.", canWaive: false, updatedAt: "2026-09-07T12:00:00Z" },
      { taskLogId: 22, taskDate: "2026-09-07", title: "House cleaning", code: "no_active_cleaners", message: "A manager must resolve the canceled work.", canWaive: false, updatedAt: "2026-09-07T12:00:00Z" },
    ] }));
    view(<HomeCleaningTasks />);
    expect(screen.getByRole("region", { name: "Cleaning tasks" })).toBeInTheDocument();
    expect(screen.getByText("Reconcile the closed settlement before continuing.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waive canceled cleaning" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View task" })[0]).toHaveAttribute("href", "/assistant-manager-tasks?section=dashboard&task=21");
  });
  it("requires a reason before a permitted canceled-cleaning waiver and retains conflict errors", async () => {
    const issue = { taskLogId: 21, taskDate: "2026-09-07", title: "House cleaning", code: "no_active_cleaners", message: "No assigned cleaners.", canWaive: true, updatedAt: "2026-09-07T12:00:00Z" };
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query({ submissions: [], reviewSubmissions: [], taskIssues: [issue] }));
    waive.mockRejectedValueOnce({ response: { status: 409, data: { message: "Roster changed. Refresh cleaning." } } });
    view(<HomeCleaningTasks />);
    fireEvent.click(screen.getByRole("button", { name: "Waive canceled cleaning" }));
    await screen.findByRole("dialog", { name: "Waive canceled cleaning" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm waiver" }));
    expect(screen.getByText("Enter why this cleaning work was canceled.")).toBeInTheDocument();
    expect(waive).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Cancellation reason" }), { target: { value: "  House unavailable  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm waiver" }));
    await waitFor(() => expect(waive).toHaveBeenCalledWith({ taskLogId: 21, reason: "House unavailable", expectedUpdatedAt: issue.updatedAt }));
    expect(await screen.findByText("Roster changed. Refresh cleaning.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Waive canceled cleaning" })).toBeInTheDocument();
  });
  it("closes a successfully waived cleaning task confirmation", async () => {
    (api.useMyCleaningSubmissions as jest.Mock).mockReturnValue(query({ submissions: [], reviewSubmissions: [], taskIssues: [
      { taskLogId: 21, taskDate: "2026-09-07", title: "House cleaning", code: "no_active_cleaners", message: "No assigned cleaners.", canWaive: true, updatedAt: "2026-09-07T12:00:00Z" },
    ] }));
    waive.mockResolvedValueOnce({ taskLogId: 21, status: "waived" });
    view(<HomeCleaningTasks />);
    fireEvent.click(screen.getByRole("button", { name: "Waive canceled cleaning" }));
    await screen.findByRole("dialog", { name: "Waive canceled cleaning" });
    fireEvent.change(screen.getByRole("textbox", { name: "Cancellation reason" }), { target: { value: "Cleaning canceled" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm waiver" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Waive canceled cleaning" })).not.toBeInTheDocument());
  });
  it("does not offer uploads for an orphaned or reassigned shift", () => {
    view(<CleaningSubmissionForm submission={submission({ shiftAssignmentId: null, canUpload: false })} />);
    expect(screen.queryByRole("button", { name: /Choose photo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send photos for review" })).toBeDisabled();
  });
  it("sends photos sequentially using each newly saved revision", async () => {
    upload.mockResolvedValueOnce({ submission: submission({ revision: 2, slots: [slot("Bathroom", "pending"), slot("Kitchen", "missing")] }) });
    upload.mockResolvedValueOnce({ submission: submission({ revision: 3, slots: [slot("Bathroom", "pending"), slot("Kitchen", "pending")] }) });
    view(<CleaningSubmissionForm submission={submission()} />);
    const file = new File(["photo"], "proof.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Upload Bathroom photo"), { target: { files: [file] } });
    await screen.findByText("Selected Bathroom");
    fireEvent.change(screen.getByLabelText("Upload Kitchen photo"), { target: { files: [file] } });
    await screen.findByText("Selected Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Send photos for review" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[0][0]).toMatchObject({ slotKey: "Bathroom", expectedRevision: 1 });
    expect(upload.mock.calls[1][0]).toMatchObject({ slotKey: "Kitchen", expectedRevision: 2 });
    expect(await screen.findByText(/Photos sent for manager review/)).toBeInTheDocument();
  });
  it("normalizes HEIC before selecting a photo and sending it", async () => {
    const jpeg = new File(["converted"], "proof.jpg", { type: "image/jpeg" });
    (compressImageFile as jest.Mock).mockResolvedValue(jpeg);
    view(<CleaningSubmissionForm submission={submission()} />);
    const heic = new File(["photo"], "proof.heic", { type: "image/heic" });
    fireEvent.change(screen.getByLabelText("Upload Bathroom photo"), { target: { files: [heic] } });
    expect(await screen.findByText(/proof.jpg/)).toBeInTheDocument();
    expect(compressImageFile).toHaveBeenCalledWith(heic, expect.objectContaining({ outputMimeType: "image/jpeg" }));
  });
  it("keeps uploaded photos and remaining selections if the next upload fails", async () => {
    upload.mockResolvedValueOnce({ submission: submission({ revision: 2, slots: [slot("Bathroom", "pending"), slot("Kitchen", "missing")] }) });
    upload.mockRejectedValueOnce({ response: { data: { message: "The connection was interrupted" } } });
    view(<CleaningSubmissionForm submission={submission()} />);
    const file = new File(["photo"], "proof.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Upload Bathroom photo"), { target: { files: [file] } });
    await screen.findByText("Selected Bathroom");
    fireEvent.change(screen.getByLabelText("Upload Kitchen photo"), { target: { files: [file] } });
    await screen.findByText("Selected Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Send photos for review" }));
    expect(await screen.findByText("The connection was interrupted")).toBeInTheDocument();
    expect(screen.getByText("Saved Bathroom")).toBeInTheDocument();
    expect(screen.getByText("Selected Kitchen")).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload Bathroom photo")).not.toBeInTheDocument();
  });
  it("adopts a fresh revision while preserving an unsubmitted photo selection", async () => {
    upload.mockResolvedValueOnce({ submission: submission({ revision: 5, slots: [slot("Bathroom", "pending"), slot("Kitchen", "missing")] }) });
    const { rerender } = view(<CleaningSubmissionForm submission={submission()} />);
    const file = new File(["photo"], "proof.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Upload Bathroom photo"), { target: { files: [file] } });
    await screen.findByText("Selected Bathroom");
    rerender(<MantineProvider><CleaningSubmissionForm submission={submission({ revision: 4 })} /></MantineProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Send photos for review" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 })));
    expect(await screen.findByText(/Photos sent for manager review/)).toBeInTheDocument();
  });
  it("requires a rejection reason and does not acknowledge the whole task", async () => {
    review.mockResolvedValue({ submission: submission() });
    view(<CleaningReviewAction submissionId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Request retake" }));
    expect(screen.getByText("Explain what needs to be retaken.")).toBeInTheDocument();
    expect(review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Retake reason for Bathroom" }), { target: { value: "Clean the sink" } });
    fireEvent.click(screen.getByRole("button", { name: "Request retake" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith({ submissionId: 1, photoId: 11, expectedRevision: 1, decision: "rejected", reason: "Clean the sink" }));
    expect(await screen.findByText("Retake requested. Approved photos are kept.")).toBeInTheDocument();
  });
  it.each([
    ["network", new Error("Network error")],
    ["server", { response: { status: 503 } }],
  ])("retains retake and escalation notes through a %s review refresh failure", (_kind, error) => {
    const data = submission({ reviewerMissing: true, slots: [slot("Bathroom", "pending")] });
    const refetch = jest.fn();
    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(data), refetch });
    const { rerender } = view(<CleaningReviewAction submissionId={1} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Retake reason for Bathroom" }), { target: { value: "Clean the sink" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Management review reason/ }), { target: { value: "Covering missing reviewer" } });

    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(data), error, refetch });
    rerender(<MantineProvider><CleaningReviewAction submissionId={1} /></MantineProvider>);
    expect(screen.getByRole("alert", { name: "Review refresh interrupted" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Retake reason for Bathroom" })).toHaveValue("Clean the sink");
    expect(screen.getByRole("textbox", { name: /Management review reason/ })).toHaveValue("Covering missing reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(data), refetch });
    rerender(<MantineProvider><CleaningReviewAction submissionId={1} /></MantineProvider>);
    expect(screen.queryByRole("alert", { name: "Review refresh interrupted" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Retake reason for Bathroom" })).toHaveValue("Clean the sink");
  });
  it.each([401, 403, 404])("hides cached review photos and actions after an authoritative %s response", (status) => {
    const data = submission({ slots: [slot("Bathroom", "pending")] });
    (api.useCleaningSubmission as jest.Mock).mockReturnValue(query(data));
    const { rerender } = view(<CleaningReviewAction submissionId={1} />);
    expect(screen.getByText("Saved Bathroom")).toBeInTheDocument();
    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(data), error: { response: { status, data: { message: "Review access unavailable" } } } });
    rerender(<MantineProvider><CleaningReviewAction submissionId={1} /></MantineProvider>);
    expect(screen.getByText("Review access unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Saved Bathroom")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Retake reason for Bathroom" })).not.toBeInTheDocument();
  });
  it("does not render a review form for an uncached transient error", () => {
    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(undefined), error: { response: { status: 503, data: { message: "Review service unavailable" } } } });
    view(<CleaningReviewAction submissionId={1} />);
    expect(screen.getByText("Review service unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve photo" })).not.toBeInTheDocument();
    expect(screen.queryByText("Saved Bathroom")).not.toBeInTheDocument();
  });
  it("keeps previously denied review data hidden through transient retries until authorization succeeds", () => {
    const data = submission({ slots: [slot("Bathroom", "pending")] });
    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(data), isSuccess: false, error: { response: { status: 404 } } });
    const { rerender } = view(<CleaningReviewAction submissionId={1} />);
    expect(screen.queryByText("Saved Bathroom")).not.toBeInTheDocument();
    (api.useCleaningSubmission as jest.Mock).mockReturnValue({ ...query(data), isSuccess: false, error: { response: { status: 503 } } });
    rerender(<MantineProvider><CleaningReviewAction submissionId={1} /></MantineProvider>);
    expect(screen.queryByText("Saved Bathroom")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve photo" })).not.toBeInTheDocument();
    (api.useCleaningSubmission as jest.Mock).mockReturnValue(query(data));
    rerender(<MantineProvider><CleaningReviewAction submissionId={1} /></MantineProvider>);
    expect(screen.getByText("Saved Bathroom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve photo" })).toBeInTheDocument();
  });
  it("requires a management escalation reason when no on-shift reviewer exists", async () => {
    (api.useCleaningSubmission as jest.Mock).mockReturnValue(query(submission({ reviewerMissing: true, slots: [slot("Bathroom", "pending")] })));
    review.mockResolvedValue({ submission: submission(), taskCompleted: true });
    view(<CleaningReviewAction submissionId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve photo" }));
    expect(review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Management review reason/ }), { target: { value: "Covering the unassigned manager shift" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve photo" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved", escalationReason: "Covering the unassigned manager shift" })));
    expect(await screen.findByText("All photos approved. The cleaning task is now complete.")).toBeInTheDocument();
  });
  it("never renders approval controls when the backend denies review authority", () => {
    (api.useCleaningSubmission as jest.Mock).mockReturnValue(query(submission({ canReview: false, slots: [slot("Bathroom", "pending")] })));
    view(<CleaningReviewAction submissionId={1} />);
    expect(screen.queryByRole("button", { name: "Approve photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request retake" })).not.toBeInTheDocument();
  });
});
