import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActionIcon,
  Badge,
  Button,
  FileInput,
  Group,
  Modal,
  NumberInput,
  Paper,
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
import {
  IconAlertCircle,
  IconPackage,
  IconPlus,
  IconReceipt,
  IconTrash,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";

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

const FinanceInventory = () => {
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
  const purchaseTotal = purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const purchaseLinesValid = purchaseLines.length > 0 && purchaseLines.every(line => line.inventoryItemId && line.quantity > 0 && line.unitCost > 0);
  const option = (rows: Option[]) =>
    rows.map((x) => ({ value: String(x.id), label: x.name }));
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={3}>Inventory & purchases</Title>
          <Text size="sm" c="dimmed">
            Stock-controlled add-ons with automatic counter usage and Finance
            expenses.
          </Text>
        </div>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setItemOpen(true)}
        >
          New stock item
        </Button>
      </Group>
      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          withCloseButton
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {items.map((x) => (
          <Paper key={x.id} withBorder p="md">
            <Group justify="space-between">
              <Text fw={600}>{x.name}</Text>
              {x.lowStock && <Badge color="red">Low</Badge>}
            </Group>
            <Text fz={28} fw={700}>
              {x.availableStock}{" "}
              <Text component="span" size="sm" c="dimmed">
                available
              </Text>
            </Text>
            <Text size="sm">
              {x.currentStock} on hand · {x.reservedStock} reserved
            </Text>
            <Text size="xs" c="dimmed">
              SKU {x.sku} · reorder at {x.reorderLevel}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Tabs defaultValue="fulfillments">
        <Tabs.List>
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
        <Tabs.Panel value="incidents" pt="md">
          <Stack>
            <Paper withBorder p="md">
              <Stack>
                <Title order={4}>Record an extra photo or damaged item</Title>
                <Text size="sm" c="dimmed">
                  Use Retake when a photo failed and another one was produced.
                  This deducts the extra film immediately.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Select
                    label="Add-on"
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
                  loading={busy}
                  onClick={() =>
                    run(() =>
                      axiosInstance.post("/inventory/usage-incidents", {
                        ...incident,
                        addonId: Number(incident.addonId),
                        inventoryItemId: Number(incident.inventoryItemId),
                        bookingId: incident.bookingId
                          ? Number(incident.bookingId)
                          : null,
                        counterId: incident.counterId
                          ? Number(incident.counterId)
                          : null,
                      }),
                    )
                  }
                >
                  Record extra usage
                </Button>
              </Stack>
            </Paper>
            <Table striped>
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
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="fulfillments" pt="md">
          <Stack>
            <Paper withBorder p="md">
              <Stack>
                <Title order={4}>Add promised item</Title>
                <Text size="sm" c="dimmed">
                  Create this before finalizing the counter so it is not counted
                  as handed out. Existing promises can be entered at any time.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Select
                    label="Add-on"
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
                    data={itemOptions}
                    value={promise.inventoryItemId}
                    onChange={(v) =>
                      setPromise({ ...promise, inventoryItemId: v ?? "" })
                    }
                  />
                  <NumberInput
                    label="Quantity"
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
                    value={promise.recipientName}
                    onChange={(e) =>
                      setPromise({
                        ...promise,
                        recipientName: e.currentTarget.value,
                      })
                    }
                  />
                  <TextInput
                    label="Email"
                    value={promise.email}
                    onChange={(e) =>
                      setPromise({ ...promise, email: e.currentTarget.value })
                    }
                  />
                  <TextInput
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
                  loading={busy}
                  onClick={() =>
                    run(() =>
                      axiosInstance.post("/inventory/fulfillments", {
                        ...promise,
                        inventoryItemId: Number(promise.inventoryItemId),
                        addonId: Number(promise.addonId),
                        bookingId: promise.bookingId
                          ? Number(promise.bookingId)
                          : null,
                        counterId: promise.counterId
                          ? Number(promise.counterId)
                          : null,
                      }),
                    )
                  }
                >
                  Create promise
                </Button>
              </Stack>
            </Paper>
            <Table striped highlightOnHover>
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
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="purchases" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Title order={4}>Record purchase and Finance expense</Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <TextInput
                  type="date"
                  label="Purchase date"
                  value={purchase.date}
                  onChange={(e) =>
                    setPurchase({ ...purchase, date: e.currentTarget.value })
                  }
                />
                <Select
                  searchable
                  label="Vendor"
                  data={option(vendors)}
                  value={purchase.vendorId}
                  onChange={(v) =>
                    setPurchase({ ...purchase, vendorId: v ?? "" })
                  }
                />
                <Select
                  label="Payment account"
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
                  <Group justify="space-between"><div><Text fw={700}>Purchase items</Text><Text size="sm" c="dimmed">Add every stock item included on this invoice.</Text></div><Button size="xs" variant="light" leftSection={<IconPlus size={14}/>} onClick={() => setPurchaseLines(lines => [...lines, { id: nextPurchaseLineId++, inventoryItemId: "", quantity: 1, unitCost: 0 }])}>Add item</Button></Group>
                  {purchaseLines.map((line, index) => <SimpleGrid key={line.id} cols={{base:1,sm:4}} style={{alignItems:"end"}}><Select searchable label={`Stock item ${index + 1}`} data={itemOptions} value={line.inventoryItemId} onChange={value => setPurchaseLines(lines => lines.map(current => current.id === line.id ? {...current, inventoryItemId:value ?? ""} : current))}/><NumberInput min={0.001} decimalScale={3} label="Quantity" value={line.quantity} onChange={value => setPurchaseLines(lines => lines.map(current => current.id === line.id ? {...current,quantity:Number(value)} : current))}/><NumberInput min={0.01} decimalScale={2} label={`Unit cost (${purchase.currency})`} value={line.unitCost} onChange={value => setPurchaseLines(lines => lines.map(current => current.id === line.id ? {...current,unitCost:Number(value)} : current))}/><Group gap="xs"><Text fw={600} style={{flex:1}}>{(line.quantity * line.unitCost).toFixed(2)} {purchase.currency}</Text><ActionIcon color="red" variant="subtle" aria-label={`Remove item ${index + 1}`} disabled={purchaseLines.length === 1} onClick={() => setPurchaseLines(lines => lines.filter(current => current.id !== line.id))}><IconTrash size={17}/></ActionIcon></Group></SimpleGrid>)}
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
                  Total: {purchaseTotal.toFixed(2)}{" "}
                  {purchase.currency}
                </Text>
                <Button
                  loading={busy}
                  disabled={!purchaseLinesValid}
                  onClick={() =>
                    run(async () => {
                      let invoiceFileId: null | number = null;
                      if (invoice) {
                        const fd = new FormData();
                        fd.append("file", invoice);
                        const uploaded = await axiosInstance.post(
                          "/finance/files",
                          fd,
                          {
                            headers: { "Content-Type": "multipart/form-data" },
                          },
                        );
                        invoiceFileId = uploaded.data.id;
                      }
                      await axiosInstance.post("/inventory/purchases", {
                        ...purchase,
                        vendorId: Number(purchase.vendorId),
                        accountId: Number(purchase.accountId),
                        categoryId: Number(purchase.categoryId),
                        invoiceFileId,
                        totalMinor: Math.round(purchaseTotal * 100),
                        items: purchaseLines.map(line => ({ inventoryItemId: Number(line.inventoryItemId), quantity: line.quantity, unitCostMinor: Math.round(line.unitCost * 100) })),
                      });
                      setInvoice(null);
                      setPurchaseLines([{ id: nextPurchaseLineId++, inventoryItemId: "", quantity: 1, unitCost: 0 }]);
                    })
                  }
                >
                  Save purchase
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="adjustments" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Title order={4}>Initial stock or adjustment</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Stock item"
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
                loading={busy}
                onClick={() =>
                  run(() =>
                    axiosInstance.post("/inventory/adjustments", {
                      ...adjust,
                      inventoryItemId: Number(adjust.inventoryItemId),
                      unitCostMinor: Math.round(adjust.unitCost * 100),
                    }),
                  )
                }
              >
                Post adjustment
              </Button>
            </Stack>
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="mappings" pt="md">
          <Stack>
            <Paper withBorder p="md">
              <SimpleGrid cols={{ base: 1, sm: 4 }}>
                <Select
                  label="Add-on"
                  data={option(addons)}
                  value={mappingForm.addonId}
                  onChange={(v) =>
                    setMappingForm({ ...mappingForm, addonId: v ?? "" })
                  }
                />
                <Select
                  label="Stock item"
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
                mt="md"
                loading={busy}
                onClick={() =>
                  run(() =>
                    axiosInstance.post("/inventory/mappings", {
                      ...mappingForm,
                      addonId: Number(mappingForm.addonId),
                      inventoryItemId: Number(mappingForm.inventoryItemId),
                    }),
                  )
                }
              >
                Add mapping
              </Button>
            </Paper>
            <Table striped>
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
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <Table striped highlightOnHover>
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
                    {(x.totalMinor / 100).toFixed(2)} {x.currency}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={itemOpen}
        onClose={() => setItemOpen(false)}
        title="New stock item"
      >
        <Stack>
          <TextInput
            label="Name"
            value={itemForm.name}
            onChange={(e) =>
              setItemForm({ ...itemForm, name: e.currentTarget.value })
            }
          />
          <TextInput
            label="SKU"
            value={itemForm.sku}
            onChange={(e) =>
              setItemForm({ ...itemForm, sku: e.currentTarget.value })
            }
          />
          <NumberInput
            label="Low-stock threshold"
            value={itemForm.reorderLevel}
            onChange={(v) =>
              setItemForm({ ...itemForm, reorderLevel: Number(v) })
            }
          />
          <Button
            loading={busy}
            onClick={() =>
              run(async () => {
                await axiosInstance.post("/inventory/items", itemForm);
                setItemOpen(false);
              })
            }
          >
            Create item
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
};
export default FinanceInventory;
