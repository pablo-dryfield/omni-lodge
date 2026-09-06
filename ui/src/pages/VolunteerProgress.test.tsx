import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import * as milestoneApi from "../api/volunteerMilestones";
import { useModuleAccess } from "../hooks/useModuleAccess";
import type { VolunteerMilestoneDetail, VolunteerMilestoneList } from "../api/volunteerMilestones";
import VolunteerProgress from "./VolunteerProgress";

let mockRoleSlug = "owner";
let mockStaffType: string | null = null;

jest.mock("../store/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ session: { roleSlug: mockRoleSlug, staffType: mockStaffType } }),
}));

jest.mock("../hooks/useModuleAccess", () => ({
  useModuleAccess: jest.fn(),
}));

jest.mock("../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../api/volunteerMilestones", () => {
  return {
    getVolunteerMilestoneErrorMessage: (_error: unknown, fallback?: string) =>
      fallback ?? "Unable to load volunteer progress.",
    useMyVolunteerMilestones: jest.fn(),
    useVolunteerMilestoneList: jest.fn(),
    useVolunteerMilestoneDetail: jest.fn(),
    useUpdateVolunteerAttendance: jest.fn(),
    useUpdateVolunteerFeedback: jest.fn(),
  };
});

const mockUseModuleAccess = useModuleAccess as jest.MockedFunction<typeof useModuleAccess>;
const mockUseMyProgress = milestoneApi.useMyVolunteerMilestones as jest.Mock;
const mockUseList = milestoneApi.useVolunteerMilestoneList as jest.Mock;
const mockUseDetail = milestoneApi.useVolunteerMilestoneDetail as jest.Mock;
const mockUseUpdateAttendance = milestoneApi.useUpdateVolunteerAttendance as jest.Mock;
const mockUseUpdateFeedback = milestoneApi.useUpdateVolunteerFeedback as jest.Mock;

const queryResult = <T,>(data: T) => ({
  data,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: jest.fn().mockResolvedValue(undefined),
});

const milestone = (
  key: VolunteerMilestoneDetail["milestones"][number]["key"],
  title: string,
) => ({
  key,
  title,
  current: 0,
  target: 1,
  unit: "milestone",
  progressPercent: 0,
  earned: false,
  state: "in_progress" as const,
  remainingText: "One milestone remains.",
  reason: "The requirement is not complete yet.",
  evidence: [],
});

const detail: VolunteerMilestoneDetail = {
  period: {
    month: "2026-09",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    asOfDate: "2026-09-06",
    timezone: "Europe/Warsaw",
  },
  user: {
    id: 42,
    firstName: "Ada",
    lastName: "Volunteer",
    email: "ada@example.com",
    profilePhotoUrl: null,
  },
  starsEarned: 0,
  totalStars: 5,
  milestones: [
    milestone("reviews", "Reviews"),
    {
      ...milestone("attendance", "Attendance & punctuality"),
      evidence: [
        { id: 1, label: "Shift one", status: "attended" },
        { id: 2, label: "Shift two", status: "attended" },
        { id: 3, label: "Shift three", status: "late" },
        { id: 4, label: "Missed shift", status: "absent" },
      ],
    },
    milestone("monthly_shifts", "Monthly shifts"),
    milestone("cleaning", "Cleaning & house care"),
    {
      ...milestone("management_feedback", "Management feedback"),
      evidence: [{ id: 5, label: "Feedback draft saved", status: "draft" }],
    },
  ],
  attendanceAssignments: [
    {
      assignmentId: 9,
      shiftInstanceId: 4,
      date: "2026-09-01",
      startTime: "18:00:00",
      endTime: "22:00:00",
      shiftName: "Evening reception",
      role: "Host",
      status: null,
      notes: null,
      recordedAt: "2026-09-02T08:15:00.000Z",
      recordedByName: "Maria Manager",
      isPast: true,
    },
  ],
  managementFeedback: null,
};

const approvedDetail: VolunteerMilestoneDetail = {
  ...detail,
  managementFeedback: {
    approved: true,
    feedback: "A thoughtful and reliable month.",
    approvedAt: "2026-08-31T22:30:00.000Z",
    approvedByName: "Omar Owner",
    updatedAt: "2026-08-31T22:30:00.000Z",
    updatedByName: "Omar Owner",
  },
};

const fullyApprovedDetail: VolunteerMilestoneDetail = {
  ...approvedDetail,
  starsEarned: 5,
  milestones: approvedDetail.milestones.map((item) => ({
    ...item,
    current: item.target,
    progressPercent: 100,
    earned: true,
    state: "earned" as const,
    remainingText: "Star earned.",
    reason: "The requirement is complete.",
  })),
};

const list: VolunteerMilestoneList = {
  period: detail.period,
  volunteers: [
    {
      userId: detail.user.id,
      firstName: detail.user.firstName,
      lastName: detail.user.lastName,
      email: detail.user.email,
      profilePhotoUrl: null,
      active: true,
      starsEarned: 0,
      totalStars: 5,
      milestones: detail.milestones,
    },
  ],
};

class TestResizeObserver implements ResizeObserver {
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

describe("VolunteerProgress permissions", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
    mockRoleSlug = "owner";
    mockStaffType = null;
    mockUseModuleAccess.mockReturnValue({
      ready: true,
      loading: false,
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
    mockUseList.mockReturnValue(queryResult(list));
    mockUseDetail.mockReturnValue(queryResult(detail));
    mockUseMyProgress.mockReturnValue(queryResult(undefined));
    mockUseUpdateAttendance.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue(undefined),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseUpdateFeedback.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue(detail),
      isPending: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("keeps a manager with view-only access out of attendance and feedback controls", async () => {
    render(
      <MantineProvider>
        <VolunteerProgress />
      </MantineProvider>,
    );

    expect(await screen.findByText(/You have read-only access to volunteer progress/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manager workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save attendance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save final feedback" })).not.toBeInTheDocument();
  });

  it("shows who recorded an attendance decision to an editing manager", async () => {
    mockUseModuleAccess.mockReturnValue({
      ready: true,
      loading: false,
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    });
    mockUseDetail.mockReturnValue(queryResult(fullyApprovedDetail));

    render(
      <MantineProvider>
        <VolunteerProgress />
      </MantineProvider>,
    );

    expect(await screen.findByText("Updated 2 Sep, 10:15 by Maria Manager")).toBeInTheDocument();
    expect(screen.getAllByText("Approved 1 Sep 2026, 00:30 by Omar Owner")).toHaveLength(2);
  });

  it("lets volunteers inspect all evidence without presenting an absence as success", async () => {
    mockRoleSlug = "guide";
    mockStaffType = "volunteer";
    mockUseMyProgress.mockReturnValue(queryResult(detail));

    render(
      <MantineProvider>
        <VolunteerProgress />
      </MantineProvider>,
    );

    expect(screen.queryByText("Missed shift")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Show all 4 evidence items" }));

    expect(screen.getByText("Missed shift")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Negative evidence" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pending evidence" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less evidence" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows a clean not-applicable state to a non-volunteer guide", async () => {
    mockRoleSlug = "guide";
    mockStaffType = "long_term";

    render(
      <MantineProvider>
        <VolunteerProgress />
      </MantineProvider>,
    );

    expect(await screen.findByText("Volunteer milestones are not applicable")).toBeInTheDocument();
    expect(screen.queryByText("Ada Volunteer")).not.toBeInTheDocument();
    expect(mockUseMyProgress).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("shows approval attribution in the volunteer-facing feedback summary", async () => {
    mockRoleSlug = "guide";
    mockStaffType = "volunteer";
    mockUseMyProgress.mockReturnValue(queryResult(fullyApprovedDetail));

    render(
      <MantineProvider>
        <VolunteerProgress />
      </MantineProvider>,
    );

    expect(await screen.findByText("A thoughtful and reliable month.")).toBeInTheDocument();
    expect(screen.getByText("Approved 1 Sep 2026, 00:30 by Omar Owner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ada Volunteer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Reviews" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manager workspace" })).not.toBeInTheDocument();
  });

  it("explains when a recorded approval is on hold after prerequisites regress", async () => {
    mockRoleSlug = "guide";
    mockStaffType = "volunteer";
    mockUseMyProgress.mockReturnValue(queryResult(approvedDetail));

    render(
      <MantineProvider>
        <VolunteerProgress />
      </MantineProvider>,
    );

    expect(await screen.findByText("Approval on hold")).toBeInTheDocument();
    expect(
      screen.getByText(/The final star is on hold because one or more measurable milestones/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Approval recorded 1 Sep 2026, 00:30 by Omar Owner")).toBeInTheDocument();
  });
});
