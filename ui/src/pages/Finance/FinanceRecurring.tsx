import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconPlayerPlay, IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceRecurringRule,
  deleteFinanceRecurringRule,
  executeFinanceRecurringRules,
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceRecurringRules,
} from "../../actions/financeActions";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceRecurringExecution,
  selectFinanceRecurringRules,
} from "../../selectors/financeSelectors";
import { FinanceRecurringRule } from "../../types/finance";

type RecurringDraft = {
  kind: "income" | "expense";
  frequency: FinanceRecurringRule["frequency"];
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  accountId: number | null;
  categoryId: number | null;
  amountMinor: number;
  currency: string;
  description: string | null;
};

const defaultDraft: RecurringDraft = {
  kind: "expense",
  frequency: "monthly",
  interval: 1,
  byMonthDay: null,
  startDate: dayjs().format("YYYY-MM-DD"),
  endDate: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Warsaw",
  accountId: null,
  categoryId: null,
  amountMinor: 0,
  currency: "PLN",
  description: null,
};

const FinanceRecurring = () => {
  const dispatch = useAppDispatch();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const recurring = useAppSelector(selectFinanceRecurringRules);
  const execution = useAppSelector(selectFinanceRecurringExecution);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<RecurringDraft>(defaultDraft);

  useEffect(() => {
    dispatch(fetchFinanceAccounts());
    dispatch(fetchFinanceCategories());
    dispatch(fetchFinanceRecurringRules());
  }, [dispatch]);

  const handleCreateRule = async () => {
    if (!draft.accountId || !draft.categoryId) {
      return;
    }

    const templateJson = {
      kind: draft.kind,
      accountId: draft.accountId,
      currency: draft.currency,
      amountMinor: draft.amountMinor,
      categoryId: draft.categoryId,
      counterpartyType: draft.kind === "expense" ? "vendor" : "client",
      counterpartyId: null,
      status: "planned",
      description: draft.description,
    };

    await dispatch(
      createFinanceRecurringRule({
        kind: draft.kind,
        frequency: draft.frequency,
        interval: draft.interval,
        byMonthDay: draft.byMonthDay,
        startDate: draft.startDate,
        endDate: draft.endDate,
        timezone: draft.timezone,
        templateJson,
      }),
    );

    setModalOpen(false);
    setDraft(defaultDraft);
  };

  const accountOptions = useMemo(
    () =>
      accounts.data.map((account) => ({
        value: String(account.id),
        label: account.name,
      })),
    [accounts.data],
  );

  const categoryOptions = useMemo(
    () =>
      categories.data.map((category) => ({
        value: String(category.id),
        label: `${category.kind === "income" ? "Income" : "Expense"} Â- ${category.name}`,
      })),
    [categories.data],
  );

  const handleExecute = async () => {
    await dispatch(executeFinanceRecurringRules());
    await dispatch(fetchFinanceRecurringRules());
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Recurring Rules</Title>
        <Group>
          <Button
            variant="light"
            leftSection={<IconPlayerPlay size={16} />}
            loading={execution.loading}
            onClick={handleExecute}
          >
            Run now
          </Button>
          <Button leftSection={<IconPlus size={18} />} onClick={() => setModalOpen(true)}>
            New Rule
          </Button>
        </Group>
      </Group>

      <Table striped highlightOnHover withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Schedule</Table.Th>
            <Table.Th>Next Run</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {recurring.data.map((rule) => (
            <Table.Tr key={rule.id}>
              <Table.Td>
                {rule.kind.toUpperCase()} Â- {(rule.templateJson as { amountMinor?: number })?.amountMinor
                  ? ((rule.templateJson as { amountMinor?: number }).amountMinor! / 100).toFixed(2)
                  : "â€”"}
              </Table.Td>
              <Table.Td>
                Every {rule.interval} {rule.frequency}
                {rule.byMonthDay ? ` on day ${rule.byMonthDay}` : ""}
              </Table.Td>
              <Table.Td>{rule.nextRunDate ? dayjs(rule.nextRunDate).format("YYYY-MM-DD") : "â€”"}</Table.Td>
              <Table.Td>{rule.status.toUpperCase()}</Table.Td>
              <Table.Td width={80}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    void dispatch(deleteFinanceRecurringRule(rule.id));
                  }}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="New Recurring Rule" size="xl" centered>
        <Stack gap="md">
          <Group grow>
            <Select
              label="Kind"
              data={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
              value={draft.kind}
              onChange={(value) => setDraft((state) => ({ ...state, kind: (value ?? "expense") as RecurringDraft["kind"] }))}
            />
            <Select
              label="Frequency"
              data={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
                { value: "quarterly", label: "Quarterly" },
                { value: "yearly", label: "Yearly" },
              ]}
              value={draft.frequency}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  frequency: (value ?? "monthly") as FinanceRecurringRule["frequency"],
                }))
              }
            />
            <NumberInput
              label="Interval"
              value={draft.interval}
              min={1}
              onChange={(value) => setDraft((state) => ({ ...state, interval: Number(value) || 1 }))}
            />
            {draft.frequency !== "weekly" && (
              <NumberInput
                label="Day of month"
                value={draft.byMonthDay ?? undefined}
                onChange={(value) =>
                  setDraft((state) => ({
                    ...state,
                    byMonthDay: value ? Number(value) : null,
                  }))
                }
                min={1}
                max={31}
              />
            )}
          </Group>
          <Group grow>
            <DateInput
              label="Start Date"
              value={dayjs(draft.startDate).toDate()}
              onChange={(value) => setDraft((state) => ({ ...state, startDate: dayjs(value).format("YYYY-MM-DD") }))}
            />
            <DateInput
              label="End Date"
              value={draft.endDate ? dayjs(draft.endDate).toDate() : null}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  endDate: value ? dayjs(value).format("YYYY-MM-DD") : null,
                }))
              }
              clearable
            />
            <TextInput
              label="Timezone"
              value={draft.timezone}
              onChange={(event) => setDraft((state) => ({ ...state, timezone: event.currentTarget.value }))}
            />
          </Group>
          <Group grow>
            <Select
              label="Account"
              data={accountOptions}
              value={draft.accountId ? String(draft.accountId) : null}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  accountId: value ? Number(value) : null,
                }))
              }
              searchable
              withAsterisk
            />
            <Select
              label="Category"
              data={categoryOptions}
              value={draft.categoryId ? String(draft.categoryId) : null}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  categoryId: value ? Number(value) : null,
                }))
              }
              searchable
              withAsterisk
            />
            <NumberInput
              label="Amount"
              decimalScale={2}
              value={draft.amountMinor / 100}
              onValueChange={({ value }) =>
                setDraft((state) => ({
                  ...state,
                  amountMinor: Math.round((Number(value) || 0) * 100),
                }))
              }
            />
            <TextInput
              label="Currency"
              value={draft.currency}
              onChange={(event) => setDraft((state) => ({ ...state, currency: event.currentTarget.value.toUpperCase() }))}
              maxLength={3}
            />
          </Group>
          <Textarea
            label="Description"
            minRows={3}
            value={draft.description ?? ""}
            onChange={(event) => setDraft((state) => ({ ...state, description: event.currentTarget.value || null }))}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateRule}>Create rule</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceRecurring;
