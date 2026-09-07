import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../../api/volunteerMilestones";
import type { VolunteerStayProgress as StayReport } from "../../api/volunteerMilestones";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import VolunteerStayProgress from "./VolunteerStayProgress";

let mockRole = "owner";
jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: { defaults: { baseURL: "https://api.example.test/api/" } },
}));
jest.mock("../../store/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector({ session: { roleSlug: mockRole, staffType: null } }),
}));
jest.mock("../../hooks/useModuleAccess", () => ({ useModuleAccess: jest.fn() }));
jest.mock("../../api/volunteerMilestones", () => ({
  getVolunteerMilestoneErrorMessage: () => "Unable to load progress.",
  useVolunteerStayList: jest.fn(),
  useVolunteerStayProgress: jest.fn(),
  useSaveVolunteerStay: jest.fn(),
}));

const monthlyTargets = { reviews: 5, guidingShifts: 8, promotionShifts: 8, socialMediaShifts: 16, cleaningTasks: 5, attendancePercent: 90 };
const stay = {
  id: 8, userId: 42, startDate: "2026-08-15", endDate: "2026-09-30", position: "guide" as const,
  monthlyTargets, shiftTypeIds: { guiding: [2], promotion: [3], socialMedia: [4] },
  changeReason: null, revision: 3, createdAt: "2026-08-14T10:00:00Z", updatedAt: "2026-08-14T10:00:00Z",
};
const report: StayReport = {
  mode: "stay",
  user: { id: 42, firstName: "Former", lastName: "Volunteer", email: "former@example.test", profilePhotoUrl: null, arrivalDate: "2026-08-15", departureDate: "2026-09-30" },
  active: true,
  stay, stays: [stay], setupRequired: false,
  suggestedStay: { ...stay },
  targetSummary: { equivalentMonths: 1.5, elapsedMonths: 1, targets: monthlyTargets, expectedToDate: monthlyTargets },
  asOfDate: "2026-09-06", timezone: "Europe/Warsaw", starsEarned: 0, totalStars: 5,
  milestones: [], attendanceAssignments: [], managementFeedback: null,
  warnings: ["Some legacy review credits do not have an exact activity date."],
  shiftTypes: [{ id: 2, key: "guide", name: "Pub Crawl" }, { id: 3, key: "promotion", name: "Promotion" }, { id: 4, key: "social-media", name: "Social Media" }],
};
const upcomingReport: StayReport = {
  ...report,
  user: {
    ...report.user,
    id: 84,
    firstName: "Ada",
    lastName: "Creator",
    email: "ada@example.test",
    profilePhotoUrl: "https://cdn.example.test/ada.jpg",
  },
  stay: {
    ...stay,
    id: 12,
    userId: 84,
    startDate: "2026-10-01",
    endDate: "2026-11-01",
    position: "social_media",
  },
  stays: [{
    ...stay,
    id: 12,
    userId: 84,
    startDate: "2026-10-01",
    endDate: "2026-11-01",
    position: "social_media",
  }],
  starsEarned: 2,
};
const query = (data: unknown) => ({ data, isLoading: false, isFetching: false, error: null, refetch: jest.fn() });
const save = jest.fn();
const renderProgress = jest.fn(() => <div>Calculated stay milestones</div>);
const view = () => <MantineProvider><VolunteerStayProgress renderProgress={renderProgress} /></MantineProvider>;

describe("Volunteer stay progress", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((media: string) => ({ matches: false, media, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })),
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true, writable: true,
      value: class { observe() {} unobserve() {} disconnect() {} },
    });
    mockRole = "owner";
    (useModuleAccess as jest.Mock).mockReturnValue({ ready: true, canView: true, canUpdate: true });
    (api.useVolunteerStayList as jest.Mock).mockReturnValue(query({ volunteers: [{ ...report, active: false }], shiftTypes: report.shiftTypes }));
    (api.useVolunteerStayProgress as jest.Mock).mockReturnValue(query(report));
    save.mockResolvedValue(report);
    (api.useSaveVolunteerStay as jest.Mock).mockReturnValue({ mutateAsync: save, isPending: false });
  });

  afterEach(() => jest.clearAllMocks());

  it("shows every volunteer from the bulk roster with profile photos before loading an individual detail", () => {
    (api.useVolunteerStayList as jest.Mock).mockReturnValue(query({
      volunteers: [{ ...report, active: false }, upcomingReport],
      shiftTypes: report.shiftTypes,
    }));

    render(view());

    expect(screen.getByRole("button", { name: "View Former Volunteer volunteer progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Ada Creator volunteer progress" })).toBeInTheDocument();
    expect(screen.getByAltText("Ada Creator profile photo")).toHaveAttribute(
      "src",
      "https://cdn.example.test/ada.jpg",
    );
    expect(screen.getByRole("region", { name: "Current & upcoming" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Previous & inactive" })).toBeInTheDocument();
    expect(api.useVolunteerStayProgress).toHaveBeenLastCalledWith(null, null, false);
    expect(renderProgress).not.toHaveBeenCalled();
  });

  it("keeps saved previous stays visible and shows source warnings after opening the volunteer", async () => {
    render(view());

    fireEvent.click(screen.getByRole("button", { name: "View Former Volunteer volunteer progress" }));

    expect(api.useVolunteerStayProgress).toHaveBeenLastCalledWith(42, 8, true);
    expect(await screen.findByText(report.warnings[0])).toBeInTheDocument();
    expect(screen.getByText(/1.5 months equivalent/)).toBeInTheDocument();
    expect(screen.getByText(/through the day before departure/)).toBeInTheDocument();
    expect(renderProgress).toHaveBeenCalledWith(report, true);
    expect(screen.getByText(/Photo-managed cleaning shifts count only after every required photo is approved/)).toBeInTheDocument();
  });

  it("lets Social Media users view only their own stay without manager controls", () => {
    mockRole = "social-media";
    render(view());
    expect(api.useVolunteerStayProgress).toHaveBeenCalledWith(null, null, true);
    expect(api.useVolunteerStayList).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: "Edit stay and targets" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Volunteer")).not.toBeInTheDocument();
  });

  it("shows setup without calculating or creating a stay from profile suggestions", async () => {
    const setupReport = { ...report, stay: null, stays: [], targetSummary: null, setupRequired: true };
    (api.useVolunteerStayList as jest.Mock).mockReturnValue(query({ volunteers: [setupReport], shiftTypes: report.shiftTypes }));
    (api.useVolunteerStayProgress as jest.Mock).mockReturnValue(query(setupReport));
    render(view());

    fireEvent.click(screen.getByRole("button", { name: "View Former Volunteer volunteer progress" }));

    expect(await screen.findByRole("heading", { name: "Stay setup required" })).toBeInTheDocument();
    expect(renderProgress).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps a view-only manager out of stay editing", async () => {
    (useModuleAccess as jest.Mock).mockReturnValue({ ready: true, canView: true, canUpdate: false });
    render(view());

    fireEvent.click(screen.getByRole("button", { name: "View Former Volunteer volunteer progress" }));

    expect(await screen.findByText("You have read-only access to volunteer progress.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit stay and targets" })).not.toBeInTheDocument();
  });

  it("preserves the draft and captured revision when the server refreshes during an edit", async () => {
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: "View Former Volunteer volunteer progress" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit stay" }));
    expect(screen.getByLabelText(/Attendance & punctuality threshold/)).toBeInTheDocument();
    expect(screen.getByText(/use a fair blended monthly rate/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reviews per month/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: "Lower season" } });
    (api.useVolunteerStayProgress as jest.Mock).mockReturnValue(query({ ...report, stay: { ...stay, revision: 4 } }));
    rerender(view());
    expect(screen.getByLabelText(/Reviews per month/)).toHaveValue("4");
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ stayId: 8, expectedRevision: 3, changeReason: "Lower season", monthlyTargets: { ...monthlyTargets, reviews: 4 } })));
    expect(await screen.findByText("Stay saved and progress recalculated.")).toBeInTheDocument();
  });

  it.each([4, 6])("requires a reason for any custom seasonal target on a new stay (%s reviews)", async (reviews) => {
    const setupReport = { ...report, stay: null, stays: [], targetSummary: null, setupRequired: true };
    (api.useVolunteerStayList as jest.Mock).mockReturnValue(query({ volunteers: [setupReport], shiftTypes: report.shiftTypes }));
    (api.useVolunteerStayProgress as jest.Mock).mockReturnValue(query(setupReport));
    render(view());

    fireEvent.click(screen.getByRole("button", { name: "View Former Volunteer volunteer progress" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up stay" }));
    fireEvent.change(screen.getByLabelText(/Reviews per month/), { target: { value: String(reviews) } });
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    expect(await screen.findByText("Explain why you are changing this stay or its targets.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
