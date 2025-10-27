import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
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

type DraftVendor = {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  defaultCategoryId: number | null;
  notes: string | null;
  isActive: boolean;
};

const defaultDraft: DraftVendor = {
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
  const [draft, setDraft] = useState<DraftVendor>(defaultDraft);

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
      setDraft(defaultDraft);
    }
  }, [editingVendor]);

  const categoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.isActive)
        .map((category) => ({
          value: String(category.id),
          label: `${category.kind === "income" ? "Income" : "Expense"} �- ${category.name}`,
        })),
    [categories.data],
  );

  const sortedVendors = useMemo(
    () => [...vendors.data].sort((a, b) => a.name.localeCompare(b.name)),
    [vendors.data],
  );

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      return;
    }

    if (editingVendor) {
      await dispatch(
        updateFinanceVendor({
          id: editingVendor.id,
          changes: {
            ...editingVendor,
            ...draft,
          },
        }),
      );
    } else {
      await dispatch(createFinanceVendor(draft));
    }

    setModalOpen(false);
    setEditingVendor(null);
    setDraft(defaultDraft);
  };

  const handleDelete = async (id: number) => {
    await dispatch(deleteFinanceVendor(id));
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Vendors</Title>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => {
            setEditingVendor(null);
            setModalOpen(true);
          }}
        >
          New Vendor
        </Button>
      </Group>

      <Table striped withColumnBorders highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Tax ID</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Phone</Table.Th>
            <Table.Th>Default Category</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedVendors.map((vendor) => (
            <Table.Tr key={vendor.id}>
              <Table.Td>{vendor.name}</Table.Td>
              <Table.Td>{vendor.taxId ?? "—"}</Table.Td>
              <Table.Td>{vendor.email ?? "—"}</Table.Td>
              <Table.Td>{vendor.phone ?? "—"}</Table.Td>
              <Table.Td>
                {vendor.defaultCategoryId
                  ? categories.data.find((category) => category.id === vendor.defaultCategoryId)?.name ?? "—"
                  : "—"}
              </Table.Td>
              <Table.Td>{vendor.isActive ? "Active" : "Inactive"}</Table.Td>
              <Table.Td width={120}>
                <Group gap={4} justify="flex-end">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setEditingVendor(vendor);
                      setModalOpen(true);
                    }}
                  >
                    <IconEdit size={18} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(vendor.id)}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingVendor(null);
        }}
        title={editingVendor ? "Edit Vendor" : "New Vendor"}
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            withAsterisk
            value={draft.name}
            onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
          />
          <Group grow>
            <TextInput
              label="Tax ID"
              value={draft.taxId ?? ""}
              onChange={(event) => setDraft((state) => ({ ...state, taxId: event.currentTarget.value || null }))}
            />
            <TextInput
              label="Email"
              value={draft.email ?? ""}
              onChange={(event) => setDraft((state) => ({ ...state, email: event.currentTarget.value || null }))}
            />
            <TextInput
              label="Phone"
              value={draft.phone ?? ""}
              onChange={(event) => setDraft((state) => ({ ...state, phone: event.currentTarget.value || null }))}
            />
          </Group>
          <Select
            label="Default Category"
            placeholder="Optional"
            data={categoryOptions}
            value={draft.defaultCategoryId ? String(draft.defaultCategoryId) : null}
            onChange={(value) =>
              setDraft((state) => ({
                ...state,
                defaultCategoryId: value ? Number(value) : null,
              }))
            }
            searchable
            nothingFound="No categories"
          />
          <Textarea
            label="Notes"
            minRows={3}
            value={draft.notes ?? ""}
            onChange={(event) => setDraft((state) => ({ ...state, notes: event.currentTarget.value || null }))}
          />
          <Switch
            label="Vendor is active"
            checked={draft.isActive}
            onChange={(event) => setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingVendor ? "Save changes" : "Create vendor"}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceVendors;

