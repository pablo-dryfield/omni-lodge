import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActionIcon,
  Badge,
  Button,
  FileInput,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconPackage,
  IconPlus,
  IconReceipt,
  IconTrash,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import {
  FinanceEmptyState,
  FinanceFormSection,
  FinanceLoadingState,
  FinanceMetricCard,
  FinanceModal,
  FinanceModalFooter,
  FinancePageHeader,
  FinancePanel,
} from "../../components/finance/FinanceUi";
import { formatFinanceMoneyMinor } from "../../components/finance/financeFormatters";

type Item = {
  id: number;
  name: string;
  sku: string;
  unit: string;
  reorderLevel: number | string;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  lowStock: boolean;
};
type Mapping = {
  id: number;
  addonId: number;
  addonName: string | null;
  inventoryItemId: number;
  quantityPerAddon: number | string;
  variant: string | null;
};
type Option = {
  id: number;
  name: string;
  currency?: string;
  kind?: string;
  originalName?: string;
};
type Purchase = {
  id: number;
  date: string;
  invoiceNumber: string | null;
  currency: string;
  totalMinor: number;
  financeTransactionId: number;
  items: Array<{
    id: number;
    inventoryItemId: number;
    quantity: number | string;
    unitCostMinor: number;
  }>;
};
type Fulfillment = {
  id: number;
  inventoryItemId: number;
  addonId: number;
  bookingId: number | null;
  counterId: number | null;
  quantity: number | string;
  status: string;
  deliveryMethod: string;
  recipientName: string;
  email: string | null;
  address: string | null;
  size: string | null;
  trackingNumber: string | null;
  createdAt: string;
};
type Incident = {
  id: number;
  inventoryItemId: number;
  addonId: number | null;
  bookingId: number | null;
  counterId: number | null;
  quantityDelta: number | string;
  incidentKind: string | null;
  notes: string | null;
  date: string;
};
type PurchaseLine = { id: number; inventoryItemId: string; quantity: number; unitCost: number };
let nextPurchaseLineId = 2;

const calculatePurchaseLineTotalMinor = (line: PurchaseLine): number => {
  const quantity = Number(line.quantity) || 0;
  const unitCostMinor = Math.round((Number(line.unitCost) || 0) * 100);
  return Math.round(quantity * unitCostMinor);
};

const FinanceInventory = () => {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [items, setItems] = useState<Item[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [addons, setAddons] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState({
    name: "",
    sku: "",
    reorderLevel: 0,
  });
  const [mappingForm, setMappingForm] = useState({
    addonId: "",
    inventoryItemId: "",
    quantityPerAddon: 1,
    variant: "",
  });
  const [adjust, setAdjust] = useState({
    inventoryItemId: "",
    quantityDelta: 1,
    type: "initial_stock",
    date: dayjs().format("YYYY-MM-DD"),
    unitCost: 0,
    notes: "",
  });
  const [purchase, setPurchase] = useState({
    date: dayjs().format("YYYY-MM-DD"),
    vendorId: "",
    accountId: "",
    categoryId: "",
    currency: "PLN",
    status: "paid",
    invoiceNumber: "",
    notes: "",
  });
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([{ id: 1, inventoryItemId: "", quantity: 1, unitCost: 0 }]);
  const [invoice, setInvoice] = useState<File | null>(null);
  const [promise, setPromise] = useState({
    inventoryItemId: "",
    addonId: "",
    bookingId: "",
    counterId: "",
    quantity: 1,
    deliveryMethod: "mail",
    recipientName: "",
    email: "",
    phone: "",
    address: "",
    size: "",
    notes: "",
  });
  const [incident, setIncident] = useState({
    addonId: "",
    inventoryItemId: "",
    quantity: 1,
    incidentKind: "retake",
    bookingId: "",
    counterId: "",
    date: dayjs().format("YYYY-MM-DD"),
    notes: "",
  });
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [overview, purchaseRows, finance, addonRows, fulfillmentRows] =
        await Promise.all([
          axiosInstance.get("/inventory/overview"),
          axiosInstance.get("/inventory/purchases"),
          axiosInstance.get("/inventory/finance-options"),
          axiosInstance.get("/addons?active=true"),
          axiosInstance.get("/inventory/fulfillments"),
        ]);
      setItems(overview.data.items);
      setMappings(overview.data.mappings);
      setIncidents(overview.data.incidents ?? []);
      setPurchases(purchaseRows.data.purchases);
      setFulfillments(fulfillmentRows.data.fulfillments);
      setAccounts(finance.data.accounts);
      setCategories(
        finance.data.categories.filter((x: Option) => x.kind === "expense"),
      );
      setVendors(finance.data.vendors);
      setAddons(
        addonRows.data.map((x: any) => ({ id: x.addonId, name: x.name })),
      );
    } catch (e: any) {
      setError(e.response?.data?.[0]?.message ?? e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    try {
      setBusy(true);
      setError("");
      await action();
      await load();
    } catch (e: any) {
      setError(e.response?.data?.[0]?.message ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const itemOptions = items.map((x) => ({
    value: String(x.id),
    label: `${x.name} (${x.sku})`,
  }));
  const purchaseTotalMinor = purchaseLines.reduce(
    (sum, line) => sum + calculatePurchaseLineTotalMinor(line),
    0,
  );
  const purchaseLinesValid = purchaseLines.length > 0 && purchaseLines.every(line => line.inventoryItemId && line.quantity > 0 && line.unitCost > 0);
  const purchaseValid = Boolean(
    purchase.date && purchase.vendorId && purchase.accountId && purchase.categoryId && purchase.currency.trim()
      && purchaseLinesValid,
  );
  const incidentValid = Boolean(
    incident.addonId && incident.inventoryItemId && incident.quantity > 0 && incident.date,
  );
  const promiseValid = Boolean(
    promise.addonId && promise.inventoryItemId && promise.quantity > 0 && promise.recipientName.trim(),
  );
  const adjustmentValid = Boolean(
    adjust.inventoryItemId && adjust.quantityDelta !== 0 && adjust.date,
  );
  const mappingValid = Boolean(
    mappingForm.addonId && mappingForm.inventoryItemId && mappingForm.quantityPerAddon > 0,
  );
  const option = (rows: Option[]) =>
    rows.map((x) => ({ value: String(x.id), label: x.name }));

  const openItemModal = () => {
    setError("");
    setItemOpen(true);
  };

  const handleRecordIncident = () => {
    if (!incidentValid) {
      setError("Select an add-on, stock item, positive quantity, and date.");
      return;
    }
    void run(() =>
      axiosInstance.post("/inventory/usage-incidents", {
        ...incident,
        addonId: Number(incident.addonId),
        inventoryItemId: Number(incident.inventoryItemId),
        bookingId: incident.bookingId ? Number(incident.bookingId) : null,
        counterId: incident.counterId ? Number(incident.counterId) : null,
      }),
    );
  };

  const handleCreatePromise = () => {
    if (!promiseValid) {
      setError("Select an add-on and stock item, enter a positive quantity, and add the recipient name.");
      return;
    }
    void run(() =>
      axiosInstance.post("/inventory/fulfillments", {
        ...promise,
        inventoryItemId: Number(promise.inventoryItemId),
        addonId: Number(promise.addonId),
        bookingId: promise.bookingId ? Number(promise.bookingId) : null,
        counterId: promise.counterId ? Number(promise.counterId) : null,
      }),
    );
  };

  const handleSavePurchase = () => {
    if (!purchaseValid) {
      setError("Complete the purchase date, vendor, payment account, expense category, and every item line.");
      return;
    }
    void run(async () => {
      let invoiceFileId: null | number = null;
      if (invoice) {
        const fd = new FormData();
        fd.append("file", invoice);
        const uploaded = await axiosInstance.post("/finance/files", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        invoiceFileId = uploaded.data.id;
      }
      await axiosInstance.post("/inventory/purchases", {
        ...purchase,
        vendorId: Number(purchase.vendorId),
        accountId: Number(purchase.accountId),
        categoryId: Number(purchase.categoryId),
        invoiceFileId,
        totalMinor: purchaseTotalMinor,
        items: purchaseLines.map((line) => ({
          inventoryItemId: Number(line.inventoryItemId),
          quantity: line.quantity,
          unitCostMinor: Math.round(line.unitCost * 100),
        })),
      });
      setInvoice(null);
      setPurchaseLines([{ id: nextPurchaseLineId++, inventoryItemId: "", quantity: 1, unitCost: 0 }]);
    });
  };

  const handlePostAdjustment = () => {
    if (!adjustmentValid) {
      setError("Select a stock item, enter a non-zero quantity change, and choose a date.");
      return;
    }
    void run(() =>
      axiosInstance.post("/inventory/adjustments", {
        ...adjust,
        inventoryItemId: Number(adjust.inventoryItemId),
        unitCostMinor: Math.round(adjust.unitCost * 100),
      }),
    );
  };

  const handleAddMapping = () => {
    if (!mappingValid) {
      setError("Select an add-on and stock item, then enter a positive usage quantity.");
      return;
    }
    void run(() =>
      axiosInstance.post("/inventory/mappings", {
        ...mappingForm,
        addonId: Number(mappingForm.addonId),
        inventoryItemId: Number(mappingForm.inventoryItemId),
      }),
    );
  };
  return (
    <Stack gap="lg">
      <FinancePageHeader
        eyebrow="Operations"
        title="Inventory & purchases"
        description="Control stock, fulfill promised items, record waste and connect every purchase to its Finance expense."
        icon={<IconPackage size={22} />}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={openItemModal}>
            New stock item
          </Button>
        }
      />
      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          withCloseButton
          closeButtonLabel="Dismiss inventory error"
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}
      {loading && items.length === 0 ? (
        <FinancePanel noPadding>
          <FinanceLoadingState label="Loading inventory and purchase data" />
        </FinancePanel>
      ) : items.length > 0 ? (
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
          {items.map((x) => (
            <FinanceMetricCard
              key={x.id}
              label={x.name}
              value={`${x.availableStock} ${x.unit}`}
              description={`${x.currentStock} on hand · ${x.reservedStock} reserved · reorder at ${x.reorderLevel}`}
              icon={<IconPackage size={21} />}
              accent={x.lowStock ? "rose" : "blue"}
              detail={x.lowStock ? <Badge color="red" variant="light">Low stock</Badge> : <Text size="xs" c="dimmed">{x.sku}</Text>}
            />
          ))}
        </SimpleGrid>
      ) : (
        <FinancePanel noPadding>
          <FinanceEmptyState
            title="No stock items yet"
            description="Create the first inventory item to begin tracking purchases, usage and fulfillment."
            icon={<IconPackage size={25} />}
            action={<Button leftSection={<IconPlus size={16} />} onClick={openItemModal}>Create stock item</Button>}
          />
        </FinancePanel>
      )}
      <FinancePanel noPadding>
        <Tabs defaultValue="fulfillments" p={isMobile ? "sm" : "md"}>
          <ScrollArea type="auto" scrollbarSize={5} offsetScrollbars>
            <Tabs.List style={{ flexWrap: "nowrap", width: "max-content", minWidth: "100%" }}>
              <Tabs.Tab value="fulfillments">Mail-later queue</Tabs.Tab>
              <Tabs.Tab value="incidents">Retakes & waste</Tabs.Tab>
              <Tabs.Tab value="purchases" leftSection={<IconReceipt size={16} />}>
                Purchases
              </Tabs.Tab>
              <Tabs.Tab value="adjustments">Stock adjustment</Tabs.Tab>
              <Tabs.Tab value="mappings">Add-on mappings</Tabs.Tab>
              <Tabs.Tab value="history" leftSection={<IconPackage size={16} />}>
                Purchase history
              </Tabs.Tab>
            </Tabs.List>
          </ScrollArea>
        <Tabs.Panel value="incidents" pt="md">
          <Stack>
            <Paper
              component="form"
              withBorder
              p="md"
              onSubmit={(event) => {
                event.preventDefault();
                handleRecordIncident();
              }}
            >
              <Stack>
                <Title order={3} size="h4">Record an extra photo or damaged item</Title>
                <Text size="sm" c="dimmed">
                  Use Retake when a photo failed and another one was produced.
                  This deducts the extra film immediately.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Select
                    label="Add-on"
                    withAsterisk
                    data={option(addons)}
                    value={incident.addonId}
                    onChange={(v) => {
                      const match = mappings.find(
                        (x) => String(x.addonId) === v,
                      );
                      setIncident({
                        ...incident,
                        addonId: v ?? "",
                        inventoryItemId: match
                          ? String(match.inventoryItemId)
                          : incident.inventoryItemId,
                      });
                    }}
                  />
                  <Select
                    label="Stock item"
                    withAsterisk
                    data={itemOptions}
                    value={incident.inventoryItemId}
                    onChange={(v) =>
                      setIncident({ ...incident, inventoryItemId: v ?? "" })
                    }
                  />
                  <Select
                    label="Reason"
                    data={[
                      { value: "retake", label: "Photo retake" },
                      { value: "damaged", label: "Damaged item" },
                      { value: "waste", label: "Waste" },
                      { value: "complimentary", label: "Complimentary extra" },
                      { value: "other", label: "Other" },
                    ]}
                    value={incident.incidentKind}
                    onChange={(v) =>
                      setIncident({ ...incident, incidentKind: v ?? "retake" })
                    }
                  />
                  <NumberInput
                    label="Extra quantity used"
                    withAsterisk
                    min={1}
                    value={incident.quantity}
                    onChange={(v) =>
                      setIncident({ ...incident, quantity: Number(v) })
                    }
                  />
                  <NumberInput
                    label="Booking ID"
                    value={
                      incident.bookingId
                        ? Number(incident.bookingId)
                        : undefined
                    }
                    onChange={(v) =>
                      setIncident({ ...incident, bookingId: String(v ?? "") })
                    }
                  />
                  <NumberInput
                    label="Counter ID"
                    value={
                      incident.counterId
                        ? Number(incident.counterId)
                        : undefined
                    }
                    onChange={(v) =>
                      setIncident({ ...incident, counterId: String(v ?? "") })
                    }
                  />
                  <TextInput
                    type="date"
                    label="Date"
                    withAsterisk
                    value={incident.date}
                    onChange={(e) =>
                      setIncident({ ...incident, date: e.currentTarget.value })
                    }
                  />
                </SimpleGrid>
                <Textarea
                  label="What happened?"
                  value={incident.notes}
                  onChange={(e) =>
                    setIncident({ ...incident, notes: e.currentTarget.value })
                  }
                />
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!incidentValid}
                >
                  Record extra usage
                </Button>
              </Stack>
            </Paper>
            <ScrollArea type="auto" offsetScrollbars tabIndex={0} aria-label="Inventory usage incident history">
            <Table striped miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Reason</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th>Quantity</Table.Th>
                  <Table.Th>References</Table.Th>
                  <Table.Th>Notes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {incidents.map((x) => (
                  <Table.Tr key={x.id}>
                    <Table.Td>{x.date}</Table.Td>
                    <Table.Td>{x.incidentKind ?? "damage"}</Table.Td>
                    <Table.Td>
                      {items.find((i) => i.id === x.inventoryItemId)?.name}
                    </Table.Td>
                    <Table.Td>{Math.abs(Number(x.quantityDelta))}</Table.Td>
                    <Table.Td>
                      {x.bookingId ? `Booking #${x.bookingId}` : ""}
                      {x.counterId ? ` Counter #${x.counterId}` : ""}
                    </Table.Td>
                    <Table.Td>{x.notes ?? "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </ScrollArea>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="fulfillments" pt="md">
          <Stack>
            <Paper
              component="form"
              withBorder
              p="md"
              onSubmit={(event) => {
                event.preventDefault();
                handleCreatePromise();
              }}
            >
              <Stack>
                <Title order={3} size="h4">Add promised item</Title>
                <Text size="sm" c="dimmed">
                  Create this before finalizing the counter so it is not counted
                  as handed out. Existing promises can be entered at any time.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Select
                    label="Add-on"
                    withAsterisk
                    data={option(addons)}
                    value={promise.addonId}
                    onChange={(v) => {
                      const match = mappings.find(
                        (x) => String(x.addonId) === v,
                      );
                      setPromise({
                        ...promise,
                        addonId: v ?? "",
                        inventoryItemId: match
                          ? String(match.inventoryItemId)
                          : promise.inventoryItemId,
                      });
                    }}
                  />
                  <Select
                    label="Stock item"
                    withAsterisk
                    data={itemOptions}
                    value={promise.inventoryItemId}
                    onChange={(v) =>
                      setPromise({ ...promise, inventoryItemId: v ?? "" })
                    }
                  />
                  <NumberInput
                    label="Quantity"
                    withAsterisk
                    min={1}
                    value={promise.quantity}
                    onChange={(v) =>
                      setPromise({ ...promise, quantity: Number(v) })
                    }
                  />
                  <TextInput
                    label="Size / variant"
                    value={promise.size}
                    onChange={(e) =>
                      setPromise({ ...promise, size: e.currentTarget.value })
                    }
                  />
                  <NumberInput
                    label="Booking ID"
                    value={
                      promise.bookingId ? Number(promise.bookingId) : undefined
                    }
                    onChange={(v) =>
                      setPromise({ ...promise, bookingId: String(v ?? "") })
                    }
                  />
                  <NumberInput
                    label="Counter ID"
                    description="Required to exclude it from that counter's immediate stock usage"
                    value={
                      promise.counterId ? Number(promise.counterId) : undefined
                    }
                    onChange={(v) =>
                      setPromise({ ...promise, counterId: String(v ?? "") })
                    }
                  />
                  <Select
                    label="Delivery"
                    data={[
                      { value: "mail", label: "Mail" },
                      { value: "collection", label: "Collection" },
                    ]}
                    value={promise.deliveryMethod}
                    onChange={(v) =>
                      setPromise({ ...promise, deliveryMethod: v ?? "mail" })
                    }
                  />
                  <TextInput
                    label="Recipient"
                    withAsterisk
                    value={promise.recipientName}
                    onChange={(e) =>
                      setPromise({
                        ...promise,
                        recipientName: e.currentTarget.value,
                      })
                    }
                  />
                  <TextInput
                    type="email"
                    label="Email"
                    value={promise.email}
                    onChange={(e) =>
                      setPromise({ ...promise, email: e.currentTarget.value })
                    }
                  />
                  <TextInput
                    type="tel"
                    label="Phone"
                    value={promise.phone}
                    onChange={(e) =>
                      setPromise({ ...promise, phone: e.currentTarget.value })
                    }
                  />
                </SimpleGrid>
                <Textarea
                  label="Mailing address"
                  value={promise.address}
                  onChange={(e) =>
                    setPromise({ ...promise, address: e.currentTarget.value })
                  }
                />
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!promiseValid}
                >
                  Create promise
                </Button>
              </Stack>
            </Paper>
            <ScrollArea type="auto" offsetScrollbars tabIndex={0} aria-label="Inventory fulfillment queue">
            <Table striped highlightOnHover miw={900}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Recipient</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th>Reference</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {fulfillments.map((x) => (
                  <Table.Tr key={x.id}>
                    <Table.Td>
                      {dayjs(x.createdAt).format("YYYY-MM-DD")}
                    </Table.Td>
                    <Table.Td>
                      {x.recipientName}
                      <Text size="xs" c="dimmed">
                        {x.email ?? x.address ?? ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {x.quantity}{" "}
                      {items.find((i) => i.id === x.inventoryItemId)?.name}
                      {x.size ? ` · ${x.size}` : ""}
                    </Table.Td>
                    <Table.Td>
                      {x.bookingId ? `Booking #${x.bookingId}` : ""}
                      {x.counterId ? ` · Counter #${x.counterId}` : ""}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={
                          x.status === "waiting_stock"
                            ? "orange"
                            : x.status === "ready"
                              ? "blue"
                              : x.status === "cancelled"
                                ? "gray"
                                : "green"
                        }
                      >
                        {x.status.replace("_", " ")}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        {x.status === "ready" && (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() =>
                              run(() =>
                                axiosInstance.patch(
                                  `/inventory/fulfillments/${x.id}`,
                                  { status: "packed" },
                                ),
                              )
                            }
                          >
                            Packed
                          </Button>
                        )}
                        {x.status === "packed" && (
                          <Button
                            size="xs"
                            onClick={() =>
                              run(() =>
                                axiosInstance.patch(
                                  `/inventory/fulfillments/${x.id}`,
                                  {
                                    status:
                                      x.deliveryMethod === "collection"
                                        ? "collected"
                                        : "shipped",
                                  },
                                ),
                              )
                            }
                          >
                            {x.deliveryMethod === "collection"
                              ? "Collected"
                              : "Shipped"}
                          </Button>
                        )}
                        {!["shipped", "collected", "cancelled"].includes(
                          x.status,
                        ) && (
                          <Button
                            size="xs"
                            color="red"
                            variant="subtle"
                            onClick={() =>
                              run(() =>
                                axiosInstance.patch(
                                  `/inventory/fulfillments/${x.id}`,
                                  { status: "cancelled" },
                                ),
                              )
                            }
                          >
                            Cancel
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </ScrollArea>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="purchases" pt="md">
          <Paper
            component="form"
            withBorder
            p="md"
            onSubmit={(event) => {
              event.preventDefault();
              handleSavePurchase();
            }}
          >
            <Stack>
              <Title order={3} size="h4">Record purchase and Finance expense</Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <TextInput
                  type="date"
                  label="Purchase date"
                  withAsterisk
                  value={purchase.date}
                  onChange={(e) =>
                    setPurchase({ ...purchase, date: e.currentTarget.value })
                  }
                />
                <Select
                  searchable
                  label="Vendor"
                  withAsterisk
                  data={option(vendors)}
                  value={purchase.vendorId}
                  onChange={(v) =>
                    setPurchase({ ...purchase, vendorId: v ?? "" })
                  }
                />
                <Select
                  label="Payment account"
                  withAsterisk
                  data={option(accounts)}
                  value={purchase.accountId}
                  onChange={(v) => {
                    const a = accounts.find((x) => String(x.id) === v);
                    setPurchase({
                      ...purchase,
                      accountId: v ?? "",
                      currency: a?.currency ?? purchase.currency,
                    });
                  }}
                />
                <Select
                  label="Expense category"
                  withAsterisk
                  data={option(categories)}
                  value={purchase.categoryId}
                  onChange={(v) =>
                    setPurchase({ ...purchase, categoryId: v ?? "" })
                  }
                />
                <TextInput
                  label="Invoice number"
                  value={purchase.invoiceNumber}
                  onChange={(e) =>
                    setPurchase({
                      ...purchase,
                      invoiceNumber: e.currentTarget.value,
                    })
                  }
                />
                <FileInput
                  label="Invoice file"
                  placeholder="PDF or image"
                  accept="application/pdf,image/*"
                  value={invoice}
                  onChange={setInvoice}
                />
                <Select
                  label="Finance status"
                  value={purchase.status}
                  data={[
                    { value: "paid", label: "Paid" },
                    { value: "approved", label: "Approved" },
                    { value: "planned", label: "Planned" },
                    {
                      value: "awaiting_reimbursement",
                      label: "Awaiting reimbursement",
                    },
                  ]}
                  onChange={(v) =>
                    setPurchase({ ...purchase, status: v ?? "paid" })
                  }
                />
              </SimpleGrid>
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between"><div><Text fw={700}>Purchase items</Text><Text size="sm" c="dimmed">Add every stock item included on this invoice.</Text></div><Button type="button" size="xs" variant="light" leftSection={<IconPlus size={14}/>} onClick={() => setPurchaseLines(lines => [...lines, { id: nextPurchaseLineId++, inventoryItemId: "", quantity: 1, unitCost: 0 }])}>Add item</Button></Group>
                  {purchaseLines.map((line, index) => (
                    <SimpleGrid key={line.id} cols={{ base: 1, sm: 4 }} style={{ alignItems: "end" }}>
                      <Select
                        searchable
                        withAsterisk
                        label={`Stock item ${index + 1}`}
                        data={itemOptions}
                        value={line.inventoryItemId}
                        onChange={(value) =>
                          setPurchaseLines((lines) =>
                            lines.map((current) =>
                              current.id === line.id
                                ? { ...current, inventoryItemId: value ?? "" }
                                : current,
                            ),
                          )
                        }
                      />
                      <NumberInput
                        withAsterisk
                        min={0.001}
                        decimalScale={3}
                        label="Quantity"
                        value={line.quantity}
                        onChange={(value) =>
                          setPurchaseLines((lines) =>
                            lines.map((current) =>
                              current.id === line.id
                                ? { ...current, quantity: Number(value) }
                                : current,
                            ),
                          )
                        }
                      />
                      <NumberInput
                        withAsterisk
                        min={0.01}
                        decimalScale={2}
                        label={`Unit cost (${purchase.currency})`}
                        value={line.unitCost}
                        onChange={(value) =>
                          setPurchaseLines((lines) =>
                            lines.map((current) =>
                              current.id === line.id
                                ? { ...current, unitCost: Number(value) }
                                : current,
                            ),
                          )
                        }
                      />
                      <Group gap="xs">
                        <Text fw={600} style={{ flex: 1 }}>
                          {formatFinanceMoneyMinor(calculatePurchaseLineTotalMinor(line), purchase.currency)}
                        </Text>
                        <ActionIcon
                          type="button"
                          color="red"
                          variant="subtle"
                          aria-label={`Remove item ${index + 1}`}
                          disabled={purchaseLines.length === 1}
                          onClick={() =>
                            setPurchaseLines((lines) => lines.filter((current) => current.id !== line.id))
                          }
                        >
                          <IconTrash size={17} />
                        </ActionIcon>
                      </Group>
                    </SimpleGrid>
                  ))}
                </Stack>
              </Paper>
              <Textarea
                label="Notes"
                value={purchase.notes}
                onChange={(e) =>
                  setPurchase({ ...purchase, notes: e.currentTarget.value })
                }
              />
              <Group justify="flex-end">
                <Text fw={600}>
                  Total: {formatFinanceMoneyMinor(purchaseTotalMinor, purchase.currency)}
                </Text>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!purchaseValid}
                >
                  Save purchase
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="adjustments" pt="md">
          <Paper
            component="form"
            withBorder
            p="md"
            onSubmit={(event) => {
              event.preventDefault();
              handlePostAdjustment();
            }}
          >
            <Stack>
              <Title order={3} size="h4">Initial stock or adjustment</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Stock item"
                  withAsterisk
                  data={itemOptions}
                  value={adjust.inventoryItemId}
                  onChange={(v) =>
                    setAdjust({ ...adjust, inventoryItemId: v ?? "" })
                  }
                />
                <Select
                  label="Reason"
                  data={[
                    ["initial_stock", "Initial stock"],
                    ["adjustment", "Manual adjustment"],
                    ["damage", "Damage / loss"],
                    ["return", "Return"],
                    ["correction", "Correction"],
                  ].map(([value, label]) => ({ value, label }))}
                  value={adjust.type}
                  onChange={(v) =>
                    setAdjust({ ...adjust, type: v ?? "adjustment" })
                  }
                />
                <NumberInput
                  label="Quantity change"
                  withAsterisk
                  description="Use a negative number to reduce stock"
                  value={adjust.quantityDelta}
                  onChange={(v) =>
                    setAdjust({ ...adjust, quantityDelta: Number(v) })
                  }
                />
                <NumberInput
                  label="Estimated unit cost"
                  decimalScale={2}
                  value={adjust.unitCost}
                  onChange={(v) =>
                    setAdjust({ ...adjust, unitCost: Number(v) })
                  }
                />
                <TextInput
                  type="date"
                  label="Date"
                  withAsterisk
                  value={adjust.date}
                  onChange={(e) =>
                    setAdjust({ ...adjust, date: e.currentTarget.value })
                  }
                />
              </SimpleGrid>
              <Textarea
                label="Notes"
                value={adjust.notes}
                onChange={(e) =>
                  setAdjust({ ...adjust, notes: e.currentTarget.value })
                }
              />
              <Button
                type="submit"
                loading={busy}
                disabled={!adjustmentValid}
              >
                Post adjustment
              </Button>
            </Stack>
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="mappings" pt="md">
          <Stack>
            <Paper
              component="form"
              withBorder
              p="md"
              onSubmit={(event) => {
                event.preventDefault();
                handleAddMapping();
              }}
            >
              <SimpleGrid cols={{ base: 1, sm: 4 }}>
                <Select
                  label="Add-on"
                  withAsterisk
                  data={option(addons)}
                  value={mappingForm.addonId}
                  onChange={(v) =>
                    setMappingForm({ ...mappingForm, addonId: v ?? "" })
                  }
                />
                <Select
                  label="Stock item"
                  withAsterisk
                  data={itemOptions}
                  value={mappingForm.inventoryItemId}
                  onChange={(v) =>
                    setMappingForm({ ...mappingForm, inventoryItemId: v ?? "" })
                  }
                />
                <Select clearable label="Size / variant" description="Required for size-controlled T-shirts" data={["XS", "S", "M", "L", "XL", "XXL"]} value={mappingForm.variant} onChange={(v) => setMappingForm({ ...mappingForm, variant: v ?? "" })}/>
                <NumberInput
                  min={0.001}
                  label="Units per checked add-on"
                  withAsterisk
                  value={mappingForm.quantityPerAddon}
                  onChange={(v) =>
                    setMappingForm({
                      ...mappingForm,
                      quantityPerAddon: Number(v),
                    })
                  }
                />
              </SimpleGrid>
              <Button
                type="submit"
                mt="md"
                loading={busy}
                disabled={!mappingValid}
              >
                Add mapping
              </Button>
            </Paper>
            <ScrollArea type="auto" offsetScrollbars tabIndex={0} aria-label="Add-on inventory mappings">
            <Table striped miw={600}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Add-on</Table.Th>
                  <Table.Th>Stock item</Table.Th>
                  <Table.Th>Size / variant</Table.Th>
                  <Table.Th>Units used</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {mappings.map((x) => (
                  <Table.Tr key={x.id}>
                    <Table.Td>{x.addonName}</Table.Td>
                    <Table.Td>
                      {items.find((i) => i.id === x.inventoryItemId)?.name}
                    </Table.Td>
                    <Table.Td>{x.variant ?? "All"}</Table.Td>
                    <Table.Td>{x.quantityPerAddon}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </ScrollArea>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <ScrollArea type="auto" offsetScrollbars tabIndex={0} aria-label="Inventory purchase history">
          <Table striped highlightOnHover miw={620}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Invoice</Table.Th>
                <Table.Th>Finance transaction</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {purchases.map((x) => (
                <Table.Tr key={x.id}>
                  <Table.Td>{x.date}</Table.Td>
                  <Table.Td>{x.invoiceNumber ?? "—"}</Table.Td>
                  <Table.Td>#{x.financeTransactionId}</Table.Td>
                  <Table.Td ta="right">
                    {formatFinanceMoneyMinor(x.totalMinor, x.currency)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          </ScrollArea>
        </Tabs.Panel>
        </Tabs>
      </FinancePanel>
      <FinanceModal
        opened={itemOpen}
        onClose={() => {
          if (!busy) {
            setItemOpen(false);
          }
        }}
        title="New stock item"
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await axiosInstance.post("/inventory/items", itemForm);
              setItemOpen(false);
            });
          }}
        >
          <Stack gap="md">
          <FinanceFormSection
            title="Stock item details"
            description="Use a unique SKU and set the point where the item should be reordered."
            icon={<IconPackage size={18} />}
          >
            <Stack gap="sm">
              <TextInput
                label="Name"
                placeholder="For example: Polaroid film"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.currentTarget.value })}
                withAsterisk
                required
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="SKU"
                  placeholder="FILM-001"
                  value={itemForm.sku}
                  onChange={(e) => setItemForm({ ...itemForm, sku: e.currentTarget.value })}
                  withAsterisk
                  required
                />
                <NumberInput
                  label="Low-stock threshold"
                  description="Show a warning at or below this quantity"
                  min={0}
                  value={itemForm.reorderLevel}
                  onChange={(v) => setItemForm({ ...itemForm, reorderLevel: Number(v) })}
                />
              </SimpleGrid>
            </Stack>
          </FinanceFormSection>
          {error ? <Alert color="red">{error}</Alert> : null}
          <FinanceModalFooter>
            <Button type="button" variant="default" onClick={() => setItemOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!itemForm.name.trim() || !itemForm.sku.trim()}
            >
              Create item
            </Button>
          </FinanceModalFooter>
          </Stack>
        </form>
      </FinanceModal>
    </Stack>
  );
};
export default FinanceInventory;
