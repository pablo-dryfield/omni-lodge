import axiosInstance from "../utils/axiosInstance";
import {
  fetchMyVolunteerMilestones,
  fetchVolunteerMilestoneDetail,
  fetchVolunteerMilestoneList,
  updateVolunteerAttendanceRecord,
  updateVolunteerFeedback,
  type VolunteerMilestoneDetail,
  type VolunteerMilestoneList,
} from "./volunteerMilestones";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
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
});
