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
  IconBuildingStore,
  IconEdit,
  IconPlus,
  IconSettings,
  IconTags,
  IconTrash,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceVendor,
  deleteFinanceVendor,
  fetchFinanceCategories,
  fetchFinanceVendors,
  updateFinanceVendor,
} from "../../actions/financeActions";
import { selectFinanceCategories, selectFinanceVendors } from "../../selectors/financeSelectors";
import { FinanceVendor } from "../../types/finance";
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

type DraftVendor = {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  defaultCategoryId: number | null;
  notes: string | null;
  isActive: boolean;
};

type StatusFilter = "all" | "active" | "inactive";

const DEFAULT_DRAFT: DraftVendor = {
  name: "",
  taxId: null,
  email: null,
  phone: null,
  defaultCategoryId: null,
  notes: null,
  isActive: true,
};

const FinanceVendors = () => {
  const dispatch = useAppDispatch();
  const vendors = useAppSelector(selectFinanceVendors);
  const categories = useAppSelector(selectFinanceCategories);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<FinanceVendor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinanceVendor | null>(null);
  const [draft, setDraft] = useState<DraftVendor>(DEFAULT_DRAFT);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  useEffect(() => {
    dispatch(fetchFinanceVendors());
    dispatch(fetchFinanceCategories());
  }, [dispatch]);

  useEffect(() => {
    if (editingVendor) {
      setDraft({
        name: editingVendor.name,
        taxId: editingVendor.taxId,
        email: editingVendor.email,
        phone: editingVendor.phone,
        defaultCategoryId: editingVendor.defaultCategoryId,
        notes: editingVendor.notes,
        isActive: editingVendor.isActive,
      });
    } else {
      setDraft(DEFAULT_DRAFT);
    }
  }, [editingVendor]);

  const categoryNameById = useMemo(
    () => new Map(categories.data.map((category) => [category.id, category.name])),
    [categories.data],
  );

  const categoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.isActive && category.kind === "expense")
        .map((category) => ({
          value: String(category.id),
          label: category.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories.data],
  );

  const filteredVendors = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...vendors.data]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((vendor) => {
        const categoryName = vendor.defaultCategoryId
          ? categoryNameById.get(vendor.defaultCategoryId) ?? ""
          : "";
        const matchesSearch =
          !query ||
          [vendor.name, vendor.taxId, vendor.email, vendor.phone, vendor.notes, categoryName]
            .some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" ? vendor.isActive : !vendor.isActive);
        const matchesCategory =
          !categoryFilter || String(vendor.defaultCategoryId ?? "") === categoryFilter;
        return matchesSearch && matchesStatus && matchesCategory;
      });
  }, [categoryFilter, categoryNameById, search, statusFilter, vendors.data]);

  const hasFilters = Boolean(search.trim()) || statusFilter !== "all" || Boolean(categoryFilter);

  const openNewVendor = () => {
    setEditingVendor(null);
    setDraft(DEFAULT_DRAFT);
    setActionError(null);
    setModalOpen(true);
  };

  const openEditVendor = (vendor: FinanceVendor) => {
    setEditingVendor(vendor);
    setActionError(null);
    setModalOpen(true);
  };

  const closeVendorModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingVendor(null);
    setActionError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter(null);
  };

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      setActionError("Vendor name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const normalizedDraft = { ...draft, name: draft.name.trim() };
      if (editingVendor) {
        await dispatch(
          updateFinanceVendor({
            id: editingVendor.id,
            changes: { ...editingVendor, ...normalizedDraft },
          }),
        ).unwrap();
      } else {
        await dispatch(createFinanceVendor(normalizedDraft)).unwrap();
      }
      setModalOpen(false);
      setEditingVendor(null);
      setDraft(DEFAULT_DRAFT);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to save this vendor."));
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
      await dispatch(deleteFinanceVendor(deleteTarget.id)).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to delete this vendor."));
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge = (vendor: FinanceVendor) => (
    <Badge color={vendor.isActive ? "teal" : "gray"} variant="light">
      {vendor.isActive ? "Active" : "Inactive"}
    </Badge>
  );

  const beginDelete = (vendor: FinanceVendor) => {
    setActionError(null);
    setDeleteTarget(vendor);
  };

  const emptyState = (
    <FinanceEmptyState
      icon={<IconBuildingStore size={25} />}
      title={hasFilters ? "No vendors match these filters" : "Build your vendor directory"}
      description={
        hasFilters
          ? "Try a different supplier name, contact detail, status, or default category."
          : "Create vendor records once, then reuse them for faster and more consistent expense entry."
      }
      action={
        hasFilters ? (
          <Button variant="light" onClick={clearFilters}>Clear filters</Button>
        ) : (
          <FinancePrimaryAction leftSection={<IconPlus size={16} />} onClick={openNewVendor}>
            New vendor
          </FinancePrimaryAction>
        )
      }
    />
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        eyebrow="Counterparties"
        title="Vendors"
        description="Keep supplier details and default expense coding ready for accurate, efficient transaction entry."
        icon={<IconBuildingStore size={24} />}
        actions={
          <FinancePrimaryAction leftSection={<IconPlus size={17} />} onClick={openNewVendor}>
            New vendor
          </FinancePrimaryAction>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search vendors, contacts, tax IDs, or notes"
      >
        <Select
          aria-label="Filter vendors by status"
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
          aria-label="Filter vendors by default category"
          placeholder="All categories"
          value={categoryFilter}
          onChange={setCategoryFilter}
          data={categoryOptions}
          searchable
          clearable
          w={220}
        />
        <Text size="xs" c="dimmed" fw={700} ml="auto">
          {filteredVendors.length} of {vendors.data.length} vendors
        </Text>
      </FinanceToolbar>

      {vendors.error ? (
        <FinanceErrorState
          title="Vendors could not be loaded"
          message={vendors.error}
          onRetry={() => {
            void dispatch(fetchFinanceVendors());
          }}
        />
      ) : null}
      {categories.error ? (
        <FinanceErrorState
          title="Vendor category options could not be loaded"
          message={categories.error}
          onRetry={() => {
            void dispatch(fetchFinanceCategories());
          }}
        />
      ) : null}

      {isMobile ? (
        vendors.loading ? (
          <FinanceLoadingState label="Loading vendors" />
        ) : filteredVendors.length === 0 ? (
          emptyState
        ) : (
          <Stack gap="sm">
            {filteredVendors.map((vendor) => {
              const categoryName = vendor.defaultCategoryId
                ? categoryNameById.get(vendor.defaultCategoryId) ?? "Unassigned"
                : "Unassigned";
              const contact = vendor.email || vendor.phone || "No contact details";
              return (
                <FinanceRecordCard
                  key={vendor.id}
                  title={vendor.name}
                  subtitle={vendor.notes || "Supplier record"}
                  leading={
                    <ThemeIcon color="orange" variant="light" radius="md" size={38}>
                      <IconBuildingStore size={19} />
                    </ThemeIcon>
                  }
                  status={statusBadge(vendor)}
                  fields={[
                    { label: "Contact", value: contact },
                    { label: "Tax ID", value: vendor.taxId || "Not provided" },
                    { label: "Default category", value: categoryName },
                  ]}
                  actions={
                    <>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconEdit size={15} />}
                        onClick={() => openEditVendor(vendor)}
                        aria-label={`Edit vendor ${vendor.name}`}
                        style={{ flex: "1 1 120px" }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        leftSection={<IconTrash size={15} />}
                        onClick={() => beginDelete(vendor)}
                        aria-label={`Delete vendor ${vendor.name}`}
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
          title="Vendor directory"
          description="Default categories are suggested when recording expenses for each supplier."
          icon={<IconBuildingStore size={18} />}
          noPadding
        >
          {vendors.loading ? (
            <FinanceLoadingState label="Loading vendors" />
          ) : filteredVendors.length === 0 ? (
            emptyState
          ) : (
            <ScrollArea offsetScrollbars type="auto">
              <Table highlightOnHover verticalSpacing="md" miw={940}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Vendor</Table.Th>
                    <Table.Th>Contact</Table.Th>
                    <Table.Th>Tax ID</Table.Th>
                    <Table.Th>Default category</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredVendors.map((vendor) => (
                    <Table.Tr key={vendor.id}>
                      <Table.Td>
                        <Stack gap={1}>
                          <Text fw={750}>{vendor.name}</Text>
                          {vendor.notes ? <Text size="xs" c="dimmed" lineClamp={1}>{vendor.notes}</Text> : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={1}>
                          <Text size="sm">{vendor.email || "—"}</Text>
                          {vendor.phone ? <Text size="xs" c="dimmed">{vendor.phone}</Text> : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td>{vendor.taxId || "—"}</Table.Td>
                      <Table.Td>
                        {vendor.defaultCategoryId
                          ? categoryNameById.get(vendor.defaultCategoryId) ?? "Unknown category"
                          : "Unassigned"}
                      </Table.Td>
                      <Table.Td>{statusBadge(vendor)}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label={`Edit ${vendor.name}`}>
                            <ActionIcon
                              variant="subtle"
                              onClick={() => openEditVendor(vendor)}
                              aria-label={`Edit vendor ${vendor.name}`}
                            >
                              <IconEdit size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={`Delete ${vendor.name}`}>
                            <ActionIcon
                              color="red"
                              variant="subtle"
                              onClick={() => beginDelete(vendor)}
                              aria-label={`Delete vendor ${vendor.name}`}
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
        onClose={closeVendorModal}
        title={editingVendor ? "Edit vendor" : "New vendor"}
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
              title="Supplier identity"
              description="The legal or recognizable supplier information shown throughout Finance."
              icon={<IconBuildingStore size={18} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Name"
                  placeholder="Vendor or supplier name"
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
              description="Choose the category suggested when this vendor is selected on an expense."
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
              description="Notes stay with the vendor, while inactive records remain available in history."
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
                label="Vendor is active"
                checked={draft.isActive}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))
                }
              />
            </FinanceFormSection>

            {actionError ? <Alert color="red">{actionError}</Alert> : null}

            <FinanceModalFooter>
              <Button variant="default" onClick={closeVendorModal} disabled={saving} fullWidth={isMobile}>
                Cancel
              </Button>
              <FinancePrimaryAction
                type="submit"
                loading={saving}
                disabled={!draft.name.trim()}
                fullWidth={isMobile}
              >
                {editingVendor ? "Save changes" : "Create vendor"}
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
        title="Delete vendor?"
        description={`Delete ${deleteTarget?.name ?? "this vendor"}? Vendors referenced by Finance records may not be removable.`}
        confirmLabel="Delete vendor"
        loading={deleting}
      >
        {actionError ? <Alert color="red">{actionError}</Alert> : null}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceVendors;
