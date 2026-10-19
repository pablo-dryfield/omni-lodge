import { Alert, Button, Checkbox, Group, Modal, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useState } from "react";
import {
  getVolunteerMilestoneErrorMessage,
  useSaveVolunteerStay,
  type VolunteerStayPosition,
  type VolunteerStayProgress,
  type VolunteerStayTargets,
  type VolunteerStayTargetOverrides,
} from "../../api/volunteerMilestones";

const TARGET_LABELS: Record<keyof VolunteerStayTargets, string> = {
  reviews: "Reviews per month",
  guidingShifts: "Guiding shifts per month",
  promotionShifts: "Promotion shifts per month",
  socialMediaShifts: "Social media shifts per month",
  cleaningTasks: "Cleaning tasks per month",
  attendancePercent: "Attendance & punctuality threshold (%)",
};
export type VolunteerTargetSection = "reviews" | "attendance" | "monthly_shifts";

const VolunteerStayEditor = ({
  report,
  mode,
  onClose,
  onSaved,
  targetSection,
}: {
  report: VolunteerStayProgress;
  mode: "new" | "edit";
  onClose: () => void;
  onSaved: (report: VolunteerStayProgress) => void;
  targetSection?: VolunteerTargetSection | null;
}) => {
  const [initial] = useState(() => ({
    userId: report.user.id,
    stay: mode === "edit" ? report.stay : null,
    source: mode === "edit" && report.stay ? report.stay : report.suggestedStay,
  }));
  const [startDate, setStartDate] = useState(initial.source.startDate ?? "");
  const [endDate, setEndDate] = useState(initial.source.endDate ?? "");
  const [position, setPosition] = useState<VolunteerStayPosition>(initial.source.position);
  const [targets, setTargets] = useState<Record<keyof VolunteerStayTargets, number | string>>({ ...initial.source.monthlyTargets });
  const [initialStayTotals] = useState({ ...(report.targetSummary?.targets ?? initial.source.monthlyTargets) });
  const [stayTotals, setStayTotals] = useState<Record<keyof VolunteerStayTargets, number | string>>({ ...initialStayTotals });
  const [useAutomatic, setUseAutomatic] = useState(false);
  const exactMode = targetSection === "reviews" || targetSection === "monthly_shifts";
  const [shiftTypeIds, setShiftTypeIds] = useState({
    guiding: initial.source.shiftTypeIds.guiding.map(String),
    promotion: initial.source.shiftTypeIds.promotion.map(String),
    socialMedia: initial.source.shiftTypeIds.socialMedia.map(String),
  });
  const [changeReason, setChangeReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useSaveVolunteerStay();
  const roleTargets: Array<keyof VolunteerStayTargets> = position === "guide"
    ? ["guidingShifts", "promotionShifts"]
    : ["socialMediaShifts"];
  const targetKeys: Array<keyof VolunteerStayTargets> = targetSection === "reviews" ? ["reviews"]
    : targetSection === "attendance" ? ["attendancePercent"]
      : targetSection === "monthly_shifts" ? roleTargets : ["reviews", ...roleTargets, "attendancePercent"];
  const shiftOptions = report.shiftTypes.map((type) => ({ value: String(type.id), label: type.name }));
  const customTarget = mode === "new" && Object.entries(targets).some(([key, value]) =>
    Number(value) !== report.suggestedStay.monthlyTargets[key as keyof VolunteerStayTargets]);
  const reasonRequired = mode === "edit" || customTarget;

  const save = async () => {
    if (!startDate || !endDate || endDate <= startDate) {
      setError("Choose an arrival date and a later departure date.");
      return;
    }
    if (Object.values(targets).some((value) => value === "" || !Number.isFinite(Number(value)) || Number(value) < 0)
      || Number(targets.attendancePercent) > 100) {
      setError("Enter valid monthly targets and attendance between 0 and 100%.");
      return;
    }
    if (reasonRequired && !changeReason.trim()) {
      setError("Explain why you are changing this stay or its targets.");
      return;
    }
    if (exactMode && !useAutomatic && targetKeys.some((key) => stayTotals[key] === "" || !Number.isSafeInteger(Number(stayTotals[key]))
      || Number(stayTotals[key]) < 0 || Number(stayTotals[key]) > 10000)) {
      setError("Whole-stay targets must be whole numbers between 0 and 10000.");
      return;
    }
    const targetOverrides = { ...initial.stay?.targetOverrides };
    if (exactMode) for (const key of targetKeys as Array<keyof VolunteerStayTargetOverrides>) {
      if (useAutomatic) delete targetOverrides[key];
      else if (Number(stayTotals[key]) !== initialStayTotals[key]) targetOverrides[key] = Number(stayTotals[key]);
    }
    try {
      setError(null);
      const saved = await mutation.mutateAsync({
        userId: initial.userId,
        ...(initial.stay ? { stayId: initial.stay.id, expectedRevision: initial.stay.revision } : {}),
        startDate,
        endDate,
        position,
        monthlyTargets: Object.fromEntries(Object.entries(targets).map(([key, value]) => [key, Number(value)])) as VolunteerStayTargets,
        ...(exactMode ? { targetOverrides: Object.keys(targetOverrides).length ? targetOverrides : null } : {}),
        shiftTypeIds: {
          guiding: shiftTypeIds.guiding.map(Number),
          promotion: shiftTypeIds.promotion.map(Number),
          socialMedia: shiftTypeIds.socialMedia.map(Number),
        },
        ...(changeReason.trim() ? { changeReason: changeReason.trim() } : {}),
      });
      onSaved(saved);
    } catch (saveError) {
      setError(getVolunteerMilestoneErrorMessage(saveError, "Unable to save this stay."));
    }
  };

  return (
    <Modal
      opened
      onClose={() => !mutation.isPending && onClose()}
      title={targetSection === "reviews" ? "Edit review target" : targetSection === "attendance" ? "Edit attendance & punctuality targets"
        : targetSection === "monthly_shifts" ? "Edit shift targets" : mode === "edit" ? "Edit stay and targets" : "Set up volunteer stay"}
      size="min(680px, 94vw)"
      centered
      closeOnEscape={!mutation.isPending}
      closeOnClickOutside={!mutation.isPending}
      withCloseButton={!mutation.isPending}
    >
      <Stack gap="md">
        <Text size="sm">{[report.user.firstName, report.user.lastName].filter(Boolean).join(" ") || report.user.email}</Text>
        {targetSection && <Text size="sm" c="dimmed">Saved stay: {startDate} to {endDate} (departure day excluded).</Text>}
        {error ? <Alert color="red">{error}</Alert> : null}
        {mode === "new" ? <Text size="sm" c="dimmed">Profile dates and suggested targets are a starting point. Review and save them to create this stay.</Text> : null}
        {!targetSection && <><SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput type="date" label="Arrival date" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} required disabled={mutation.isPending} />
          <TextInput type="date" label="Departure date" description="End boundary; departure day is excluded." value={endDate} onChange={(event) => setEndDate(event.currentTarget.value)} required disabled={mutation.isPending} />
        </SimpleGrid>
        <Text size="sm" c="dimmed">Departure date is the end boundary; progress includes arrival through the previous day.</Text>
        <Select
          label="Position during this stay"
          value={position}
          onChange={(value) => value && setPosition(value as VolunteerStayPosition)}
          data={[{ value: "guide", label: "Guide" }, { value: "social_media", label: "Social Media" }]}
          allowDeselect={false}
          disabled={mutation.isPending}
          required
        /></>}
        <Text size="sm" c="dimmed">{exactMode ? "Set exact totals for the entire saved stay. These override the automatic prorated targets without changing the monthly defaults or the other targets."
          : "Set fair monthly rates for this person's entire stay. If workload varies by month, use a fair blended monthly rate. These values determine the full-stay goals and expected progress to date; editing them recalculates the whole stay. Attendance and punctuality must each meet the saved percentage threshold."}</Text>
        {exactMode && <Checkbox label="Use automatic prorated defaults instead" checked={useAutomatic} onChange={(event) => setUseAutomatic(event.currentTarget.checked)} disabled={mutation.isPending} />}
        {!targetSection && Object.keys(initial.stay?.targetOverrides ?? {}).length > 0 && <Alert color="blue">
          Some targets have exact whole-stay overrides. Edit or reset them from the milestone cards; changing monthly rates here does not replace those overrides.
        </Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {targetKeys.map((key) => (
            <NumberInput
              key={key}
              label={exactMode ? TARGET_LABELS[key].replace("per month", "for entire stay") : TARGET_LABELS[key]}
              value={exactMode ? stayTotals[key] : targets[key]}
              onChange={(value) => exactMode ? setStayTotals((current) => ({ ...current, [key]: value })) : setTargets((current) => ({ ...current, [key]: value }))}
              min={0}
              max={key === "attendancePercent" ? 100 : exactMode ? 10000 : undefined}
              decimalScale={exactMode ? 0 : 2}
              required
              disabled={mutation.isPending || (exactMode && useAutomatic)}
            />
          ))}
        </SimpleGrid>
        <Alert color="blue">Cleaning has no monthly quota. The requirement is every published cleaning shift assigned within this stay, excluding excused or removed assignments. Approved photos are required for photo-managed cleaning.</Alert>
        {!targetSection && <><Text size="sm" fw={600}>Scheduled shift types that count</Text>
        {(position === "guide" ? ["guiding", "promotion"] as const : ["socialMedia"] as const).map((key) => (
          <MultiSelect
            key={key}
            label={key === "socialMedia" ? "Social Media" : key === "guiding" ? "Guiding" : "Promotion"}
            placeholder="Choose shift types"
            data={shiftOptions}
            value={shiftTypeIds[key]}
            onChange={(value) => setShiftTypeIds((current) => ({ ...current, [key]: value }))}
            searchable
            disabled={mutation.isPending}
          />
        ))}</>}
        <Textarea label="Reason for change" description="Required for every edit or any custom seasonal/staffing target." value={changeReason} onChange={(event) => setChangeReason(event.currentTarget.value)} required={reasonRequired} autosize minRows={2} maxLength={2000} disabled={mutation.isPending} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => void save()} loading={mutation.isPending}>Save stay</Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default VolunteerStayEditor;
