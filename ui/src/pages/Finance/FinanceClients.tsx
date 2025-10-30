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
  createFinanceClient,
  deleteFinanceClient,
  fetchFinanceCategories,
  fetchFinanceClients,
  updateFinanceClient,
} from "../../actions/financeActions";
import { selectFinanceCategories, selectFinanceClients } from "../../selectors/financeSelectors";
import { FinanceClient } from "../../types/finance";

type DraftClient = {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  defaultCategoryId: number | null;
  notes: string | null;
  isActive: boolean;
};

const defaultDraft: DraftClient = {
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
  const [draft, setDraft] = useState<DraftClient>(defaultDraft);

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
      setDraft(defaultDraft);
    }
  }, [editingClient]);

  const categoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.isActive)
        .map((category) => ({
          value: String(category.id),
          label: `${category.kind === "income" ? "Income" : "Expense"} Â- ${category.name}`,
        })),
    [categories.data],
  );

  const sortedClients = useMemo(
    () => [...clients.data].sort((a, b) => a.name.localeCompare(b.name)),
    [clients.data],
  );

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      return;
    }

    if (editingClient) {
      await dispatch(
        updateFinanceClient({
          id: editingClient.id,
          changes: {
            ...editingClient,
            ...draft,
          },
        }),
      );
    } else {
      await dispatch(createFinanceClient(draft));
    }

    setModalOpen(false);
    setEditingClient(null);
    setDraft(defaultDraft);
  };

  const handleDelete = async (id: number) => {
    await dispatch(deleteFinanceClient(id));
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Clients</Title>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => {
            setEditingClient(null);
            setModalOpen(true);
          }}
        >
          New Client
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
          {sortedClients.map((client) => (
            <Table.Tr key={client.id}>
              <Table.Td>{client.name}</Table.Td>
              <Table.Td>{client.taxId ?? "â€”"}</Table.Td>
              <Table.Td>{client.email ?? "â€”"}</Table.Td>
              <Table.Td>{client.phone ?? "â€”"}</Table.Td>
              <Table.Td>
                {client.defaultCategoryId
                  ? categories.data.find((category) => category.id === client.defaultCategoryId)?.name ?? "â€”"
                  : "â€”"}
              </Table.Td>
              <Table.Td>{client.isActive ? "Active" : "Inactive"}</Table.Td>
              <Table.Td width={120}>
                <Group gap={4} justify="flex-end">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setEditingClient(client);
                      setModalOpen(true);
                    }}
                  >
                    <IconEdit size={18} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(client.id)}>
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
          setEditingClient(null);
        }}
        title={editingClient ? "Edit Client" : "New Client"}
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
            nothingFoundMessage="No categories"
          />
          <Textarea
            label="Notes"
            minRows={3}
            value={draft.notes ?? ""}
            onChange={(event) => setDraft((state) => ({ ...state, notes: event.currentTarget.value || null }))}
          />
          <Switch
            label="Client is active"
            checked={draft.isActive}
            onChange={(event) => setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingClient ? "Save changes" : "Create client"}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceClients;


