
import { useMemo, useState } from "react";
import { Button, Group, Modal, NumberInput, Select, Stack, TextInput, Textarea } from "@mantine/core";
import { DatePickerInput, TimeInput } from "@mantine/dates";
import dayjs from "dayjs";
import type { ShiftInstancePayload, ShiftTemplate } from "../../types/scheduling";


export interface AddShiftInstanceModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (payload: ShiftInstancePayload) => Promise<void>;
  scheduleWeekId: number;
  defaultDate: Date;
  templates: ShiftTemplate[];
}

const AddShiftInstanceModal = ({
  opened,
  onClose,
  onSubmit,
  scheduleWeekId,
  defaultDate,
  templates,
}: AddShiftInstanceModalProps) => {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(defaultDate);
  const [timeStart, setTimeStart] = useState<string>("");
  const [timeEnd, setTimeEnd] = useState<string>("");
  const [capacity, setCapacity] = useState<number | undefined>(undefined);
  const [meta, setMeta] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === Number(templateId)),
    [templates, templateId],
  );

  const handleTemplateChange = (value: string | null) => {
    setTemplateId(value);
    const template = templates.find((item) => item.id === Number(value));
    if (template) {
      setTimeStart(template.defaultStartTime ?? "");
      setTimeEnd(template.defaultEndTime ?? "");
      setCapacity(template.defaultCapacity ?? undefined);
      setMeta(JSON.stringify(template.defaultMeta ?? {}, null, 2));
    } else {
      setTimeStart("");
      setTimeEnd("");
      setCapacity(undefined);
      setMeta("");
    }
  };

  const handleSubmit = async () => {
    if (!date || !timeStart || !selectedTemplate) {
      return;
    }
    setSubmitting(true);
    try {
      const payload: ShiftInstancePayload = {
        scheduleWeekId,
        shiftTypeId: selectedTemplate.shiftTypeId,
        shiftTemplateId: selectedTemplate.id,
        date: dayjs(date).format("YYYY-MM-DD"),
        timeStart,
        timeEnd: timeEnd ? timeEnd : null,
        capacity: capacity ?? null,
        requiredRoles: selectedTemplate.defaultRoles ?? null,
        meta: meta ? JSON.parse(meta) : null,
      };
      await onSubmit(payload);
      onClose();
      setTemplateId(null);
      setTimeStart("");
      setTimeEnd("");
      setCapacity(undefined);
      setMeta("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add shift instance" size="lg">
      <Stack>
        <Select
          label="Template"
          placeholder="Select template"
          data={templates.map((template) => ({
            value: template.id.toString(),
            label: template.name,
          }))}
          value={templateId}
          onChange={handleTemplateChange}
          required
        />
        <DatePickerInput label="Date" value={date} onChange={setDate} required />
        <Group grow>
          <TimeInput
            label="Start time"
            value={timeStart}
            onChange={(value) => setTimeStart(value ?? "")}
            required
          />
          <TimeInput label="End time" value={timeEnd} onChange={(value) => setTimeEnd(value ?? "")} />
        </Group>
        <NumberInput
          label="Capacity"
          value={capacity ?? undefined}
          onChange={(value) => setCapacity(typeof value === "number" ? value : undefined)}
          min={0}
        />
        <Textarea
          label="Metadata (JSON)"
          value={meta}
          onChange={(event) => setMeta(event.currentTarget.value)}
          minRows={3}
        />
        <Button onClick={handleSubmit} loading={submitting} disabled={!templateId || !date || !timeStart}>
          Add shift
        </Button>
      </Stack>
    </Modal>
  );
};

export default AddShiftInstanceModal;
