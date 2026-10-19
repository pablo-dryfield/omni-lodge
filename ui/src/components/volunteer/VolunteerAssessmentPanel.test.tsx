import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useUpdateVolunteerStayAssessment, type VolunteerStayProgress } from "../../api/volunteerMilestones";
import VolunteerAssessmentPanel from "./VolunteerAssessmentPanel";

let mockActorId = 91;
let mockRole = "assistant-manager";
jest.mock("../../store/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) =>
  selector({ session: { loggedUserId: mockActorId, roleSlug: mockRole } }) }));
jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: { defaults: { baseURL: "https://api.example.test/api" } } }));
jest.mock("../../api/volunteerMilestones", () => ({
  useUpdateVolunteerStayAssessment: jest.fn(),
  getVolunteerMilestoneErrorMessage: () => "This stay changed; refresh before saving.",
}));
const save = jest.fn();
const reviewer = (userId: number) => ({ userId, firstName: `Manager ${userId}`, lastName: "Test", profilePhotoUrl: null,
  hasStoredProfilePhoto: true, profilePhotoVersion: `${userId}-1`, sharedShiftCount: 8, sharedShiftIds: [1, 2], review: null, waiver: null });
const report = () => ({
  user: { id: 7 }, stay: { id: 70, revision: 3 }, timezone: "Europe/Warsaw", milestones: [{ key: "cleaning", target: 3 }],
  assessment: { reviewers: [reviewer(91), reviewer(92)], earned: false, pendingCount: 2, upCount: 0, downCount: 0,
    waivedCount: 0, fallback: null, needsFallback: false },
}) as unknown as VolunteerStayProgress;
const view = (data = report(), canEdit = true) => render(<MantineProvider><VolunteerAssessmentPanel report={data} canEdit={canEdit} /></MantineProvider>);

describe("Volunteer shift-manager assessments", () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockActorId = 91; mockRole = "assistant-manager";
    save.mockResolvedValue({});
    (useUpdateVolunteerStayAssessment as jest.Mock).mockReturnValue({ mutateAsync: save, isPending: false });
    Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((media) => ({
      matches: false, media, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    })) });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true,
      value: class { observe() {} unobserve() {} disconnect() {} } });
  });
  it("shows named circular photos, shared shift counts and pending status without locking on other stars", () => {
    view();
    expect(screen.getByText("Manager 91 Test")).toBeInTheDocument();
    expect(screen.getAllByText("Worked together on 8 shifts")).toHaveLength(2);
    expect(screen.getByAltText("Manager 91 Test profile photo")).toHaveAttribute("src", "https://api.example.test/api/volunteerMilestones/7/stays/70/reviewers/91/profile-photo?v=91-1");
    expect(screen.getByRole("button", { name: "Thumbs up" })).toBeEnabled();
    expect(screen.queryByText(/first four measurable stars/i)).not.toBeInTheDocument();
  });
  it("requires a vote and written feedback, then saves only the current manager’s assessment", async () => {
    view();
    const submit = screen.getByRole("button", { name: "Save assessment" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Written feedback/), { target: { value: "Reliable throughout our shifts" } });
    fireEvent.click(submit);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ userId: 7, stayId: 70, expectedRevision: 3,
      action: "review", vote: "up", feedback: "Reliable throughout our shifts" }));
    expect(await screen.findByText("Assessment saved and progress recalculated.")).toBeInTheDocument();
  });
  it("does not let management edit another manager’s vote or a volunteer edit their own stay", () => {
    mockActorId = 99; mockRole = "manager";
    const { unmount } = view();
    expect(screen.queryByRole("button", { name: "Thumbs up" })).not.toBeInTheDocument();
    expect(screen.queryByText("Waive reviewer requirement")).not.toBeInTheDocument();
    unmount(); mockActorId = 7; mockRole = "owner"; view();
    expect(screen.queryByRole("button", { name: "Thumbs up" })).not.toBeInTheDocument();
    expect(screen.queryByText("Waive reviewer requirement")).not.toBeInTheDocument();
  });
  it("allows only owner/admin to waive a reviewer with a reason", async () => {
    mockActorId = 99; mockRole = "owner";
    view();
    expect(screen.getAllByRole("button", { name: "Waive reviewer requirement" })[0]).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText(/Waive reviewer requirement — reason/)[0], { target: { value: "Departed and unavailable" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Waive reviewer requirement" })[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ action: "waive-reviewer", reviewerId: 91,
      reason: "Departed and unavailable", waived: true })));
    expect(await screen.findByText("Assessment saved and progress recalculated.")).toBeInTheDocument();
  });
  it("provides an explicit owner/admin assessment when there are no required voters", async () => {
    mockActorId = 99; mockRole = "owner";
    const data = report(); data.assessment!.reviewers = []; data.assessment!.pendingCount = 0; data.assessment!.needsFallback = true;
    view(data);
    expect(screen.getByText(/Waivers do not automatically earn a star/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thumbs down" }));
    fireEvent.change(screen.getByLabelText(/Written feedback/), { target: { value: "Assessment based on documented conduct" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ action: "fallback", vote: "down" })));
    expect(await screen.findByText("Assessment saved and progress recalculated.")).toBeInTheDocument();
  });
  it("shows zero cleaning as a waiver requirement and handles conflicts without claiming success", async () => {
    const data = report(); data.milestones[0].target = 0;
    save.mockRejectedValueOnce(new Error("conflict"));
    view(data);
    fireEvent.change(screen.getByLabelText(/Waive cleaning requirement — reason/), { target: { value: "None scheduled during this short stay" } });
    fireEvent.click(screen.getByRole("button", { name: "Waive cleaning requirement" }));
    expect(await screen.findByText("This stay changed; refresh before saving.")).toBeInTheDocument();
    expect(screen.queryByText("Assessment saved and progress recalculated.")).not.toBeInTheDocument();
  });
  it("shows reviewers read-only to volunteers", () => {
    view(report(), false);
    expect(screen.getByText("Manager 91 Test")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
