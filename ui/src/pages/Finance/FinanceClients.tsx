import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAddressBook,
  IconEdit,
  IconPlus,
  IconSettings,
  IconTags,
  IconTrash,
  IconUserDollar,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceClient,
  deleteFinanceClient,
  fetchFinanceCategories,
  fetchFinanceClients,
  updateFinanceClient,
} from "../../actions/financeActions";
import { selectFinanceCategories, selectFinanceClients } from "../../selectors/financeSelectors";
import { FinanceClient } from "../../types/finance";
import {
  FinanceConfirmModal,
  FinanceEmptyState,
  FinanceErrorState,
  FinanceFormSection,
  FinanceLoadingState,
  FinanceModal,
  FinanceModalFooter,
  FinancePageHeader,
  FinancePanel,
  FinancePrimaryAction,
  FinanceRecordCard,
  FinanceToolbar,
  financePageClass,
} from "../../components/finance/FinanceUi";
import { getFinanceErrorMessage } from "../../components/finance/financeFormatters";

type DraftClient = {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  defaultCategoryId: number | null;
  notes: string | null;
  isActive: boolean;
};

type StatusFilter = "all" | "active" | "inactive";

const DEFAULT_DRAFT: DraftClient = {
  name: "",
  taxId: null,
  email: null,
  phone: null,
  defaultCategoryId: null,
  notes: null,
  isActive: true,
};

const FinanceClients = () => {
  const dispatch = useAppDispatch();
  const clients = useAppSelector(selectFinanceClients);
  const categories = useAppSelector(selectFinanceCategories);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<FinanceClient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinanceClient | null>(null);
  const [draft, setDraft] = useState<DraftClient>(DEFAULT_DRAFT);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  useEffect(() => {
    dispatch(fetchFinanceClients());
    dispatch(fetchFinanceCategories());
  }, [dispatch]);

  useEffect(() => {
    if (editingClient) {
      setDraft({
        name: editingClient.name,
        taxId: editingClient.taxId,
        email: editingClient.email,
        phone: editingClient.phone,
        defaultCategoryId: editingClient.defaultCategoryId,
        notes: editingClient.notes,
        isActive: editingClient.isActive,
      });
    } else {
      setDraft(DEFAULT_DRAFT);
    }
  }, [editingClient]);

  const categoryNameById = useMemo(
    () => new Map(categories.data.map((category) => [category.id, category.name])),
    [categories.data],
  );

  const categoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.isActive && category.kind === "income")
        .map((category) => ({
          value: String(category.id),
          label: category.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories.data],
  );

  const filteredClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...clients.data]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((client) => {
        const categoryName = client.defaultCategoryId
          ? categoryNameById.get(client.defaultCategoryId) ?? ""
          : "";
        const matchesSearch =
          !query ||
          [client.name, client.taxId, client.email, client.phone, client.notes, categoryName]
            .some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" ? client.isActive : !client.isActive);
        const matchesCategory =
          !categoryFilter || String(client.defaultCategoryId ?? "") === categoryFilter;
        return matchesSearch && matchesStatus && matchesCategory;
      });
  }, [categoryFilter, categoryNameById, clients.data, search, statusFilter]);

  const hasFilters = Boolean(search.trim()) || statusFilter !== "all" || Boolean(categoryFilter);

  const openNewClient = () => {
    setEditingClient(null);
    setDraft(DEFAULT_DRAFT);
    setActionError(null);
    setModalOpen(true);
  };

  const openEditClient = (client: FinanceClient) => {
    setEditingClient(client);
    setActionError(null);
    setModalOpen(true);
  };

  const closeClientModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingClient(null);
    setActionError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter(null);
  };

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      setActionError("Client name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const normalizedDraft = { ...draft, name: draft.name.trim() };
      if (editingClient) {
        await dispatch(
          updateFinanceClient({
            id: editingClient.id,
            changes: { ...editingClient, ...normalizedDraft },
          }),
        ).unwrap();
      } else {
        await dispatch(createFinanceClient(normalizedDraft)).unwrap();
      }
      setModalOpen(false);
      setEditingClient(null);
      setDraft(DEFAULT_DRAFT);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to save this client."));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await dispatch(deleteFinanceClient(deleteTarget.id)).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to delete this client."));
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge = (client: FinanceClient) => (
    <Badge color={client.isActive ? "teal" : "gray"} variant="light">
      {client.isActive ? "Active" : "Inactive"}
    </Badge>
  );

  const beginDelete = (client: FinanceClient) => {
    setActionError(null);
    setDeleteTarget(client);
  };

  const emptyState = (
    <FinanceEmptyState
      icon={<IconUsersGroup size={25} />}
      title={hasFilters ? "No clients match these filters" : "Build your client directory"}
      description={
        hasFilters
          ? "Try a different customer name, contact detail, status, or default category."
          : "Create reusable client records for consistent income categorization and cleaner receivable reporting."
      }
      action={
        hasFilters ? (
          <Button variant="light" onClick={clearFilters}>Clear filters</Button>
        ) : (
          <FinancePrimaryAction leftSection={<IconPlus size={16} />} onClick={openNewClient}>
            New client
          </FinancePrimaryAction>
        )
      }
    />
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        eyebrow="Counterparties"
        title="Clients"
        description="Maintain customer records and default income coding for reliable transaction entry and receivable reporting."
        icon={<IconUsersGroup size={24} />}
        actions={
          <FinancePrimaryAction leftSection={<IconPlus size={17} />} onClick={openNewClient}>
            New client
          </FinancePrimaryAction>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search clients, contacts, tax IDs, or notes"
      >
        <Select
          aria-label="Filter clients by status"
          value={statusFilter}
          onChange={(value) => setStatusFilter((value ?? "all") as StatusFilter)}
          data={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          w={165}
        />
        <Select
          aria-label="Filter clients by default category"
          placeholder="All categories"
          value={categoryFilter}
          onChange={setCategoryFilter}
          data={categoryOptions}
          searchable
          clearable
          w={220}
        />
        <Text size="xs" c="dimmed" fw={700} ml="auto">
          {filteredClients.length} of {clients.data.length} clients
        </Text>
      </FinanceToolbar>

      {clients.error ? (
        <FinanceErrorState
          title="Clients could not be loaded"
          message={clients.error}
          onRetry={() => {
            void dispatch(fetchFinanceClients());
          }}
        />
      ) : null}
      {categories.error ? (
        <FinanceErrorState
          title="Client category options could not be loaded"
          message={categories.error}
          onRetry={() => {
            void dispatch(fetchFinanceCategories());
          }}
        />
      ) : null}

      {isMobile ? (
        clients.loading ? (
          <FinanceLoadingState label="Loading clients" />
        ) : filteredClients.length === 0 ? (
          emptyState
        ) : (
          <Stack gap="sm">
            {filteredClients.map((client) => {
              const categoryName = client.defaultCategoryId
                ? categoryNameById.get(client.defaultCategoryId) ?? "Unassigned"
                : "Unassigned";
              const contact = client.email || client.phone || "No contact details";
              return (
                <FinanceRecordCard
                  key={client.id}
                  title={client.name}
                  subtitle={client.notes || "Customer record"}
                  leading={
                    <ThemeIcon color="violet" variant="light" radius="md" size={38}>
                      <IconUserDollar size={19} />
                    </ThemeIcon>
                  }
                  status={statusBadge(client)}
                  fields={[
                    { label: "Contact", value: contact },
                    { label: "Tax ID", value: client.taxId || "Not provided" },
                    { label: "Default category", value: categoryName },
                  ]}
                  actions={
                    <>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconEdit size={15} />}
                        onClick={() => openEditClient(client)}
                        aria-label={`Edit client ${client.name}`}
                        style={{ flex: "1 1 120px" }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        leftSection={<IconTrash size={15} />}
                        onClick={() => beginDelete(client)}
                        aria-label={`Delete client ${client.name}`}
                        style={{ flex: "1 1 120px" }}
                      >
                        Delete
                      </Button>
                    </>
                  }
                />
              );
            })}
          </Stack>
        )
      ) : (
        <FinancePanel
          title="Client directory"
          description="Default categories are suggested when recording income for each customer."
          icon={<IconUsersGroup size={18} />}
          noPadding
        >
          {clients.loading ? (
            <FinanceLoadingState label="Loading clients" />
          ) : filteredClients.length === 0 ? (
            emptyState
          ) : (
            <ScrollArea offsetScrollbars type="auto">
              <Table highlightOnHover verticalSpacing="md" miw={940}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Client</Table.Th>
                    <Table.Th>Contact</Table.Th>
                    <Table.Th>Tax ID</Table.Th>
                    <Table.Th>Default category</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredClients.map((client) => (
                    <Table.Tr key={client.id}>
                      <Table.Td>
                        <Stack gap={1}>
                          <Text fw={750}>{client.name}</Text>
                          {client.notes ? <Text size="xs" c="dimmed" lineClamp={1}>{client.notes}</Text> : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={1}>
                          <Text size="sm">{client.email || "—"}</Text>
                          {client.phone ? <Text size="xs" c="dimmed">{client.phone}</Text> : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td>{client.taxId || "—"}</Table.Td>
                      <Table.Td>
                        {client.defaultCategoryId
                          ? categoryNameById.get(client.defaultCategoryId) ?? "Unknown category"
                          : "Unassigned"}
                      </Table.Td>
                      <Table.Td>{statusBadge(client)}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label={`Edit ${client.name}`}>
                            <ActionIcon
                              variant="subtle"
                              onClick={() => openEditClient(client)}
                              aria-label={`Edit client ${client.name}`}
                            >
                              <IconEdit size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={`Delete ${client.name}`}>
                            <ActionIcon
                              color="red"
                              variant="subtle"
                              onClick={() => beginDelete(client)}
                              aria-label={`Delete client ${client.name}`}
                            >
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </FinancePanel>
      )}

      <FinanceModal
        opened={modalOpen}
        onClose={closeClientModal}
        title={editingClient ? "Edit client" : "New client"}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
      >
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Stack gap="md">
            <FinanceFormSection
              title="Client identity"
              description="The legal or recognizable customer information shown throughout Finance."
              icon={<IconUserDollar size={18} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Name"
                  placeholder="Client or customer name"
                  withAsterisk
                  autoFocus
                  value={draft.name}
                  onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
                />
                <TextInput
                  label="Tax ID"
                  placeholder="Optional"
                  value={draft.taxId ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, taxId: event.currentTarget.value || null }))
                  }
                />
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection
              title="Contact details"
              description="Keep the details used for invoices, questions, and payment follow-up."
              icon={<IconAddressBook size={18} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  type="email"
                  label="Email"
                  placeholder="billing@example.com"
                  value={draft.email ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, email: event.currentTarget.value || null }))
                  }
                />
                <TextInput
                  type="tel"
                  label="Phone"
                  placeholder="Optional"
                  value={draft.phone ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, phone: event.currentTarget.value || null }))
                  }
                />
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection
              title="Finance defaults"
              description="Choose the category suggested when this client is selected on an income transaction."
              icon={<IconTags size={18} />}
            >
              <Select
                label="Default category"
                placeholder="No default category"
                data={categoryOptions}
                value={draft.defaultCategoryId ? String(draft.defaultCategoryId) : null}
                onChange={(value) =>
                  setDraft((state) => ({
                    ...state,
                    defaultCategoryId: value ? Number(value) : null,
                  }))
                }
                searchable
                clearable
                nothingFoundMessage="No categories"
              />
            </FinanceFormSection>

            <FinanceFormSection
              title="Internal record"
              description="Notes stay with the client, while inactive records remain available in history."
              icon={<IconSettings size={18} />}
            >
              <Textarea
                label="Notes"
                placeholder="Payment terms, invoice instructions, or other context"
                minRows={3}
                value={draft.notes ?? ""}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, notes: event.currentTarget.value || null }))
                }
              />
              <Switch
                label="Client is active"
                checked={draft.isActive}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))
                }
              />
            </FinanceFormSection>

            {actionError ? <Alert color="red">{actionError}</Alert> : null}

            <FinanceModalFooter>
              <Button variant="default" onClick={closeClientModal} disabled={saving} fullWidth={isMobile}>
                Cancel
              </Button>
              <FinancePrimaryAction
                type="submit"
                loading={saving}
                disabled={!draft.name.trim()}
                fullWidth={isMobile}
              >
                {editingClient ? "Save changes" : "Create client"}
              </FinancePrimaryAction>
            </FinanceModalFooter>
          </Stack>
        </Box>
      </FinanceModal>

      <FinanceConfirmModal
        opened={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setActionError(null);
          }
        }}
        onConfirm={() => void handleConfirmDelete()}
        title="Delete client?"
        description={`Delete ${deleteTarget?.name ?? "this client"}? Clients referenced by Finance records may not be removable.`}
        confirmLabel="Delete client"
        loading={deleting}
      >
        {actionError ? <Alert color="red">{actionError}</Alert> : null}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceClients;
