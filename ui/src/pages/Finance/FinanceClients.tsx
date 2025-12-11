import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Textarea,
  TextInput,
  Title,
  useMantineTheme,
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
import { useMediaQuery } from "@mantine/hooks";

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
      setDraft(defaultDraft);
    }
  }, [editingClient]);

  const categoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.isActive)
        .map((category) => ({
          value: String(category.id),
        label: `${category.kind === "income" ? "Income" : "Expense"} - ${category.name}`,
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
      <Group justify="space-between" align={isMobile ? "stretch" : "center"} gap="sm" wrap="wrap">
        <Title order={3}>Clients</Title>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => {
            setEditingClient(null);
            setModalOpen(true);
          }}
          fullWidth={isMobile}
        >
          New Client
        </Button>
      </Group>

      <ScrollArea offsetScrollbars type="auto">
        <Table striped withColumnBorders highlightOnHover miw={900}>
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
                <Table.Td>{client.taxId ?? ""}</Table.Td>
                <Table.Td>{client.email ?? ""}</Table.Td>
                <Table.Td>{client.phone ?? ""}</Table.Td>
                <Table.Td>
                  {client.defaultCategoryId
                    ? categories.data.find((category) => category.id === client.defaultCategoryId)?.name ?? ""
                    : ""}
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
      </ScrollArea>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingClient(null);
        }}
        title={editingClient ? "Edit Client" : "New Client"}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            withAsterisk
            value={draft.name}
            onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
          />
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
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
          </SimpleGrid>
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
          <Group justify="flex-end" gap="sm" wrap="wrap" mt="md">
            <Button variant="light" onClick={() => setModalOpen(false)} fullWidth={isMobile}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} fullWidth={isMobile}>
              {editingClient ? "Save changes" : "Create client"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceClients;




