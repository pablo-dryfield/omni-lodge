import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import * as api from "../../api/volunteerCleaning";
import type { CleaningSubmission } from "../../api/volunteerCleaning";
import CleaningTaskPhotoHistory from "./CleaningTaskPhotoHistory";

jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("../../store/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) => selector({ session: { loggedUserId: 44 } }) }));
jest.mock("../../api/volunteerCleaning", () => ({
  ...jest.requireActual("../../api/volunteerCleaning"),
  useCleaningTaskHistory: jest.fn(),
}));
jest.mock("./CleaningPhotoPreview", () => ({
  __esModule: true,
  default: ({ photoId }: { photoId: number }) => <div>Loaded photo {photoId}</div>,
}));

const savedSubmission: CleaningSubmission = {
  id: 7, taskLogId: 25, shiftAssignmentId: null, userId: 12, subjectName: "Alex Example",
  taskDate: "2026-09-08", title: "Review house cleaning", shiftName: "House Cleaning",
  status: "approved", revision: 4, reviewerMissing: false, canUpload: false, canReview: false,
  slots: [{
    key: "kitchen", label: "Kitchen", ruleKey: "kitchen", status: "approved",
    currentVersion: {
      id: 72, version: 2, status: "approved", fileName: "kitchen.jpg", mimeType: "image/jpeg", fileSize: 120,
      uploadedAt: "2026-09-08T11:00:00Z", reviewedAt: "2026-09-08T11:05:00Z", reviewerName: "Manager One",
      rejectionReason: null, photoUrl: "/unused",
    },
    history: [{
      id: 72, version: 2, status: "approved", fileName: "kitchen.jpg", mimeType: "image/jpeg", fileSize: 120,
      uploadedAt: "2026-09-08T11:00:00Z", reviewedAt: "2026-09-08T11:05:00Z", reviewerName: "Manager One",
      rejectionReason: null, photoUrl: "/unused",
    }, {
      id: 71, version: 1, status: "rejected", fileName: "kitchen-old.jpg", mimeType: "image/jpeg", fileSize: 100,
      uploadedAt: "2026-09-08T10:00:00Z", reviewedAt: "2026-09-08T10:05:00Z", reviewerName: "Manager One",
      rejectionReason: "Clean the counter again", photoUrl: "/unused",
    }],
  }],
};

describe("CleaningTaskPhotoHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((media) => ({ matches: false, media, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })) });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
    (api.useCleaningTaskHistory as jest.Mock).mockReturnValue({ data: { taskLogId: 25, submissions: [savedSubmission] }, error: null,
      isLoading: false, isFetching: false, isSuccess: true, refetch: jest.fn() });
  });

  it("loads on demand and exposes approved and rejected photo versions", async () => {
    render(<MantineProvider><CleaningTaskPhotoHistory taskLogId={25} /></MantineProvider>);
    expect(api.useCleaningTaskHistory).toHaveBeenLastCalledWith(25, 44, false);
    fireEvent.click(screen.getByRole("button", { name: "View cleaning photos" }));
    expect(await screen.findByRole("dialog", { name: "Cleaning photo history" })).toBeInTheDocument();
    expect(api.useCleaningTaskHistory).toHaveBeenLastCalledWith(25, 44, true);
    expect(screen.getByText("Alex Example")).toBeInTheDocument();
    expect(screen.getByText("Clean the counter again")).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Alex Example Kitchen photo version 1" }));
    expect(await screen.findByText("Loaded photo 71")).toBeInTheDocument();
    expect(screen.getByText("Alex Example - Kitchen")).toBeInTheDocument();
  });

  it("hides cached photo history after access is denied", async () => {
    const { rerender } = render(<MantineProvider><CleaningTaskPhotoHistory taskLogId={25} /></MantineProvider>);
    fireEvent.click(screen.getByRole("button", { name: "View cleaning photos" }));
    expect(await screen.findByText("Alex Example")).toBeInTheDocument();
    (api.useCleaningTaskHistory as jest.Mock).mockReturnValue({
      data: { taskLogId: 25, submissions: [savedSubmission] }, error: { response: { status: 403, data: { message: "Cleaning access unavailable" } } },
      isLoading: false, isFetching: false, isSuccess: false, refetch: jest.fn(),
    });
    rerender(<MantineProvider><CleaningTaskPhotoHistory taskLogId={25} /></MantineProvider>);
    expect(screen.getByRole("alert", { name: "Unable to load cleaning photos" })).toBeInTheDocument();
    expect(screen.queryByText("Alex Example")).not.toBeInTheDocument();
  });
});
