import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconPencil, IconPlus, IconRefresh, IconRoute, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import {
  useBulkUpdateFinanceSettlementRules,
  useCreateFinanceSettlementRule,
  useDeleteFinanceSettlementRule,
  useFinanceSettlementRules,
  useUpdateFinanceSettlementRule,
} from "../../api/settlementRules";
import { useActiveUsers } from "../../api/users";
import { useVolunteerFunds } from "../../api/volunteerFunds";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useAppSelector } from "../../store/hooks";
import type { CompensationComponent } from "../../types/compensation/CompensationComponent";
import type {
  FinanceSettlementRule,
  FinanceSettlementRulePayload,
  SettlementDestination,
  SettlementRuleMatchKind,
  SettlementRuleTargetScope,
} from "../../types/finance";
import type { ServerResponse } from "../../types/general/ServerResponse";

const STAFF_TYPE_OPTIONS = [
  { value: "volunteer", label: "Volunteer" },
  { value: "long_term", label: "Long Term" },
  { value: "assistant_manager", label: "Assistant Manager" },
  { value: "manager", label: "Manager" },
  { value: "guide", label: "Guide" },
];

const TARGET_SCOPE_OPTIONS = [
  { value: "staff_type", label: "Staff type" },
  { value: "user", label: "Specific user" },
  { value: "global", label: "Everyone" },
];

const MATCH_KIND_OPTIONS = [
  { value: "default", label: "Default for everything else" },
  { value: "component", label: "Specific compensation component" },
  { value: "component_category", label: "Component category" },
  { value: "system_source", label: "System source" },
];

const SYSTEM_SOURCE_OPTIONS = [
  { value: "guide_commission", label: "Guide Commission" },
  { value: "promotion_sales", label: "Promotion Sales" },
  { value: "reimbursement", label: "Reimbursements" },
  { value: "carry_forward_personal", label: "Previous Personal Balance" },
  { value: "manual_adjustment", label: "Manual Adjustments" },
];

const isStartedRule = (rule: FinanceSettlementRule) =>
  !rule.effectiveStart || rule.effectiveStart <= dayjs().endOf("month").format("YYYY-MM-DD");

const DESTINATION_OPTIONS = [
  { value: "staff_vendor", label: "Pay staff vendor" },
  { value: "volunteer_fund", label: "Allocate to volunteer fund" },
  { value: "excluded", label: "Exclude from settlement" },
];

type RuleDraft = {
  targetScope: SettlementRuleTargetScope;
  staffType: string | null;
  userId: string | null;
  matchKind: SettlementRuleMatchKind;
  matchKey: string | null;
  componentId: string | null;
  destination: SettlementDestination;
  fundId: string | null;
  effectiveStart: string;
  effectiveEnd: string;
  isActive: boolean;
};

const createEmptyDraft = (): RuleDraft => ({
  targetScope: "staff_type",
  staffType: "volunteer",
  userId: null,
  matchKind: "default",
  matchKey: null,
  componentId: null,
  destination: "volunteer_fund",
  fundId: null,
  effectiveStart: dayjs().add(1, "month").startOf("month").format("YYYY-MM-DD"),
  effectiveEnd: "",
  isActive: true,
});

const extractErrorMessage = (error: unknown, fallback: string): string => {
  const responseData = (error as { response?: { data?: unknown } })?.response?.data;
  const candidate = Array.isArray(responseData) ? responseData[0] : responseData;
  if (candidate && typeof candidate === "object" && "message" in candidate) {
    const message = (candidate as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
};

const destinationMeta = (destination: SettlementDestination) => {
  if (destination === "volunteer_fund") {
    return { label: "Volunteer fund", color: "violet" };
  }
  if (destination === "excluded") {
    return { label: "Excluded", color: "gray" };
  }
  return { label: "Staff vendor", color: "teal" };
};

const formatStaffType = (staffType: string | null) =>
  STAFF_TYPE_OPTIONS.find((option) => option.value === staffType)?.label ?? staffType ?? "Any staff type";

const PayoutRoutingPanel = () => {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const access = useModuleAccess("compensation-component-management");
  const roleSlug = useAppSelector((state) => state.session.roleSlug ?? null);
  const normalizedRole = String(roleSlug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  const canManageRouting = normalizedRole === "admin"
    || normalizedRole === "administrator"
    || normalizedRole === "owner";
  const rulesQuery = useFinanceSettlementRules();
  const fundsQuery = useVolunteerFunds();
  const usersQuery = useActiveUsers({ enabled: access.canView });
  const createRule = useCreateFinanceSettlementRule();
  const updateRule = useUpdateFinanceSettlementRule();
  const deleteRule = useDeleteFinanceSettlementRule();
  const bulkUpdate = useBulkUpdateFinanceSettlementRules();
  const componentState = useAppSelector((state) => state.compensationComponents)[0];

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FinanceSettlementRule | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(() => createEmptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [staffTypeFilter, setStaffTypeFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDestination, setBulkDestination] = useState<SettlementDestination>("volunteer_fund");
  const [bulkFundId, setBulkFundId] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const components = useMemo<CompensationComponent[]>(() => {
    const payload = (componentState.data as ServerResponse<CompensationComponent> | undefined) ?? [];
    return [...(payload[0]?.data ?? [])];
  }, [componentState.data]);

  const componentLookup = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );
  const componentOptions = useMemo(
    () => components.map((component) => ({ value: String(component.id), label: component.name })),
    [components],
  );
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(["review", ...components.map((component) => component.category)]))
        .sort()
        .map((category) => ({
          value: category,
          label: category.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        })),
    [components],
  );
  const funds = useMemo(() => fundsQuery.data?.funds ?? [], [fundsQuery.data?.funds]);
  const fundOptions = funds
    .filter((fund) => fund.isActive)
    .map((fund) => ({ value: String(fund.id), label: `${fund.name} (${fund.currency})` }));
  const fundLookup = useMemo(() => new Map(funds.map((fund) => [fund.id, fund.name])), [funds]);
  const userOptions = useMemo(() => {
    const options = (usersQuery.data ?? []).map((user) => ({
      value: String(user.id),
      label: `${user.firstName} ${user.lastName}`.trim() || user.email || `User #${user.id}`,
    }));
    if (
      editingRule?.userId &&
      !options.some((option) => option.value === String(editingRule.userId))
    ) {
      options.push({
        value: String(editingRule.userId),
        label: editingRule.userName ?? `User #${editingRule.userId}`,
      });
    }
    return options;
  }, [editingRule, usersQuery.data]);

  const rules = useMemo(() => rulesQuery.data?.rules ?? [], [rulesQuery.data?.rules]);
  const filteredRules = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (staffTypeFilter && rule.staffType !== staffTypeFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const componentName = rule.componentName ?? componentLookup.get(rule.componentId ?? -1)?.name ?? "";
      return [
        formatStaffType(rule.staffType),
        rule.userName,
        componentName,
        rule.matchKey,
        rule.fundName,
        rule.fundId ? fundLookup.get(rule.fundId) : null,
        destinationMeta(rule.destination).label,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [componentLookup, fundLookup, rules, search, staffTypeFilter]);

  const submitting = createRule.isPending || updateRule.isPending;
  const editingStartedRule = Boolean(
    editingRule
    && (!editingRule.effectiveStart || editingRule.effectiveStart <= dayjs().endOf("month").format("YYYY-MM-DD")),
  );

  const describeMatch = (rule: FinanceSettlementRule) => {
    if (rule.matchKind === "default") {
      return "Everything else";
    }
    if (rule.matchKind === "component") {
      return rule.componentName ?? componentLookup.get(rule.componentId ?? -1)?.name ?? `Component #${rule.componentId}`;
    }
    if (rule.matchKind === "component_category") {
      return `Category: ${rule.matchKey ?? "Not selected"}`;
    }
    return SYSTEM_SOURCE_OPTIONS.find((option) => option.value === rule.matchKey)?.label ?? rule.matchKey ?? "System source";
  };

  const describeTarget = (rule: FinanceSettlementRule) => {
    if (rule.targetScope === "global") {
      return "Everyone";
    }
    if (rule.targetScope === "user") {
      return rule.userName ?? `User #${rule.userId}`;
    }
    return formatStaffType(rule.staffType);
  };

  const openCreate = () => {
    setEditingRule(null);
    setDraft(createEmptyDraft());
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (rule: FinanceSettlementRule) => {
    setEditingRule(rule);
    setDraft({
      targetScope: rule.targetScope,
      staffType: rule.staffType,
      userId: rule.userId ? String(rule.userId) : null,
      matchKind: rule.matchKind,
      matchKey: rule.matchKey,
      componentId: rule.componentId ? String(rule.componentId) : null,
      destination: rule.destination,
      fundId: rule.fundId ? String(rule.fundId) : null,
      effectiveStart: rule.effectiveStart ?? "",
      effectiveEnd: rule.effectiveEnd ?? "",
      isActive: rule.isActive,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) {
      return;
    }
    setModalOpen(false);
    setEditingRule(null);
    setDraft(createEmptyDraft());
    setFormError(null);
  };

  const buildPayload = (): FinanceSettlementRulePayload => {
    if (draft.targetScope === "staff_type" && !draft.staffType) {
      throw new Error("Select a staff type.");
    }
    if (draft.targetScope === "user" && (!draft.userId || Number(draft.userId) <= 0)) {
      throw new Error("Select a staff member.");
    }
    if (draft.matchKind === "component" && !draft.componentId) {
      throw new Error("Select a compensation component.");
    }
    if ((draft.matchKind === "component_category" || draft.matchKind === "system_source") && !draft.matchKey) {
      throw new Error("Select what this rule should match.");
    }
    if (draft.destination === "volunteer_fund" && !draft.fundId) {
      throw new Error("Select the volunteer fund that should receive this allocation.");
    }
    if (draft.effectiveStart && draft.effectiveEnd && draft.effectiveStart > draft.effectiveEnd) {
      throw new Error("Effective end cannot be before effective start.");
    }
    if (!editingStartedRule) {
      if (!draft.effectiveStart) {
        throw new Error("Effective start is required.");
      }
      if (dayjs(draft.effectiveStart).date() !== 1) {
        throw new Error("Effective start must be the first day of a month.");
      }
      const earliestStart = dayjs().add(1, "month").startOf("month").format("YYYY-MM-DD");
      if (draft.effectiveStart < earliestStart) {
        throw new Error(`New routing must start on or after ${earliestStart}.`);
      }
    }
    if (draft.effectiveEnd && draft.effectiveEnd !== dayjs(draft.effectiveEnd).endOf("month").format("YYYY-MM-DD")) {
      throw new Error("Effective end must be the last day of a month.");
    }

    return {
      targetScope: draft.targetScope,
      staffType: draft.targetScope === "staff_type" ? draft.staffType : null,
      userId: draft.targetScope === "user" ? Number(draft.userId) : null,
      matchKind: draft.matchKind,
      matchKey:
        draft.matchKind === "component_category" || draft.matchKind === "system_source" ? draft.matchKey : null,
      componentId: draft.matchKind === "component" && draft.componentId ? Number(draft.componentId) : null,
      destination: draft.destination,
      fundId: draft.destination === "volunteer_fund" && draft.fundId ? Number(draft.fundId) : null,
      effectiveStart: draft.effectiveStart || null,
      effectiveEnd: draft.effectiveEnd || null,
      isActive: draft.isActive,
    };
  };

  const handleSubmit = async () => {
    setFormError(null);
    try {
      const payload = buildPayload();
      if (editingRule) {
        await updateRule.mutateAsync({ id: editingRule.id, changes: payload });
      } else {
        await createRule.mutateAsync(payload);
      }
      closeModal();
    } catch (error) {
      setFormError(extractErrorMessage(error, "Unable to save this payout routing rule."));
    }
  };

  const handleDelete = async (rule: FinanceSettlementRule) => {
    if (!window.confirm(`Delete the routing rule for ${describeTarget(rule)} / ${describeMatch(rule)}?`)) {
      return;
    }
    try {
      await deleteRule.mutateAsync(rule.id);
      setSelectedIds((current) => current.filter((id) => id !== rule.id));
    } catch (error) {
      setBulkError(extractErrorMessage(error, "Unable to delete this payout routing rule."));
    }
  };

  const handleBulkApply = async () => {
    setBulkError(null);
    if (selectedIds.length === 0) {
      return;
    }
    if (bulkDestination === "volunteer_fund" && !bulkFundId) {
      setBulkError("Select the volunteer fund to apply to these rules.");
      return;
    }
    try {
      await bulkUpdate.mutateAsync({
        ruleIds: selectedIds,
        changes: {
          destination: bulkDestination,
          fundId: bulkDestination === "volunteer_fund" && bulkFundId ? Number(bulkFundId) : null,
        },
      });
      setSelectedIds([]);
    } catch (error) {
      setBulkError(extractErrorMessage(error, "Unable to update the selected routing rules."));
    }
  };

  const toggleSelected = (id: number, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id),
    );
  };

  const renderActions = (rule: FinanceSettlementRule) => (
    <Group gap={4} justify="flex-end" wrap="nowrap">
      {canManageRouting && access.canUpdate && (
        <Tooltip label="Edit rule">
          <ActionIcon variant="light" onClick={() => openEdit(rule)} aria-label="Edit payout routing rule">
            <IconPencil size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {canManageRouting
        && access.canDelete
        && Boolean(rule.effectiveStart && rule.effectiveStart > dayjs().endOf("month").format("YYYY-MM-DD"))
        && (
        <Tooltip label="Delete rule">
          <ActionIcon
            variant="light"
            color="red"
            onClick={() => void handleDelete(rule)}
            aria-label="Delete payout routing rule"
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );

  if (!access.ready || rulesQuery.isLoading) {
    return (
      <Group justify="center" py="xl">
        <Loader variant="dots" />
      </Group>
    );
  }

  if (!access.canView) {
    return (
      <Alert color="yellow" title="No access">
        You do not have permission to view compensation payout routing.
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
        <Stack gap={3} style={{ flex: "1 1 320px" }}>
          <Group gap="xs">
            <IconRoute size={20} />
            <Text size="lg" fw={700}>Payout Routing</Text>
          </Group>
          <Text size="sm" c="dimmed">
            Decide which compensation is paid to staff and which amount is reserved in a volunteer fund.
          </Text>
        </Stack>
        <Group gap="xs">
          <Tooltip label="Refresh rules">
            <ActionIcon variant="light" onClick={() => void rulesQuery.refetch()} aria-label="Refresh payout routing rules">
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {canManageRouting && access.canCreate && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate} fullWidth={isMobile}>
              Add rule
            </Button>
          )}
        </Group>
      </Group>

      <Alert color="blue" title="Recommended volunteer policy">
        Set the Volunteer default to Volunteer fund, then add Staff vendor exceptions for Reviews and Promotion Sales.
        Reimbursements should stay routed to the staff vendor. Specific-user rules override staff-type defaults.
      </Alert>

      {rulesQuery.isError && (
        <Alert color="red" title="Unable to load payout routing">
          {extractErrorMessage(rulesQuery.error, "The settlement rules could not be loaded.")}
        </Alert>
      )}
      {fundsQuery.isError && (
        <Alert color="orange" title="Volunteer funds unavailable">
          Fund destinations cannot be selected until the volunteer funds endpoint is available.
        </Alert>
      )}
      {bulkError && (
        <Alert color="red" title="Routing update failed" withCloseButton onClose={() => setBulkError(null)}>
          {bulkError}
        </Alert>
      )}

      <Card withBorder radius="md" padding="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Search rules"
            placeholder="Staff type, component, fund, or destination"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <Select
            label="Staff type"
            placeholder="All staff types"
            data={STAFF_TYPE_OPTIONS}
            value={staffTypeFilter}
            onChange={setStaffTypeFilter}
            clearable
          />
        </SimpleGrid>
      </Card>

      {selectedIds.length > 0 && canManageRouting && access.canUpdate && (
        <Card withBorder radius="md" padding="md" bg="var(--mantine-color-blue-0)">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={700}>{selectedIds.length} rules selected</Text>
              <Button variant="subtle" size="xs" onClick={() => setSelectedIds([])}>Clear</Button>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select
                label="Set destination"
                data={DESTINATION_OPTIONS}
                value={bulkDestination}
                onChange={(value) => setBulkDestination((value ?? "staff_vendor") as SettlementDestination)}
              />
              <Select
                label="Volunteer fund"
                placeholder="Select fund"
                data={fundOptions}
                value={bulkFundId}
                onChange={setBulkFundId}
                disabled={bulkDestination !== "volunteer_fund"}
                searchable
              />
              <Button mt={isMobile ? 0 : 25} onClick={() => void handleBulkApply()} loading={bulkUpdate.isPending}>
                Apply to selected
              </Button>
            </SimpleGrid>
          </Stack>
        </Card>
      )}

      {filteredRules.length === 0 && !rulesQuery.isError ? (
        <Card withBorder radius="md" padding="xl">
          <Stack align="center" gap="xs">
            <Text fw={600}>{rules.length === 0 ? "No payout routing rules yet" : "No rules match these filters"}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {rules.length === 0
                ? "Create the Volunteer default first, then add exceptions for Reviews, Promotion Sales, and Reimbursements."
                : "Change or clear the filters to see more rules."}
            </Text>
          </Stack>
        </Card>
      ) : isMobile ? (
        <Stack gap="sm">
          {filteredRules.map((rule) => {
            const destination = destinationMeta(rule.destination);
            return (
              <Card key={rule.id} withBorder radius="md" padding="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Checkbox
                      checked={selectedIds.includes(rule.id)}
                      disabled={!canManageRouting || !access.canUpdate || isStartedRule(rule)}
                      onChange={(event) => toggleSelected(rule.id, event.currentTarget.checked)}
                      aria-label={`Select rule ${rule.id}`}
                    />
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text fw={700}>{describeTarget(rule)}</Text>
                      <Text size="sm">{describeMatch(rule)}</Text>
                    </Stack>
                    {renderActions(rule)}
                  </Group>
                  <Group gap="xs" justify="center">
                    <Badge color={destination.color}>{destination.label}</Badge>
                    <Badge variant="light" color={rule.isActive ? "teal" : "gray"}>
                      {rule.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </Group>
                  {rule.destination === "volunteer_fund" && (
                    <Text size="sm" ta="center" c="dimmed">
                      {rule.fundName ?? (rule.fundId ? fundLookup.get(rule.fundId) : null) ?? "Fund not selected"}
                    </Text>
                  )}
                  <Text size="xs" ta="center" c="dimmed">
                    {rule.effectiveStart || "Immediately"} - {rule.effectiveEnd || "No end date"}
                  </Text>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      ) : (
        <Card withBorder radius="md" padding={0}>
          <ScrollArea type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={920}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={44}>
                    <Checkbox
                      checked={
                        filteredRules.some((rule) => !isStartedRule(rule))
                        && filteredRules.filter((rule) => !isStartedRule(rule)).every((rule) => selectedIds.includes(rule.id))
                      }
                      indeterminate={
                        filteredRules.some((rule) => !isStartedRule(rule) && selectedIds.includes(rule.id)) &&
                        !filteredRules.filter((rule) => !isStartedRule(rule)).every((rule) => selectedIds.includes(rule.id))
                      }
                      disabled={!canManageRouting || !access.canUpdate || !filteredRules.some((rule) => !isStartedRule(rule))}
                      onChange={(event) =>
                        setSelectedIds((current) => {
                          const visibleIds = filteredRules
                            .filter((rule) => !isStartedRule(rule))
                            .map((rule) => rule.id);
                          return event.currentTarget.checked
                            ? [...new Set([...current, ...visibleIds])]
                            : current.filter((id) => !visibleIds.includes(id));
                        })
                      }
                      aria-label="Select visible payout routing rules"
                    />
                  </Table.Th>
                  <Table.Th>Applies to</Table.Th>
                  <Table.Th>Compensation source</Table.Th>
                  <Table.Th>Destination</Table.Th>
                  <Table.Th>Fund</Table.Th>
                  <Table.Th>Effective</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredRules.map((rule) => {
                  const destination = destinationMeta(rule.destination);
                  return (
                    <Table.Tr key={rule.id}>
                      <Table.Td>
                        <Checkbox
                          checked={selectedIds.includes(rule.id)}
                          disabled={!canManageRouting || !access.canUpdate || isStartedRule(rule)}
                          onChange={(event) => toggleSelected(rule.id, event.currentTarget.checked)}
                          aria-label={`Select rule ${rule.id}`}
                        />
                      </Table.Td>
                      <Table.Td><Text fw={600}>{describeTarget(rule)}</Text></Table.Td>
                      <Table.Td>{describeMatch(rule)}</Table.Td>
                      <Table.Td><Badge color={destination.color}>{destination.label}</Badge></Table.Td>
                      <Table.Td>
                        {rule.destination === "volunteer_fund"
                          ? rule.fundName ?? (rule.fundId ? fundLookup.get(rule.fundId) : null) ?? "Not selected"
                          : "-"}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{rule.effectiveStart || "Immediately"}</Text>
                        <Text size="xs" c="dimmed">to {rule.effectiveEnd || "No end date"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={rule.isActive ? "teal" : "gray"}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{renderActions(rule)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={editingRule ? "Edit payout routing rule" : "New payout routing rule"}
        size="xl"
        fullScreen={isMobile}
        centered={!isMobile}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Applies to"
              data={TARGET_SCOPE_OPTIONS}
              value={draft.targetScope}
              disabled={editingStartedRule}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  targetScope: (value ?? "staff_type") as SettlementRuleTargetScope,
                  staffType: value === "staff_type" ? current.staffType ?? "volunteer" : null,
                  userId: value === "user" ? current.userId : null,
                }))
              }
            />
            {draft.targetScope === "staff_type" ? (
              <Select
                label="Staff type"
                data={STAFF_TYPE_OPTIONS}
                value={draft.staffType}
                disabled={editingStartedRule}
                onChange={(value) => setDraft((current) => ({ ...current, staffType: value }))}
                searchable
              />
            ) : draft.targetScope === "user" ? (
              <Select
                label="Staff member"
                placeholder="Select staff member"
                data={userOptions}
                value={draft.userId}
                onChange={(value) => setDraft((current) => ({ ...current, userId: value }))}
                searchable
                disabled={usersQuery.isLoading || editingStartedRule}
              />
            ) : (
              <TextInput label="Target" value="All staff" readOnly variant="filled" />
            )}
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Compensation match"
              data={MATCH_KIND_OPTIONS}
              value={draft.matchKind}
              disabled={editingStartedRule}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  matchKind: (value ?? "default") as SettlementRuleMatchKind,
                  matchKey: null,
                  componentId: null,
                }))
              }
            />
            {draft.matchKind === "component" ? (
              <Select
                label="Compensation component"
                data={componentOptions}
                value={draft.componentId}
                disabled={editingStartedRule}
                onChange={(value) => setDraft((current) => ({ ...current, componentId: value }))}
                searchable
              />
            ) : draft.matchKind === "component_category" ? (
              <Select
                label="Component category"
                data={categoryOptions}
                value={draft.matchKey}
                disabled={editingStartedRule}
                onChange={(value) => setDraft((current) => ({ ...current, matchKey: value }))}
              />
            ) : draft.matchKind === "system_source" ? (
              <Select
                label="System source"
                data={SYSTEM_SOURCE_OPTIONS}
                value={draft.matchKey}
                disabled={editingStartedRule}
                onChange={(value) => setDraft((current) => ({ ...current, matchKey: value }))}
              />
            ) : (
              <TextInput label="Matches" value="Everything without a more specific rule" readOnly variant="filled" />
            )}
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Destination"
              data={DESTINATION_OPTIONS}
              value={draft.destination}
              disabled={editingStartedRule}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  destination: (value ?? "staff_vendor") as SettlementDestination,
                  fundId: value === "volunteer_fund" ? current.fundId : null,
                }))
              }
            />
            <Select
              label="Volunteer fund"
              placeholder="Select fund"
              data={fundOptions}
              value={draft.fundId}
              onChange={(value) => setDraft((current) => ({ ...current, fundId: value }))}
              disabled={draft.destination !== "volunteer_fund" || editingStartedRule}
              searchable
            />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Effective start"
              type="date"
              value={draft.effectiveStart}
              disabled={editingStartedRule}
              onChange={(event) => setDraft((current) => ({ ...current, effectiveStart: event.currentTarget.value }))}
            />
            <TextInput
              label="Effective end"
              type="date"
              value={draft.effectiveEnd}
              onChange={(event) => setDraft((current) => ({ ...current, effectiveEnd: event.currentTarget.value }))}
            />
          </SimpleGrid>
          <Alert color="blue" variant="light">
            {editingStartedRule
              ? "This rule has started, so only its end date can change. End it on a month boundary and create a successor for the following month."
              : "Routing changes start on a full pay-period boundary. Create a successor rule for the first day of a month; previously started rules remain part of the audit history."}
          </Alert>
          <Switch
            label="Rule is active"
            checked={draft.isActive}
            disabled={editingStartedRule}
            onChange={(event) => setDraft((current) => ({ ...current, isActive: event.currentTarget.checked }))}
          />
          {formError && <Alert color="red">{formError}</Alert>}
          <Group justify="flex-end" grow={isMobile}>
            <Button variant="default" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} loading={submitting}>
              {editingRule ? "Save changes" : "Create rule"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default PayoutRoutingPanel;
