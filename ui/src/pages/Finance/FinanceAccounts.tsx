import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBuildingBank,
  IconEdit,
  IconInfoCircle,
  IconPlus,
  IconSettings,
  IconTrash,
  IconWallet,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceAccount,
  deleteFinanceAccount,
  fetchFinanceAccounts,
  updateFinanceAccount,
} from "../../actions/financeActions";
import { selectFinanceAccounts } from "../../selectors/financeSelectors";
import { FinanceAccount } from "../../types/finance";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
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
import {
  formatFinanceMoneyMinor,
  getFinanceErrorMessage,
  humanizeFinanceValue,
} from "../../components/finance/financeFormatters";

type DraftAccount = {
  name: string;
  type: FinanceAccount["type"];
  currency: string;
  openingBalanceMinor: number;
  isActive: boolean;
};

type AccountStatusFilter = "all" | "active" | "archived";
type AccountTypeFilter = "all" | FinanceAccount["type"];

const DEFAULT_DRAFT: DraftAccount = {
  name: "",
  type: "cash",
  currency: "PLN",
  openingBalanceMinor: 0,
  isActive: true,
};

const ACCOUNT_TYPE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "stripe", label: "Stripe" },
  { value: "revolut", label: "Revolut" },
  { value: "other", label: "Other" },
];

const FinanceAccounts = () => {
  const dispatch = useAppDispatch();
  const accounts = useAppSelector(selectFinanceAccounts);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinanceAccount | null>(null);
  const [draft, setDraft] = useState<DraftAccount>(DEFAULT_DRAFT);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<AccountTypeFilter>("all");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

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

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sortedAccounts.filter((account) => {
      const matchesSearch =
        !query ||
        account.name.toLocaleLowerCase().includes(query) ||
        account.currency.toLocaleLowerCase().includes(query) ||
        account.type.toLocaleLowerCase().includes(query);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? account.isActive : !account.isActive);
      const matchesType = typeFilter === "all" || account.type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [search, sortedAccounts, statusFilter, typeFilter]);

  const hasFilters = Boolean(search.trim()) || statusFilter !== "all" || typeFilter !== "all";

  const openNewAccount = () => {
    setEditingAccount(null);
    setDraft(DEFAULT_DRAFT);
    setActionError(null);
    setModalOpen(true);
  };

  const openEditAccount = (account: FinanceAccount) => {
    setEditingAccount(account);
    setActionError(null);
    setModalOpen(true);
  };

  const closeAccountModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingAccount(null);
    setActionError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
  };

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      setActionError("Account name is required.");
      return;
    }
    if (
      editingAccount
      && draft.currency.trim().toUpperCase() !== editingAccount.currency.trim().toUpperCase()
    ) {
      setActionError(
        "An existing account's currency cannot be changed because that would relabel its historical balances. Create a new account for the other currency instead.",
      );
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      if (editingAccount) {
        await dispatch(
          updateFinanceAccount({
            id: editingAccount.id,
            changes: {
              ...editingAccount,
              ...draft,
              name: draft.name.trim(),
              currency: draft.currency.trim().toUpperCase(),
            },
          }),
        ).unwrap();
      } else {
        await dispatch(
          createFinanceAccount({
            ...draft,
            name: draft.name.trim(),
            currency: draft.currency.trim().toUpperCase(),
          }),
        ).unwrap();
      }

      setModalOpen(false);
      setEditingAccount(null);
      setDraft(DEFAULT_DRAFT);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to save this account."));
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
      await dispatch(deleteFinanceAccount(deleteTarget.id)).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to delete this account."));
    } finally {
      setDeleting(false);
    }
  };

  const accountStatus = (account: FinanceAccount) => (
    <Badge color={account.isActive ? "teal" : "gray"} variant="light">
      {account.isActive ? "Active" : "Archived"}
    </Badge>
  );

  const mobileActions = (account: FinanceAccount) => (
    <>
      <Button
        size="xs"
        variant="light"
        leftSection={<IconEdit size={15} />}
        onClick={() => openEditAccount(account)}
        aria-label={`Edit account ${account.name}`}
        style={{ flex: "1 1 120px" }}
      >
        Edit
      </Button>
      <Button
        size="xs"
        variant="light"
        color="red"
        leftSection={<IconTrash size={15} />}
        onClick={() => {
          setActionError(null);
          setDeleteTarget(account);
        }}
        aria-label={`Delete account ${account.name}`}
        style={{ flex: "1 1 120px" }}
      >
        Delete
      </Button>
    </>
  );

  const emptyState = (
    <FinanceEmptyState
      icon={<IconWallet size={25} />}
      title={hasFilters ? "No accounts match these filters" : "Create your first finance account"}
      description={
        hasFilters
          ? "Try another name, account type, or status to find the account you need."
          : "Add the cash, bank, or payment-processor account that will hold Finance transactions."
      }
      action={
        hasFilters ? (
          <Button variant="light" onClick={clearFilters}>Clear filters</Button>
        ) : (
          <FinancePrimaryAction leftSection={<IconPlus size={16} />} onClick={openNewAccount}>
            New account
          </FinancePrimaryAction>
        )
      }
    />
  );

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.finance}>
      <Stack className={financePageClass} gap="lg">
        <FinancePageHeader
          eyebrow="Finance setup"
          title="Accounts"
          description="Manage the cash, bank, and payment accounts that receive and fund every Finance transaction."
          icon={<IconBuildingBank size={24} />}
          actions={
            <FinancePrimaryAction leftSection={<IconPlus size={17} />} onClick={openNewAccount}>
              New account
            </FinancePrimaryAction>
          }
        />

        <FinanceToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search accounts by name, type, or currency"
        >
          <Select
            aria-label="Filter accounts by status"
            value={statusFilter}
            onChange={(value) => setStatusFilter((value ?? "all") as AccountStatusFilter)}
            data={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
            w={170}
          />
          <Select
            aria-label="Filter accounts by type"
            value={typeFilter}
            onChange={(value) => setTypeFilter((value ?? "all") as AccountTypeFilter)}
            data={[{ value: "all", label: "All account types" }, ...ACCOUNT_TYPE_OPTIONS]}
            w={190}
          />
          <Text size="xs" c="dimmed" fw={700} ml="auto">
            {filteredAccounts.length} of {accounts.data.length} accounts
          </Text>
        </FinanceToolbar>

        {accounts.error ? (
          <FinanceErrorState
            title="Accounts could not be loaded"
            message={accounts.error}
            onRetry={() => {
              void dispatch(fetchFinanceAccounts());
            }}
          />
        ) : null}

        {isMobile ? (
          accounts.loading ? (
            <FinanceLoadingState label="Loading accounts" />
          ) : filteredAccounts.length === 0 ? (
            emptyState
          ) : (
            <Stack gap="sm">
              {filteredAccounts.map((account) => (
                <FinanceRecordCard
                  key={account.id}
                  title={account.name}
                  subtitle={humanizeFinanceValue(account.type)}
                  leading={
                    <ThemeIcon variant="light" radius="md" size={38}>
                      <IconWallet size={19} />
                    </ThemeIcon>
                  }
                  status={accountStatus(account)}
                  fields={[
                    { label: "Currency", value: account.currency },
                    {
                      label: "Opening balance",
                      value: formatFinanceMoneyMinor(account.openingBalanceMinor, account.currency),
                    },
                  ]}
                  actions={mobileActions(account)}
                />
              ))}
            </Stack>
          )
        ) : (
          <FinancePanel
            title="Account directory"
            description="Opening balances establish the starting position before recorded Finance activity."
            icon={<IconWallet size={18} />}
            noPadding
          >
            {accounts.loading ? (
              <FinanceLoadingState label="Loading accounts" />
            ) : filteredAccounts.length === 0 ? (
              emptyState
            ) : (
              <ScrollArea offsetScrollbars type="auto">
                <Table highlightOnHover verticalSpacing="md" miw={760}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Account</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Currency</Table.Th>
                      <Table.Th ta="right">Opening balance</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th ta="right">Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredAccounts.map((account) => (
                      <Table.Tr key={account.id}>
                        <Table.Td>
                          <Text fw={750}>{account.name}</Text>
                        </Table.Td>
                        <Table.Td>{humanizeFinanceValue(account.type)}</Table.Td>
                        <Table.Td>{account.currency}</Table.Td>
                        <Table.Td ta="right" fw={700}>
                          {formatFinanceMoneyMinor(account.openingBalanceMinor, account.currency)}
                        </Table.Td>
                        <Table.Td>{accountStatus(account)}</Table.Td>
                        <Table.Td>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <Tooltip label={`Edit ${account.name}`}>
                              <ActionIcon
                                variant="subtle"
                                onClick={() => openEditAccount(account)}
                                aria-label={`Edit account ${account.name}`}
                              >
                                <IconEdit size={18} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={`Delete ${account.name}`}>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                onClick={() => {
                                  setActionError(null);
                                  setDeleteTarget(account);
                                }}
                                aria-label={`Delete account ${account.name}`}
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
          onClose={closeAccountModal}
          title={editingAccount ? "Edit account" : "New account"}
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
                title="Account identity"
                description="Use a recognizable name and choose how this account is held."
                icon={<IconBuildingBank size={18} />}
              >
                <TextInput
                  label="Name"
                  placeholder="For example: Main cash box"
                  value={draft.name}
                  onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
                  withAsterisk
                  autoFocus
                />
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <Select
                    label="Type"
                    value={draft.type}
                    data={ACCOUNT_TYPE_OPTIONS}
                    onChange={(value) =>
                      setDraft((state) => ({
                        ...state,
                        type: (value ?? "cash") as DraftAccount["type"],
                      }))
                    }
                  />
                  <TextInput
                    label="Currency"
                    description={
                      editingAccount
                        ? "Locked after creation to preserve the currency of historical balances. Create a new account to use another currency."
                        : "Three-letter ISO code"
                    }
                    value={draft.currency}
                    onChange={(event) =>
                      setDraft((state) => ({ ...state, currency: event.currentTarget.value.toUpperCase() }))
                    }
                    maxLength={3}
                    readOnly={Boolean(editingAccount)}
                    withAsterisk
                  />
                </SimpleGrid>
              </FinanceFormSection>

              <FinanceFormSection
                title="Opening position"
                description="Enter the account balance immediately before Finance tracking begins."
                icon={<IconInfoCircle size={18} />}
              >
                <NumberInput
                  label="Opening balance"
                  value={draft.openingBalanceMinor / 100}
                  decimalScale={2}
                  fixedDecimalScale
                  suffix={draft.currency ? ` ${draft.currency}` : undefined}
                  onValueChange={({ value }) =>
                    setDraft((state) => ({
                      ...state,
                      openingBalanceMinor: Math.round((Number(value) || 0) * 100),
                    }))
                  }
                />
              </FinanceFormSection>

              <FinanceFormSection
                title="Availability"
                description="Archived accounts remain in history but are clearly marked in the directory."
                icon={<IconSettings size={18} />}
              >
                <Switch
                  label="Account is active"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))
                  }
                />
              </FinanceFormSection>

              {actionError ? <Alert color="red">{actionError}</Alert> : null}

              <FinanceModalFooter>
                <Button variant="default" onClick={closeAccountModal} disabled={saving} fullWidth={isMobile}>
                  Cancel
                </Button>
                <FinancePrimaryAction
                  type="submit"
                  loading={saving}
                  disabled={!draft.name.trim() || draft.currency.trim().length !== 3}
                  fullWidth={isMobile}
                >
                  {editingAccount ? "Save changes" : "Create account"}
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
          title="Delete account?"
          description={`Delete ${deleteTarget?.name ?? "this account"}? Accounts referenced by Finance records may not be removable.`}
          confirmLabel="Delete account"
          loading={deleting}
        >
          {actionError ? <Alert color="red">{actionError}</Alert> : null}
        </FinanceConfirmModal>
      </Stack>
    </PageAccessGuard>
  );
};

export default FinanceAccounts;
