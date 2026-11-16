import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../../api/volunteerCleaning";
import type { CleaningSubmission } from "../../api/volunteerCleaning";
import CleaningAttendanceControls from "./CleaningAttendanceControls";

jest.mock("../../api/volunteerCleaning", () => ({
  ...jest.requireActual("../../api/volunteerCleaning"), useResolveCleaningAttendance: jest.fn(),
}));
jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: {} }));
jest.mock("../../store/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) => selector({ session: { loggedUserId: 9 } }) }));
const save = jest.fn();
const submission: CleaningSubmission = { id: 7, taskLogId: 25, shiftAssignmentId: 12, userId: 8,
  subjectName: "Veronica Example", taskDate: "2026-11-13", title: "Cleaning", shiftName: "Cleaning B",
  status: "awaiting_upload", revision: 3, reviewerMissing: false, canUpload: false, canReview: true, canResolveAttendance: true, slots: [] };
const show = (value = submission, onChange = jest.fn()) => render(<MantineProvider><CleaningAttendanceControls submission={value} onChange={onChange} /></MantineProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((media) => ({ matches: false, media, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
  (api.useResolveCleaningAttendance as jest.Mock).mockReturnValue({ mutateAsync: save, isPending: false });
});
it("requires a reason before recording an absence and refreshes the planner after completion", async () => {
  save.mockResolvedValueOnce({ submission: { ...submission, status: "absent" }, taskCompleted: true });
  const refresh = jest.fn(); show(submission, refresh);
  fireEvent.click(screen.getByRole("button", { name: "Absent" }));
  expect(screen.getByRole("button", { name: "Save attendance" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Did not arrive" } });
  fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ submissionId: 7, expectedRevision: 3, decision: "absent", reason: "Did not arrive" }));
  expect(await screen.findByText("Saved. All cleaning assignments are resolved and the task is complete.")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("shows excused history with no photo requirement and supports restoring photos while open", () => {
  show({ ...submission, status: "excused", attendanceResolution: { status: "excused", reason: "Approved leave", recordedBy: 9, recordedAt: "2026-11-13T17:00:00Z" } });
  expect(screen.getByText("Approved leave")).toBeInTheDocument();
  expect(screen.getByText(/Excluded from the cleaning requirement/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Require photos" }));
  expect(screen.getByRole("textbox", { name: "Reason" })).toBeInTheDocument();
});
it("does not expose attendance actions to a cleaner or closed task", () => {
  show({ ...submission, canResolveAttendance: false });
  expect(screen.queryByRole("button", { name: "Absent" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Excused" })).not.toBeInTheDocument();
});
it("keeps the decision and reason after a failed save", async () => {
  save.mockRejectedValueOnce({ response: { status: 409, data: { message: "Schedule changed" } } });
  show(); fireEvent.click(screen.getByRole("button", { name: "Excused" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Unwell" } });
  fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));
  expect(await screen.findByText("Schedule changed")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Reason" })).toHaveValue("Unwell");
});
