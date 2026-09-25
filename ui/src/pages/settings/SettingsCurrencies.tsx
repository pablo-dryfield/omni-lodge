import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconEdit, IconHistory, IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

type CurrencyRecord = {
  code: string;
  name: string;
  exchangeRateToPln: number | string;
  isActive: boolean;
  lastRateUpdatedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type CurrencyHistoryRecord = {
  id: number;
  currencyCode: string;
  exchangeRateToPln: number | string;
  effectiveAt: string;
  source?: string | null;
  note?: string | null;
  createdAt?: string | null;
};

type CurrencyDraft = {
  code: string;
  name: string;
  exchangeRateToPln: number | "";
  isActive: boolean;
  note: string;
};

const PAGE_SLUG = PAGE_SLUGS.settingsProductPrices;

const DEFAULT_DRAFT: CurrencyDraft = {
  code: "",
  name: "",
  exchangeRateToPln: 1,
  isActive: true,
  note: "",
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  if (typeof data === "string") {
    return data;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const formatRate = (value: number | string | null | undefined) => {
  const rate = Number(value);
  return Number.isFinite(rate) ? rate.toFixed(rate === 1 ? 0 : 6) : "—";
};

const formatDateTime = (value?: string | null) =>
  value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—";

const SettingsCurrencies = () => {
  const [currencies, setCurrencies] = useState<CurrencyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState<CurrencyRecord | null>(null);
  const [draft, setDraft] = useState<CurrencyDraft>(DEFAULT_DRAFT);
  const [historyCurrency, setHistoryCurrency] = useState<CurrencyRecord | null>(null);
  const [historyRows, setHistoryRows] = useState<CurrencyHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const sortedCurrencies = useMemo(
    () => [...currencies].sort((a, b) => a.code.localeCompare(b.code)),
    [currencies],
  );

  const loadCurrencies = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axiosInstance.get<Array<{ data?: CurrencyRecord[] }>>("/currencies");
      setCurrencies(response.data[0]?.data ?? []);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Unable to load currencies."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCurrencies();
  }, []);

  const openCreate = () => {
    setEditingCurrency(null);
    setDraft(DEFAULT_DRAFT);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (currency: CurrencyRecord) => {
    setEditingCurrency(currency);
    setDraft({
      code: currency.code,
      name: currency.name,
      exchangeRateToPln: Number(currency.exchangeRateToPln) || 1,
      isActive: currency.isActive,
      note: "",
    });
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingCurrency(null);
    setDraft(DEFAULT_DRAFT);
  };

  const saveCurrency = async () => {
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim() || code;
    const rate = code === "PLN" ? 1 : Number(draft.exchangeRateToPln);
    if (!/^[A-Z]{3}$/.test(code)) {
      setError("Currency code must be a three-letter ISO code.");
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Exchange rate to PLN must be greater than zero.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        code,
        name,
        exchangeRateToPln: rate,
        isActive: draft.isActive,
        note: draft.note.trim() || undefined,
      };
      if (editingCurrency) {
        await axiosInstance.put(`/currencies/${encodeURIComponent(editingCurrency.code)}`, payload);
      } else {
        await axiosInstance.post("/currencies", payload);
      }
      closeModal();
      await loadCurrencies();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Unable to save this currency."));
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrency = async (currency: CurrencyRecord) => {
    const confirmed = window.confirm(`Delete ${currency.code}? Existing records may prevent deletion.`);
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await axiosInstance.delete(`/currencies/${encodeURIComponent(currency.code)}`);
      await loadCurrencies();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Unable to delete this currency."));
    }
  };

  const openHistory = async (currency: CurrencyRecord) => {
    setHistoryCurrency(currency);
    setHistoryRows([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const response = await axiosInstance.get<{ data?: CurrencyHistoryRecord[] }>(
        `/currencies/${encodeURIComponent(currency.code)}/history`,
      );
      setHistoryRows(response.data.data ?? []);
    } catch (loadError) {
      setHistoryError(getErrorMessage(loadError, "Unable to load exchange-rate history."));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>Currencies</Title>
            <Text size="sm" c="dimmed">
              Manage exchange rates used by manual bank-transfer bookings and currency-specific product prices.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            New currency
          </Button>
        </Group>

        {error ? <Alert color="red">{error}</Alert> : null}

        <ScrollArea type="auto">
          <Table highlightOnHover verticalSpacing="md" miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Code</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Rate to PLN</Table.Th>
                <Table.Th>Active</Table.Th>
                <Table.Th>Last rate update</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loading ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed">Loading currencies…</Text>
                  </Table.Td>
                </Table.Tr>
              ) : sortedCurrencies.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed">No currencies configured yet.</Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                sortedCurrencies.map((currency) => (
                  <Table.Tr key={currency.code}>
                    <Table.Td fw={800}>{currency.code}</Table.Td>
                    <Table.Td>{currency.name}</Table.Td>
                    <Table.Td>1 {currency.code} = {formatRate(currency.exchangeRateToPln)} PLN</Table.Td>
                    <Table.Td>
                      <Badge color={currency.isActive ? "teal" : "gray"} variant="light">
                        {currency.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatDateTime(currency.lastRateUpdatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="History">
                          <ActionIcon variant="subtle" onClick={() => void openHistory(currency)}>
                            <IconHistory size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Edit">
                          <ActionIcon variant="subtle" onClick={() => openEdit(currency)}>
                            <IconEdit size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={currency.code === "PLN" ? "PLN cannot be deleted" : "Delete"}>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            disabled={currency.code === "PLN"}
                            onClick={() => void deleteCurrency(currency)}
                          >
                            <IconTrash size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Modal
          opened={modalOpen}
          onClose={closeModal}
          title={editingCurrency ? `Edit ${editingCurrency.code}` : "New currency"}
          centered
        >
          <Stack gap="sm">
            <TextInput
              label="Code"
              description="Three-letter ISO code, for example EUR."
              value={draft.code}
              onChange={(event) =>
                setDraft((state) => ({ ...state, code: event.currentTarget.value.toUpperCase().slice(0, 3) }))
              }
              disabled={Boolean(editingCurrency)}
              withAsterisk
            />
            <TextInput
              label="Name"
              value={draft.name}
              onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
              placeholder="Euro"
              withAsterisk
            />
            <NumberInput
              label="Exchange rate to PLN"
              description="How many PLN equal 1 unit of this currency."
              value={draft.code.trim().toUpperCase() === "PLN" ? 1 : draft.exchangeRateToPln}
              min={0.000001}
              decimalScale={6}
              fixedDecimalScale={false}
              disabled={draft.code.trim().toUpperCase() === "PLN"}
              onChange={(value) =>
                setDraft((state) => ({ ...state, exchangeRateToPln: value === "" ? "" : Number(value) }))
              }
              withAsterisk
            />
            <Textarea
              label="Rate note"
              description="Optional reason/source saved only when the rate changes."
              value={draft.note}
              minRows={2}
              autosize
              onChange={(event) => setDraft((state) => ({ ...state, note: event.currentTarget.value }))}
            />
            <Switch
              label="Currency is active"
              checked={draft.isActive}
              onChange={(event) => setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeModal} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void saveCurrency()} loading={saving}>
                Save currency
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={Boolean(historyCurrency)}
          onClose={() => setHistoryCurrency(null)}
          title={historyCurrency ? `${historyCurrency.code} exchange-rate history` : "Exchange-rate history"}
          size="lg"
          centered
        >
          {historyError ? <Alert color="red">{historyError}</Alert> : null}
          <ScrollArea h={360} type="auto">
            <Table verticalSpacing="sm" miw={620}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Effective at</Table.Th>
                  <Table.Th>Rate</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Note</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {historyLoading ? (
                  <Table.Tr>
                    <Table.Td colSpan={4}>Loading history…</Table.Td>
                  </Table.Tr>
                ) : historyRows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={4}>No history recorded yet.</Table.Td>
                  </Table.Tr>
                ) : (
                  historyRows.map((row) => (
                    <Table.Tr key={row.id}>
                      <Table.Td>{formatDateTime(row.effectiveAt)}</Table.Td>
                      <Table.Td>{formatRate(row.exchangeRateToPln)}</Table.Td>
                      <Table.Td>{row.source || "—"}</Table.Td>
                      <Table.Td>{row.note || "—"}</Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Modal>
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsCurrencies;
