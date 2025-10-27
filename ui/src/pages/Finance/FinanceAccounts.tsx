import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Button, Group, Modal, NumberInput, Select, Stack, Switch, Table, TextInput, Title } from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { createFinanceAccount, deleteFinanceAccount, fetchFinanceAccounts, updateFinanceAccount } from "../../actions/financeActions";
import { selectFinanceAccounts } from "../../selectors/financeSelectors";
import { FinanceAccount } from "../../types/finance";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

type DraftAccount = {
  name: string;
  type: FinanceAccount["type"];
  currency: string;
  openingBalanceMinor: number;
  isActive: boolean;
};

const DEFAULT_DRAFT: DraftAccount = {
  name: "",
  type: "cash",
  currency: "PLN",
  openingBalanceMinor: 0,
  isActive: true,
};

const FinanceAccounts = () => {
  const dispatch = useAppDispatch();
  const accounts = useAppSelector(selectFinanceAccounts);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [draft, setDraft] = useState<DraftAccount>(DEFAULT_DRAFT);

  useEffect(() => {
    dispatch(fetchFinanceAccounts());
  }, [dispatch]);

  useEffect(() => {
    if (editingAccount) {
      setDraft({
        name: editingAccount.name,
        type: editingAccount.type,
        currency: editingAccount.currency,
        openingBalanceMinor: editingAccount.openingBalanceMinor,
        isActive: editingAccount.isActive,
      });
    } else {
      setDraft(DEFAULT_DRAFT);
    }
  }, [editingAccount]);

  const sortedAccounts = useMemo(
    () => [...accounts.data].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts.data],
  );

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      return;
    }

    if (editingAccount) {
      await dispatch(
        updateFinanceAccount({
          id: editingAccount.id,
          changes: {
            ...editingAccount,
            ...draft,
          },
        }),
      );
    } else {
      await dispatch(createFinanceAccount(draft));
    }

    setModalOpen(false);
    setEditingAccount(null);
    setDraft(DEFAULT_DRAFT);
  };

  const handleDelete = async (id: number) => {
    await dispatch(deleteFinanceAccount(id));
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.finance}>
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>Accounts</Title>
          <Button
            leftSection={<IconPlus size={18} />}
            onClick={() => {
              setEditingAccount(null);
              setModalOpen(true);
            }}
          >
            New Account
          </Button>
        </Group>

        <Table striped highlightOnHover withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Currency</Table.Th>
              <Table.Th ta="right">Opening Balance</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedAccounts.map((account) => (
              <Table.Tr key={account.id}>
                <Table.Td>{account.name}</Table.Td>
                <Table.Td>{account.type.toUpperCase()}</Table.Td>
                <Table.Td>{account.currency}</Table.Td>
                <Table.Td ta="right">{(account.openingBalanceMinor / 100).toFixed(2)}</Table.Td>
                <Table.Td>{account.isActive ? "Active" : "Archived"}</Table.Td>
                <Table.Td width={120}>
                  <Group gap={4} justify="flex-end">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => {
                        setEditingAccount(account);
                        setModalOpen(true);
                      }}
                    >
                      <IconEdit size={18} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(account.id)}>
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
            setEditingAccount(null);
          }}
          title={editingAccount ? "Edit Account" : "New Account"}
          size="lg"
        >
          <Stack gap="md">
            <TextInput
              label="Name"
              value={draft.name}
              onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
              withAsterisk
            />
            <Group grow>
              <Select
                label="Type"
                value={draft.type}
                data={[
                  { value: "cash", label: "Cash" },
                  { value: "bank", label: "Bank" },
                  { value: "stripe", label: "Stripe" },
                  { value: "revolut", label: "Revolut" },
                  { value: "other", label: "Other" },
                ]}
                onChange={(value) => setDraft((state) => ({ ...state, type: (value ?? "cash") as DraftAccount["type"] }))}
              />
              <TextInput
                label="Currency"
                value={draft.currency}
                onChange={(event) => setDraft((state) => ({ ...state, currency: event.currentTarget.value.toUpperCase() }))}
                maxLength={3}
              />
            </Group>
            <NumberInput
              label="Opening Balance"
              value={draft.openingBalanceMinor / 100}
              decimalScale={2}
              onValueChange={({ value }) =>
                setDraft((state) => ({
                  ...state,
                  openingBalanceMinor: Math.round((Number(value) || 0) * 100),
                }))
              }
            />
            <Switch
              label="Account is active"
              checked={draft.isActive}
              onChange={(event) => setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))}
            />
            <Group justify="flex-end" mt="md">
              <Button variant="light" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit}>{editingAccount ? "Save changes" : "Create account"}</Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </PageAccessGuard>
  );
};

export default FinanceAccounts;

