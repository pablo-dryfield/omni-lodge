import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSaveVolunteerStay, type VolunteerStayProgress } from "../../api/volunteerMilestones";
import VolunteerStayEditor, { type VolunteerTargetSection } from "./VolunteerStayEditor";

jest.mock("../../api/volunteerMilestones", () => ({ useSaveVolunteerStay: jest.fn(), getVolunteerMilestoneErrorMessage: () => "Refresh required" }));
const save = jest.fn();
const monthlyTargets = { reviews: 15, guidingShifts: 12, promotionShifts: 12, socialMediaShifts: 16, cleaningTasks: 5, attendancePercent: 90 };
const data = () => ({ user: { id: 7, firstName: "Test", lastName: "Volunteer" },
  stay: { id: 70, revision: 3, startDate: "2026-08-15", endDate: "2026-09-30", position: "guide", monthlyTargets,
    targetOverrides: { guidingShifts: 7 }, shiftTypeIds: { guiding: [1], promotion: [2], socialMedia: [3] } },
  targetSummary: { targets: { ...monthlyTargets, reviews: 23, guidingShifts: 7, promotionShifts: 18 } }, shiftTypes: [],
}) as unknown as VolunteerStayProgress;
const view = (section: VolunteerTargetSection, report = data()) => render(<MantineProvider><VolunteerStayEditor
  report={report} mode="edit" targetSection={section} onClose={jest.fn()} onSaved={jest.fn()} /></MantineProvider>);
const reason = () => fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: "Agreed whole-stay adjustment" } });

describe("Inline volunteer target editing", () => {
  beforeEach(() => {
    jest.clearAllMocks(); save.mockResolvedValue(data());
    (useSaveVolunteerStay as jest.Mock).mockReturnValue({ mutateAsync: save, isPending: false });
    Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((media) => ({
      matches: false, media, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    })) });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true,
      value: class { observe() {} unobserve() {} disconnect() {} } });
  });
  it("edits an exact review total, requires a reason and preserves unrelated overrides and monthly defaults", async () => {
    view("reviews");
    expect(screen.getByLabelText(/Reviews for entire stay/)).toHaveValue("23");
    expect(screen.queryByLabelText(/Guiding shifts/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Arrival date/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reviews for entire stay/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    expect(await screen.findByText("Explain why you are changing this stay or its targets.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled(); reason();
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3,
      monthlyTargets, targetOverrides: { reviews: 10, guidingShifts: 7 }, changeReason: "Agreed whole-stay adjustment" })));
  });
  it("sets exact guiding and promotion totals without editing reviews", async () => {
    view("monthly_shifts");
    fireEvent.change(screen.getByLabelText(/Guiding shifts for entire stay/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Promotion shifts for entire stay/), { target: { value: "14" } }); reason();
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ targetOverrides: { guidingShifts: 10, promotionShifts: 14 } })));
  });
  it("restores automatic defaults only for the selected target", async () => {
    const report = data(); report.stay!.targetOverrides = { guidingShifts: 7, reviews: 10 };
    view("reviews", report);
    fireEvent.click(screen.getByLabelText("Use automatic prorated defaults instead")); reason();
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ targetOverrides: { guidingShifts: 7 } })));
  });
  it("does not freeze an unedited promotion target when only guiding is changed", async () => {
    view("monthly_shifts");
    fireEvent.change(screen.getByLabelText(/Guiding shifts for entire stay/), { target: { value: "10" } }); reason();
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ targetOverrides: { guidingShifts: 10 } })));
  });
  it("edits the existing shared attendance/on-time threshold as a percentage, not an activity total", async () => {
    view("attendance");
    expect(screen.queryByLabelText("Use automatic prorated defaults instead")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Attendance & punctuality threshold/), { target: { value: "85" } }); reason();
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ monthlyTargets: { ...monthlyTargets, attendancePercent: 85 } })));
    expect(save.mock.calls[0][0]).not.toHaveProperty("targetOverrides");
  });
});
