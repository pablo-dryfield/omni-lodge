import axiosInstance from "../utils/axiosInstance";
import {
  fetchMyVolunteerMilestones,
  fetchVolunteerMilestoneDetail,
  fetchVolunteerMilestoneList,
  updateVolunteerAttendanceRecord,
  updateVolunteerFeedback,
  type VolunteerMilestoneDetail,
  type VolunteerMilestoneList,
  fetchVolunteerStayProgress,
  saveVolunteerStay,
  updateVolunteerStayFeedback,
  shouldRetryVolunteerStayQuery,
  type VolunteerMilestoneApiError,
} from "./volunteerMilestones";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = axiosInstance.get as jest.MockedFunction<typeof axiosInstance.get>;
const mockPut = axiosInstance.put as jest.MockedFunction<typeof axiosInstance.put>;
const mockPatch = axiosInstance.patch as jest.MockedFunction<typeof axiosInstance.patch>;

describe("volunteer milestones API", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("propagates the selected historical period to every read scope", async () => {
    const period = "2026-05";
    mockGet
      .mockResolvedValueOnce({ data: {} as VolunteerMilestoneDetail })
      .mockResolvedValueOnce({ data: { volunteers: [] } as unknown as VolunteerMilestoneList })
      .mockResolvedValueOnce({ data: {} as VolunteerMilestoneDetail });

    await fetchMyVolunteerMilestones(period);
    await fetchVolunteerMilestoneList(period);
    await fetchVolunteerMilestoneDetail(42, period);

    expect(mockGet).toHaveBeenNthCalledWith(1, "/volunteerMilestones/me", {
      params: { period },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, "/volunteerMilestones", {
      params: { period },
    });
    expect(mockGet).toHaveBeenNthCalledWith(3, "/volunteerMilestones/42", {
      params: { period },
    });
  });

  it("sends attendance evidence to the assignment route", async () => {
    mockPut.mockResolvedValue({ data: { attendance: {}, progress: {} } });

    await updateVolunteerAttendanceRecord({
      assignmentId: 91,
      status: "late",
      notes: " Arrived ten minutes late. ",
    });

    expect(mockPut).toHaveBeenCalledWith("/volunteerMilestones/attendance/91", {
      status: "late",
      notes: "Arrived ten minutes late.",
    });
  });

  it("saves final feedback against the selected user and month", async () => {
    mockPatch.mockResolvedValue({ data: {} as VolunteerMilestoneDetail });

    await updateVolunteerFeedback({
      userId: 42,
      period: "2026-05",
      approved: true,
      feedback: " Consistently reliable. ",
    });

    expect(mockPatch).toHaveBeenCalledWith(
      "/volunteerMilestones/42/2026-05/feedback",
      { approved: true, feedback: "Consistently reliable." },
    );
  });

  it("reads saved stays without sending a calendar period or creating one", async () => {
    mockGet.mockResolvedValue({ data: {} });
    await fetchVolunteerStayProgress(null);
    await fetchVolunteerStayProgress(42, 8);
    expect(mockGet).toHaveBeenNthCalledWith(1, "/volunteerMilestones/me", { params: {} });
    expect(mockGet).toHaveBeenNthCalledWith(2, "/volunteerMilestones/42", { params: { stayId: 8 } });
    expect(axiosInstance.post).not.toHaveBeenCalled();
  });

  it("saves dates, position, targets and mappings with the captured stay revision", async () => {
    mockPatch.mockResolvedValue({ data: {} });
    const fields = {
      startDate: "2026-08-15",
      endDate: "2026-09-30",
      position: "guide" as const,
      monthlyTargets: { reviews: 5, guidingShifts: 8, promotionShifts: 8, socialMediaShifts: 16, cleaningTasks: 5, attendancePercent: 90 },
      shiftTypeIds: { guiding: [2], promotion: [3], socialMedia: [4] },
      expectedRevision: 3,
      changeReason: "Adjusted seasonal expectations",
    };
    await saveVolunteerStay({ userId: 42, stayId: 8, ...fields });
    expect(mockPatch).toHaveBeenCalledWith("/volunteerMilestones/42/stays/8", fields);
  });

  it("writes stay feedback separately from existing calendar-month feedback", async () => {
    mockPatch.mockResolvedValue({ data: {} });
    await updateVolunteerStayFeedback({ userId: 42, stayId: 8, expectedRevision: 3, approved: false, feedback: "Stay draft" });
    expect(mockPatch).toHaveBeenCalledWith("/volunteerMilestones/42/stays/8/feedback", {
      expectedRevision: 3, approved: false, feedback: "Stay draft",
    });
  });

  it("keeps attendance recalculation scoped to the selected saved stay", async () => {
    mockPut.mockResolvedValue({ data: {} });
    await updateVolunteerAttendanceRecord({ assignmentId: 91, status: "attended", stayId: 8 });
    expect(mockPut).toHaveBeenCalledWith("/volunteerMilestones/attendance/91", { status: "attended" }, { params: { stayId: 8 } });
  });

  it("does not retry unavailable or unauthorized stay reports", () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(shouldRetryVolunteerStayQuery(0, { response: { status } } as VolunteerMilestoneApiError)).toBe(false);
    }
    const serverError = { response: { status: 500 } } as VolunteerMilestoneApiError;
    expect(shouldRetryVolunteerStayQuery(0, serverError)).toBe(true);
    expect(shouldRetryVolunteerStayQuery(1, serverError)).toBe(false);
  });
});
