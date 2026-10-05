import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  SegmentedControl,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { DatePicker, type DatesRangeValue } from "@mantine/dates";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { StorefrontProductConfig } from "../../types/products/Product";
import type {
  StorefrontAvailabilityBlockedDate,
  StorefrontAvailabilityDateOverride,
} from "../../types/products/Product";
import type {
  StorefrontAddonConfig,
  StorefrontAddonOption,
} from "../../types/productAddons/ProductAddon";

type ProductRulesProps = {
  value: StorefrontProductConfig;
  onChange: (value: StorefrontProductConfig) => void;
  productOptions?: Array<{ value: string; label: string }>;
};

type AvailabilityCalendarMode = "blocked" | "available";

type CalendarRuleState = {
  kind: "blocked" | "redirect";
  label: string;
};

const dateInputPattern = /^\d{4}-\d{2}-\d{2}$/;

const dateKeyFromDate = (date: Date | null): string => {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateFromDateKey = (value: string): Date | null => {
  if (!dateInputPattern.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const enumerateDateRange = (startDate: Date | null, endDate: Date | null): string[] => {
  if (!startDate) return [];
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endSource = endDate ?? startDate;
  const end = new Date(endSource.getFullYear(), endSource.getMonth(), endSource.getDate());
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const dates: string[] = [];
  const cursor = new Date(first);
  while (cursor <= last) {
    dates.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const sortByDate = <T extends { date: string }>(items: T[]): T[] =>
  [...items].sort((left, right) => left.date.localeCompare(right.date));

const formatRuleDate = (value: string): string => {
  const date = dateFromDateKey(value);
  if (!date) return value || "No date";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const cleanAvailability = (
  availability: StorefrontProductConfig["availability"] | undefined,
): StorefrontProductConfig["availability"] | undefined => {
  if (!availability) return undefined;
  const cutoffMinutes =
    availability.cutoffMinutes === undefined || availability.cutoffMinutes === null
      ? undefined
      : Math.max(0, Math.trunc(Number(availability.cutoffMinutes) || 0));
  const blockedDates = (availability.blockedDates ?? [])
    .filter((rule) => rule.date)
    .map((rule) => ({
      date: rule.date,
      ...(rule.reason?.trim() ? { reason: rule.reason.trim() } : {}),
      ...(rule.redirectProductId ? { redirectProductId: Number(rule.redirectProductId) } : {}),
    }));
  const dateOverrides = (availability.dateOverrides ?? [])
    .filter((rule) => rule.date)
    .map((rule) => ({
      date: rule.date,
      enabled: rule.enabled !== false,
      mode: rule.mode ?? "available",
      ...(rule.cutoffMinutes === undefined || rule.cutoffMinutes === null
        ? {}
        : { cutoffMinutes: Math.max(0, Math.trunc(Number(rule.cutoffMinutes) || 0)) }),
      ...(rule.reason?.trim() ? { reason: rule.reason.trim() } : {}),
      ...(rule.redirectProductId ? { redirectProductId: Number(rule.redirectProductId) } : {}),
    }));

  const cleaned = {
    ...(cutoffMinutes !== undefined ? { cutoffMinutes } : {}),
    ...(blockedDates.length > 0 ? { blockedDates } : {}),
    ...(dateOverrides.length > 0 ? { dateOverrides } : {}),
  };
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

export const cleanProductStorefrontConfig = (
  config: StorefrontProductConfig,
): StorefrontProductConfig => {
  const cleaned = { ...config };
  const availability = cleanAvailability(cleaned.availability);
  if (availability) cleaned.availability = availability;
  else delete cleaned.availability;
  return cleaned;
};

export const ProductStorefrontRulesEditor = ({
  value,
  onChange,
  productOptions = [],
}: ProductRulesProps) => {
  const update = <K extends keyof StorefrontProductConfig>(
    key: K,
    nextValue: StorefrontProductConfig[K],
  ) => onChange({ ...value, [key]: nextValue });
  const availability = value.availability ?? {};
  const updateAvailability = (
    nextAvailability: StorefrontProductConfig["availability"],
  ) => {
    const cleaned = cleanAvailability(nextAvailability);
    const nextConfig = { ...value };
    if (cleaned) nextConfig.availability = cleaned;
    else delete nextConfig.availability;
    onChange(nextConfig);
  };
  const updateBlockedDate = (
    index: number,
    patch: Partial<StorefrontAvailabilityBlockedDate>,
  ) => {
    const blockedDates = [...(availability.blockedDates ?? [])];
    blockedDates[index] = { ...blockedDates[index], ...patch };
    updateAvailability({ ...availability, blockedDates });
  };
  const updateDateOverride = (
    index: number,
    patch: Partial<StorefrontAvailabilityDateOverride>,
  ) => {
    const dateOverrides = [...(availability.dateOverrides ?? [])];
    dateOverrides[index] = { ...dateOverrides[index], ...patch };
    updateAvailability({ ...availability, dateOverrides });
  };
  const [calendarMode, setCalendarMode] = useState<AvailabilityCalendarMode>("blocked");
  const [calendarRange, setCalendarRange] = useState<DatesRangeValue>([null, null]);
  const [calendarMessage, setCalendarMessage] = useState("");
  const [calendarRedirectProductId, setCalendarRedirectProductId] = useState<string | null>(null);
  const [calendarCutoffMinutes, setCalendarCutoffMinutes] = useState<number | "">(
    availability.cutoffMinutes ?? 0,
  );
  const selectedCalendarDates = useMemo(
    () => enumerateDateRange(calendarRange[0], calendarRange[1] ?? calendarRange[0]),
    [calendarRange],
  );
  const productLabelById = useMemo(
    () =>
      new Map(
        productOptions.map((option) => [Number(option.value), option.label]),
      ),
    [productOptions],
  );
  const calendarRuleByDate = useMemo(() => {
    const rules = new Map<string, CalendarRuleState>();
    (availability.blockedDates ?? []).forEach((rule) => {
      if (!rule.date) return;
      const redirectLabel = rule.redirectProductId
        ? productLabelById.get(Number(rule.redirectProductId)) ?? "another product"
        : "";
      rules.set(rule.date, {
        kind: rule.redirectProductId ? "redirect" : "blocked",
        label: redirectLabel ? `Redirects to ${redirectLabel}` : rule.reason || "Blocked date",
      });
    });
    (availability.dateOverrides ?? []).forEach((rule) => {
      if (!rule.date || rule.enabled === false) return;
      if ((rule.mode ?? "available") === "blocked") {
        const redirectLabel = rule.redirectProductId
          ? productLabelById.get(Number(rule.redirectProductId)) ?? "another product"
          : "";
        rules.set(rule.date, {
          kind: rule.redirectProductId ? "redirect" : "blocked",
          label: redirectLabel ? `Redirects to ${redirectLabel}` : rule.reason || "Blocked override",
        });
        return;
      }
      rules.delete(rule.date);
    });
    return rules;
  }, [availability.blockedDates, availability.dateOverrides, productLabelById]);
  const getCalendarDayProps = (date: Date) => {
    const dateKey = dateKeyFromDate(date);
    const rule = calendarRuleByDate.get(dateKey);
    if (!rule) return {};
    const tone = rule.kind === "redirect"
        ? {
            background: "var(--mantine-color-yellow-0)",
            borderColor: "var(--mantine-color-yellow-5)",
            color: "var(--mantine-color-yellow-9)",
          }
        : {
            background: "var(--mantine-color-red-0)",
            borderColor: "var(--mantine-color-red-5)",
            color: "var(--mantine-color-red-9)",
          };
    return {
      title: rule.label,
      "aria-label": `${formatRuleDate(dateKey)}. ${rule.label}`,
      style: {
        ...tone,
        borderStyle: "solid",
        borderWidth: 1,
        fontWeight: 800,
      },
    };
  };
  const renderCalendarDay = (date: Date) => {
    const rule = calendarRuleByDate.get(dateKeyFromDate(date));
    const color = rule?.kind === "redirect"
        ? "var(--mantine-color-yellow-6)"
        : "var(--mantine-color-red-6)";
    return (
      <Box
        component="span"
        style={{
          alignItems: "center",
          display: "inline-flex",
          flexDirection: "column",
          gap: 2,
          lineHeight: 1,
        }}
      >
        <span>{date.getDate()}</span>
        {rule && (
          <Box
            component="span"
            aria-hidden="true"
            style={{
              background: color,
              borderRadius: 999,
              height: 4,
              width: 14,
            }}
          />
        )}
      </Box>
    );
  };
  const applyCalendarRange = () => {
    if (selectedCalendarDates.length === 0) return;
    const selectedDateSet = new Set(selectedCalendarDates);

    if (calendarMode === "blocked") {
      const nextBlockedDates = sortByDate([
        ...(availability.blockedDates ?? []).filter((rule) => !selectedDateSet.has(rule.date)),
        ...selectedCalendarDates.map((date) => ({
          date,
          ...(calendarMessage.trim() ? { reason: calendarMessage.trim() } : {}),
          ...(calendarRedirectProductId
            ? { redirectProductId: Number(calendarRedirectProductId) }
            : {}),
        })),
      ]);
      updateAvailability({
        ...availability,
        blockedDates: nextBlockedDates,
        dateOverrides: (availability.dateOverrides ?? []).filter(
          (rule) => !selectedDateSet.has(rule.date),
        ),
      });
    } else {
      const cutoffMinutes = calendarCutoffMinutes === ""
        ? undefined
        : Math.max(0, Math.trunc(Number(calendarCutoffMinutes) || 0));
      const nextDateOverrides = sortByDate([
        ...(availability.dateOverrides ?? []).filter((rule) => !selectedDateSet.has(rule.date)),
        ...selectedCalendarDates.map((date) => ({
          date,
          enabled: true,
          mode: "available" as const,
          ...(cutoffMinutes === undefined ? {} : { cutoffMinutes }),
          ...(calendarMessage.trim() ? { reason: calendarMessage.trim() } : {}),
        })),
      ]);
      updateAvailability({
        ...availability,
        dateOverrides: nextDateOverrides,
      });
    }

    setCalendarRange([null, null]);
    setCalendarMessage("");
  };
  const content = value.content ?? {};
  const meetingPoint = content.meetingPoint ?? {};
  const updateContent = <K extends keyof typeof content>(
    key: K,
    nextValue: (typeof content)[K],
  ) => onChange({ ...value, content: { ...content, [key]: nextValue } });
  const updateMeetingPoint = <K extends keyof typeof meetingPoint>(
    key: K,
    nextValue: (typeof meetingPoint)[K],
  ) =>
    onChange({
      ...value,
      content: {
        ...content,
        meetingPoint: { ...meetingPoint, [key]: nextValue },
      },
    });

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>Storefront booking rules</Text>
          <Text size="sm" c="dimmed">
            Control what guests choose and which details are required at checkout.
          </Text>
        </div>
        <Divider />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Participant input"
            description="Use one total or separate counts by gender."
            data={[
              { value: "quantity", label: "Total quantity" },
              { value: "gender_split", label: "Women and men separately" },
            ]}
            value={value.participantMode ?? "quantity"}
            allowDeselect={false}
            onChange={(next) =>
              update("participantMode", next as StorefrontProductConfig["participantMode"])
            }
          />
          <Group grow align="flex-start">
            <NumberInput
              label="Minimum guests"
              min={0}
              allowDecimal={false}
              value={value.minParticipants ?? ""}
              placeholder="No minimum"
              onChange={(next) =>
                update("minParticipants", next === "" ? undefined : Number(next))
              }
            />
            <NumberInput
              label="Maximum guests"
              min={1}
              allowDecimal={false}
              value={value.maxParticipants ?? ""}
              placeholder="No maximum"
              onChange={(next) =>
                update("maxParticipants", next === "" ? undefined : Number(next))
              }
            />
          </Group>
        </SimpleGrid>
        <Switch
          label="Require booking date"
          description="Guests must select a date before adding this product to the cart."
          checked={value.dateRequired === true}
          onChange={(event) => update("dateRequired", event.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Start-time selection"
            data={[
              { value: "fixed", label: "One fixed time" },
              { value: "select", label: "Choose from a list" },
              { value: "manual", label: "Guest enters a time" },
            ]}
            value={value.timeMode ?? "manual"}
            allowDeselect={false}
            onChange={(next) =>
              update("timeMode", next as StorefrontProductConfig["timeMode"])
            }
          />
          {value.timeMode === "fixed" && (
            <TextInput
              type="time"
              label="Fixed start time"
              value={value.defaultStartTime ?? ""}
              onChange={(event) => update("defaultStartTime", event.currentTarget.value)}
            />
          )}
        </SimpleGrid>
        {value.timeMode === "select" && (
          <TagsInput
            label="Available start times"
            description="Type a time such as 10:00 and press Enter."
            placeholder="Add a start time"
            value={value.startTimes ?? []}
            onChange={(times) => update("startTimes", times)}
            splitChars={[",", " "]}
          />
        )}
        <Divider label="Booking availability" labelPosition="left" />
        <Text size="sm" c="dimmed">
          Block full dates, stop late bookings before the start time, or redirect special dates to another product.
        </Text>
        <NumberInput
          label="Default booking cutoff"
          description="Bookings close this many minutes before the start time unless a date override changes it."
          min={0}
          allowDecimal={false}
          value={availability.cutoffMinutes ?? 0}
          onChange={(next) =>
            updateAvailability({
              ...availability,
              cutoffMinutes: next === "" ? undefined : Number(next),
            })
          }
        />
        <Paper
          withBorder
          radius="lg"
          p="md"
          style={{
            background:
              "linear-gradient(135deg, rgba(34,139,230,0.08), rgba(255,255,255,0.9))",
          }}
        >
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="sm" fw={700}>Calendar rules</Text>
                  <Text size="xs" c="dimmed">
                    Select a start and finish date. The rule will be created for every day in the range.
                  </Text>
                </div>
                <Badge variant="light" color={selectedCalendarDates.length > 0 ? "blue" : "gray"}>
                  {selectedCalendarDates.length || "No"} day{selectedCalendarDates.length === 1 ? "" : "s"}
                </Badge>
              </Group>
              <Box
                style={{
                  background: "var(--mantine-color-body)",
                  border: "1px solid var(--mantine-color-gray-2)",
                  borderRadius: 16,
                  display: "grid",
                  justifyItems: "center",
                  overflowX: "auto",
                  padding: 12,
                }}
              >
                <DatePicker
                  type="range"
                  value={calendarRange}
                  onChange={setCalendarRange}
                  allowSingleDateInRange
                  numberOfColumns={2}
                  getDayProps={getCalendarDayProps}
                  renderDay={renderCalendarDay}
                />
              </Box>
              <Group gap="xs">
                <Badge color="red" variant="light">Blocked</Badge>
                <Badge color="yellow" variant="light">Redirect</Badge>
              </Group>
            </Stack>
            <Stack gap="md">
              <SegmentedControl
                fullWidth
                value={calendarMode}
                onChange={(next) => setCalendarMode(next as AvailabilityCalendarMode)}
                data={[
                  { value: "blocked", label: "Block dates" },
                  { value: "available", label: "Allow dates" },
                ]}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Start date"
                  value={selectedCalendarDates[0] ?? ""}
                  placeholder="Select on calendar"
                  readOnly
                />
                <TextInput
                  label="Finish date"
                  value={selectedCalendarDates[selectedCalendarDates.length - 1] ?? ""}
                  placeholder="Select on calendar"
                  readOnly
                />
              </SimpleGrid>
              <TextInput
                label={calendarMode === "blocked" ? "Customer message" : "Internal note"}
                placeholder={calendarMode === "blocked"
                  ? "New Year's Eve Pub Crawl"
                  : "Reopened for extra capacity"}
                value={calendarMessage}
                onChange={(event) => setCalendarMessage(event.currentTarget.value)}
              />
              {calendarMode === "blocked" ? (
                <Select
                  label="Redirect product"
                  description="Optional. Use this when a special event replaces the normal product."
                  placeholder="No redirect"
                  clearable
                  searchable
                  data={productOptions}
                  value={calendarRedirectProductId}
                  onChange={setCalendarRedirectProductId}
                />
              ) : (
                <NumberInput
                  label="Cutoff minutes for this range"
                  description="Use 0 to keep bookings open until the start time."
                  min={0}
                  allowDecimal={false}
                  value={calendarCutoffMinutes}
                  onChange={(next) =>
                    setCalendarCutoffMinutes(next === "" ? "" : Number(next))
                  }
                />
              )}
              <Button
                leftSection={<IconPlus size={16} />}
                disabled={selectedCalendarDates.length === 0}
                onClick={applyCalendarRange}
              >
                {calendarMode === "blocked" ? "Block selected range" : "Allow selected range"}
              </Button>
              <Text size="xs" c="dimmed">
                Existing dates in the selected range are updated instead of duplicated.
              </Text>
            </Stack>
          </SimpleGrid>
        </Paper>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end">
            <div>
              <Text size="sm" fw={500}>Blocked date details</Text>
              <Text size="xs" c="dimmed">Review, edit, or remove the individual blocked dates created from the calendar.</Text>
            </div>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                updateAvailability({
                  ...availability,
                  blockedDates: [
                    ...(availability.blockedDates ?? []),
                    { date: "", reason: "", redirectProductId: null },
                  ],
                })
              }
            >
              Add one date
            </Button>
          </Group>
          {(availability.blockedDates ?? []).length === 0 ? (
            <Text size="sm" c="dimmed">No blocked dates.</Text>
          ) : (
            <Stack gap="xs">
              {(availability.blockedDates ?? []).map((rule, index) => (
                <Paper key={`blocked-${index}`} withBorder radius="sm" p="sm">
                  <SimpleGrid cols={{ base: 1, sm: 3 }}>
                    <TextInput
                      type="date"
                      label="Date"
                      value={rule.date ?? ""}
                      onChange={(event) => updateBlockedDate(index, { date: event.currentTarget.value })}
                    />
                    <TextInput
                      label="Message"
                      placeholder="This date has a special event."
                      value={rule.reason ?? ""}
                      onChange={(event) => updateBlockedDate(index, { reason: event.currentTarget.value })}
                    />
                    <Select
                      label="Redirect product"
                      placeholder="No redirect"
                      clearable
                      searchable
                      data={productOptions}
                      value={rule.redirectProductId ? String(rule.redirectProductId) : null}
                      onChange={(selected) =>
                        updateBlockedDate(index, {
                          redirectProductId: selected ? Number(selected) : null,
                        })
                      }
                    />
                  </SimpleGrid>
                  <Group justify="flex-end" mt="xs">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label="Remove blocked date"
                      onClick={() =>
                        updateAvailability({
                          ...availability,
                          blockedDates: (availability.blockedDates ?? []).filter((_, ruleIndex) => ruleIndex !== index),
                        })
                      }
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end">
            <div>
              <Text size="sm" fw={500}>Date override details</Text>
              <Text size="xs" c="dimmed">Review, edit, or remove single-day rules that reopen dates or change cutoff times.</Text>
            </div>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                updateAvailability({
                  ...availability,
                  dateOverrides: [
                    ...(availability.dateOverrides ?? []),
                    {
                      date: "",
                      enabled: true,
                      mode: "available",
                      cutoffMinutes: 0,
                    },
                  ],
                })
              }
            >
              Add one override
            </Button>
          </Group>
          {(availability.dateOverrides ?? []).length === 0 ? (
            <Text size="sm" c="dimmed">No date overrides.</Text>
          ) : (
            <Stack gap="xs">
              {(availability.dateOverrides ?? []).map((rule, index) => (
                <Paper key={`override-${index}`} withBorder radius="sm" p="sm">
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput
                      type="date"
                      label="Date"
                      value={rule.date ?? ""}
                      onChange={(event) => updateDateOverride(index, { date: event.currentTarget.value })}
                    />
                    <Switch
                      label="Override is active"
                      checked={rule.enabled !== false}
                      onChange={(event) => updateDateOverride(index, { enabled: event.currentTarget.checked })}
                    />
                    <Select
                      label="Override action"
                      data={[
                        { value: "available", label: "Allow booking" },
                        { value: "blocked", label: "Block booking" },
                      ]}
                      value={rule.mode ?? "available"}
                      allowDeselect={false}
                      onChange={(selected) =>
                        updateDateOverride(index, {
                          mode: selected as StorefrontAvailabilityDateOverride["mode"],
                        })
                      }
                    />
                    <NumberInput
                      label="Cutoff minutes"
                      description="Used when bookings are allowed."
                      min={0}
                      allowDecimal={false}
                      value={rule.cutoffMinutes ?? 0}
                      disabled={(rule.mode ?? "available") === "blocked"}
                      onChange={(next) =>
                        updateDateOverride(index, {
                          cutoffMinutes: next === "" ? undefined : Number(next),
                        })
                      }
                    />
                    <TextInput
                      label="Message"
                      placeholder="Optional customer-facing note"
                      value={rule.reason ?? ""}
                      onChange={(event) => updateDateOverride(index, { reason: event.currentTarget.value })}
                    />
                    <Select
                      label="Redirect product"
                      placeholder="No redirect"
                      clearable
                      searchable
                      data={productOptions}
                      value={rule.redirectProductId ? String(rule.redirectProductId) : null}
                      onChange={(selected) =>
                        updateDateOverride(index, {
                          redirectProductId: selected ? Number(selected) : null,
                        })
                      }
                    />
                  </SimpleGrid>
                  <Group justify="flex-end" mt="xs">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label="Remove date override"
                      onClick={() =>
                        updateAvailability({
                          ...availability,
                          dateOverrides: (availability.dateOverrides ?? []).filter((_, ruleIndex) => ruleIndex !== index),
                        })
                      }
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
        <Divider label="Guest details" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Switch
            label="Require full name"
            checked={value.fullNameRequired === true}
            onChange={(event) => update("fullNameRequired", event.currentTarget.checked)}
          />
          <Switch
            label="Require email"
            checked={value.emailRequired === true}
            onChange={(event) => update("emailRequired", event.currentTarget.checked)}
          />
          <Switch
            label="Require phone"
            checked={value.phoneRequired === true}
            onChange={(event) => update("phoneRequired", event.currentTarget.checked)}
          />
        </SimpleGrid>
        <Divider label="Product information" labelPosition="left" />
        <Text size="sm" c="dimmed">
          This content is returned by the storefront product API. Empty sections stay hidden on the website.
        </Text>
        <Textarea
          label="Summary"
          description="A short introduction shown near the product title."
          minRows={2}
          autosize
          value={content.summary ?? ""}
          onChange={(event) => updateContent("summary", event.currentTarget.value)}
        />
        <Textarea
          label="Description"
          description="The full description of the experience."
          minRows={4}
          autosize
          value={content.description ?? ""}
          onChange={(event) => updateContent("description", event.currentTarget.value)}
        />
        <TagsInput
          label="Highlights"
          description="Enter each highlight separately and press Enter."
          placeholder="Add a highlight"
          value={content.highlights ?? []}
          onChange={(items) => updateContent("highlights", items)}
        />
        <TagsInput
          label="Important information"
          description="Enter each instruction or requirement separately and press Enter."
          placeholder="Add important information"
          value={content.importantInformation ?? []}
          onChange={(items) => updateContent("importantInformation", items)}
        />
        <Divider label="Meeting point" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Meeting point name"
            placeholder="e.g. Adam Mickiewicz Monument"
            value={meetingPoint.name ?? ""}
            onChange={(event) => updateMeetingPoint("name", event.currentTarget.value)}
          />
          <TextInput
            label="Address"
            placeholder="Street address or square"
            value={meetingPoint.address ?? ""}
            onChange={(event) => updateMeetingPoint("address", event.currentTarget.value)}
          />
        </SimpleGrid>
        <Textarea
          label="Meeting instructions"
          description="Explain how guests can identify the guide or exact meeting location."
          minRows={2}
          autosize
          value={meetingPoint.instructions ?? ""}
          onChange={(event) => updateMeetingPoint("instructions", event.currentTarget.value)}
        />
        <TextInput
          label="Google Maps URL"
          placeholder="https://maps.google.com/..."
          value={meetingPoint.mapUrl ?? ""}
          onChange={(event) => updateMeetingPoint("mapUrl", event.currentTarget.value)}
        />
      </Stack>
    </Paper>
  );
};

type AddonRulesProps = {
  value: StorefrontAddonConfig;
  onChange: (value: StorefrontAddonConfig) => void;
};

const emptyOption = (): StorefrontAddonOption => ({ value: "", label: "" });

export const AddonStorefrontRulesEditor = ({ value, onChange }: AddonRulesProps) => {
  const mode = value.selectionMode ?? "boolean";
  const quantities = value.allowedQuantities ?? [];
  const prices = value.quantityPrices ?? {};
  const options = value.options ?? [];

  const updateOption = (index: number, patch: Partial<StorefrontAddonOption>) => {
    onChange({
      ...value,
      options: options.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option,
      ),
    });
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>Storefront selection rules</Text>
          <Text size="sm" c="dimmed">
            Choose how guests add this extra during checkout.
          </Text>
        </div>
        <Divider />
        <Select
          label="Selection style"
          data={[
            { value: "boolean", label: "Simple yes / no" },
            { value: "quantity", label: "Choose specific quantities" },
            { value: "range", label: "Quantity range" },
            { value: "options", label: "Choose from named options" },
          ]}
          value={mode}
          allowDeselect={false}
          onChange={(next) => {
            const nextMode = next as StorefrontAddonConfig["selectionMode"];
            onChange({
              ...value,
              selectionMode: nextMode,
              ...(nextMode === "quantity" && quantities.length === 0
                ? { allowedQuantities: [1] }
                : {}),
              ...(nextMode === "range"
                ? {
                    minQuantity: value.minQuantity ?? 1,
                    maxQuantity: value.maxQuantity ?? Math.max(value.minQuantity ?? 1, 1),
                  }
                : {}),
            });
          }}
        />

        {mode === "quantity" && (
          <>
            <TagsInput
              label="Allowed quantities"
              description="Enter each permitted quantity and press Enter, for example 1, 3, 5."
              placeholder="Add quantity"
              value={quantities.map(String)}
              onChange={(items) => {
                const normalized = Array.from(
                  new Set(
                    items
                      .map(Number)
                      .filter((item) => Number.isInteger(item) && item > 0),
                  ),
                ).sort((a, b) => a - b);
                const nextPrices = Object.fromEntries(
                  Object.entries(prices).filter(([quantity]) =>
                    normalized.includes(Number(quantity)),
                  ),
                );
                onChange({
                  ...value,
                  allowedQuantities: normalized,
                  quantityPrices: nextPrices,
                });
              }}
              splitChars={[",", " "]}
            />
            {quantities.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>Optional bundle prices</Text>
                <Text size="xs" c="dimmed">
                  Set a total price for a quantity, or leave it blank to use normal pricing.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {quantities.map((quantity) => (
                    <NumberInput
                      key={quantity}
                      label={`${quantity} units`}
                      min={0}
                      decimalScale={2}
                      placeholder="Default pricing"
                      value={prices[String(quantity)] ?? ""}
                      onChange={(next) => {
                        const nextPrices = { ...prices };
                        if (next === "") delete nextPrices[String(quantity)];
                        else nextPrices[String(quantity)] = Number(next);
                        onChange({ ...value, quantityPrices: nextPrices });
                      }}
                    />
                  ))}
                </SimpleGrid>
              </Stack>
            )}
          </>
        )}

        {mode === "range" && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NumberInput
              label="Minimum quantity"
              description="Smallest quantity a guest can select."
              min={1}
              allowDecimal={false}
              value={value.minQuantity ?? 1}
              onChange={(next) => {
                const minimum = next === "" ? 1 : Math.max(1, Number(next));
                onChange({
                  ...value,
                  minQuantity: minimum,
                  maxQuantity: Math.max(minimum, value.maxQuantity ?? minimum),
                });
              }}
            />
            <NumberInput
              label="Maximum quantity"
              description="Largest quantity a guest can select."
              min={value.minQuantity ?? 1}
              allowDecimal={false}
              value={value.maxQuantity ?? value.minQuantity ?? 1}
              onChange={(next) =>
                onChange({
                  ...value,
                  maxQuantity: Math.max(
                    value.minQuantity ?? 1,
                    next === "" ? value.minQuantity ?? 1 : Number(next),
                  ),
                })
              }
            />
          </SimpleGrid>
        )}

        {mode === "options" && (
          <Stack gap="sm">
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={500}>Options</Text>
                <Text size="xs" c="dimmed">Create the choices shown to guests.</Text>
              </div>
              <Button
                variant="light"
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => onChange({ ...value, options: [...options, emptyOption()] })}
              >
                Add option
              </Button>
            </Group>
            {options.length === 0 && (
              <Text size="sm" c="dimmed">No options added yet.</Text>
            )}
            {options.map((option, index) => (
              <Paper key={index} withBorder radius="sm" p="sm">
                <Group align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Label"
                    placeholder="e.g. Champagne"
                    value={option.label}
                    style={{ flex: 2 }}
                    onChange={(event) => {
                      const label = event.currentTarget.value;
                      const generatedValue = label
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, "");
                      updateOption(index, {
                        label,
                        value: option.value || generatedValue,
                      });
                    }}
                  />
                  <TextInput
                    label="Internal value"
                    placeholder="champagne"
                    value={option.value}
                    style={{ flex: 1.5 }}
                    onChange={(event) => updateOption(index, { value: event.currentTarget.value })}
                  />
                  <NumberInput
                    label="Price"
                    placeholder="Default"
                    min={0}
                    decimalScale={2}
                    value={option.price ?? ""}
                    style={{ flex: 1 }}
                    onChange={(next) =>
                      updateOption(index, { price: next === "" ? undefined : Number(next) })
                    }
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size="lg"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        options: options.filter((_, optionIndex) => optionIndex !== index),
                      })
                    }
                  >
                    <IconTrash size={17} />
                  </ActionIcon>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};
