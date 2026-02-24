export const WALK_IN_TICKET_TYPE_VALUES = [
  "normal",
  "second_timers",
  "third_timers",
  "half_price",
  "students",
  "group",
] as const;

export type WalkInTicketType = (typeof WALK_IN_TICKET_TYPE_VALUES)[number];

export const WALK_IN_TICKET_TYPE_LABELS: Record<WalkInTicketType, string> = {
  normal: "Normal",
  second_timers: "Second Timers",
  third_timers: "Third Timers",
  half_price: "Half Price",
  students: "Students",
  group: "Group",
};

export const WALK_IN_TICKET_LABEL_TO_KEY: Record<string, WalkInTicketType> = {
  Normal: "normal",
  "Second Timers": "second_timers",
  "Third Timers": "third_timers",
  "Half Price": "half_price",
  Students: "students",
  Group: "group",
};

export const WALK_IN_TICKET_TYPE_OPTIONS = WALK_IN_TICKET_TYPE_VALUES.map((value) => ({
  value,
  label: WALK_IN_TICKET_TYPE_LABELS[value],
}));
