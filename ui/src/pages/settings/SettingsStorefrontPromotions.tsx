import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCloudDownload,
  IconCloudUpload,
  IconDiscount2,
  IconDotsVertical,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import axiosInstance from "../../utils/axiosInstance";

const MODULE_SLUG = "storefront-promotion-management";

type Promotion = {
  id: number;
  code: string;
  name: string;
  type: "percentage" | "fixed";
  value: number;
  currency: string | null;
  minSubtotal: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  productIds: number[];
  ecwidCouponId: number | null;
  ecwidStatus: string | null;
  ecwidLastSyncedAt: string | null;
};

type FormState = {
  code: string;
  name: string;
  type: "percentage" | "fixed";
  value: number | string;
  currency: string;
  minSubtotal: number | string;
  maxRedemptions: number | string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  productIds: string[];
  syncToEcwid: boolean;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  type: "percentage",
  value: 10,
  currency: "PLN",
  minSubtotal: 0,
  maxRedemptions: "",
  validFrom: "",
  validTo: "",
  isActive: true,
  productIds: [],
  syncToEcwid: true,
};

const toLocalDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const messageFrom = (error: unknown, fallback: string) => {
  const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return responseMessage || (error instanceof Error ? error.message : fallback);
};

const PromotionsContent = () => {
  const permissions = useModuleAccess(MODULE_SLUG);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [productOptions, setProductOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [promotionResponse, productResponse] = await Promise.all([
        axiosInstance.get<{ data: Promotion[] }>("/storefront-promotions"),
        axiosInstance.get<Array<{ data: Array<{ id?: number; name?: string }> }>>("/products"),
      ]);
      setPromotions(promotionResponse.data.data);
      setProductOptions(
        (productResponse.data[0]?.data ?? [])
          .filter((product) => typeof product.id === "number")
          .map((product) => ({ value: String(product.id), label: product.name ?? `Product ${product.id}` })),
      );
    } catch (loadError) {
      setError(messageFrom(loadError, "Unable to load promotions."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (permissions.ready && permissions.canView) void load(); }, [load, permissions.ready, permissions.canView]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return promotions.filter((promotion) =>
      !normalized ||
      promotion.code.toLowerCase().includes(normalized) ||
      promotion.name.toLowerCase().includes(normalized),
    );
  }, [promotions, query]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (promotion: Promotion) => {
    setEditing(promotion);
    setForm({
      code: promotion.code,
      name: promotion.name,
      type: promotion.type,
      value: promotion.value,
      currency: promotion.currency ?? "PLN",
      minSubtotal: promotion.minSubtotal,
      maxRedemptions: promotion.maxRedemptions ?? "",
      validFrom: toLocalDateTime(promotion.validFrom),
      validTo: toLocalDateTime(promotion.validTo),
      isActive: promotion.isActive,
      productIds: promotion.productIds.map(String),
      syncToEcwid: Boolean(promotion.ecwidCouponId),
    });
    setError(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim() || Number(form.value) <= 0) {
      setError("Code, name, and a positive discount value are required.");
      return;
    }
    if (form.type === "percentage" && Number(form.value) > 100) {
      setError("Percentage discounts cannot exceed 100%.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
      ...form,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      value: Number(form.value),
      minSubtotal: Number(form.minSubtotal || 0),
      maxRedemptions: form.maxRedemptions === "" ? null : Number(form.maxRedemptions),
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      productIds: form.productIds.map(Number),
    };
    try {
      if (editing) await axiosInstance.put(`/storefront-promotions/${editing.id}`, payload);
      else await axiosInstance.post("/storefront-promotions", payload);
      setFormOpen(false);
      setNotice(form.syncToEcwid ? "Promotion saved and synchronized with Ecwid." : "Promotion saved in OmniLodge.");
      await load();
    } catch (saveError) {
      setError(messageFrom(saveError, "Unable to save promotion."));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (promotion: Promotion) => {
    if (!window.confirm(`Delete discount code “${promotion.code}” from OmniLodge?`)) return;
    try {
      await axiosInstance.delete(`/storefront-promotions/${promotion.id}`);
      await load();
    } catch (removeError) {
      setError(messageFrom(removeError, "Unable to delete promotion."));
    }
  };

  const importEcwid = async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await axiosInstance.post<{ created: number; updated: number; skipped: number }>(
        "/storefront-promotions/sync/ecwid-import",
      );
      setNotice(`Ecwid sync complete: ${response.data.created} imported, ${response.data.updated} updated, ${response.data.skipped} unsupported skipped.`);
      await load();
    } catch (syncError) {
      setError(messageFrom(syncError, "Unable to synchronize Ecwid coupons."));
    } finally {
      setSyncing(false);
    }
  };

  const pushEcwid = async (promotion: Promotion) => {
    setSyncingId(promotion.id);
    setError(null);
    try {
      await axiosInstance.post(`/storefront-promotions/${promotion.id}/sync-ecwid`);
      setNotice(`${promotion.code} synchronized to Ecwid.`);
      await load();
    } catch (syncError) {
      setError(messageFrom(syncError, "Unable to synchronize this coupon."));
    } finally {
      setSyncingId(null);
    }
  };

  if (!permissions.ready || loading) return <Center mih={300}><Loader variant="dots" /></Center>;
  if (!permissions.canView) return <Alert color="yellow">You do not have access to storefront promotions.</Alert>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <TextInput
          placeholder="Search code or promotion..."
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          w={{ base: "100%", sm: 360 }}
        />
        <Group gap="xs">
          <Tooltip label="Refresh"><ActionIcon variant="default" size="lg" onClick={load}><IconRefresh size={17} /></ActionIcon></Tooltip>
          {permissions.canCreate && (
            <Button variant="light" leftSection={<IconCloudDownload size={17} />} loading={syncing} onClick={importEcwid}>
              Sync from Ecwid
            </Button>
          )}
          {permissions.canCreate && <Button leftSection={<IconPlus size={17} />} onClick={openCreate}>New code</Button>}
        </Group>
      </Group>
      {notice && <Alert color="teal" withCloseButton onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && !formOpen && <Alert color="red" title="Promotion error">{error}</Alert>}
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {filtered.map((promotion) => (
          <Card key={promotion.id} withBorder radius="md" p="lg">
            <Stack gap="md" h="100%">
              <Group justify="space-between" align="flex-start">
                <Group gap="sm">
                  <ThemeIcon size={42} radius="md" variant="light"><IconDiscount2 size={21} /></ThemeIcon>
                  <div><Text fw={700}>{promotion.code}</Text><Text size="sm" c="dimmed">{promotion.name}</Text></div>
                </Group>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target><ActionIcon variant="subtle"><IconDotsVertical size={18} /></ActionIcon></Menu.Target>
                  <Menu.Dropdown>
                    {permissions.canUpdate && <Menu.Item leftSection={<IconEdit size={15} />} onClick={() => openEdit(promotion)}>Edit</Menu.Item>}
                    {permissions.canUpdate && <Menu.Item leftSection={<IconCloudUpload size={15} />} onClick={() => pushEcwid(promotion)}>Sync to Ecwid</Menu.Item>}
                    {permissions.canDelete && <Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={() => remove(promotion)}>Delete from OmniLodge</Menu.Item>}
                  </Menu.Dropdown>
                </Menu>
              </Group>
              <Group gap="xs">
                <Badge color={promotion.isActive ? "teal" : "gray"}>{promotion.isActive ? "Active" : "Inactive"}</Badge>
                <Badge variant="light">{promotion.type === "percentage" ? `${promotion.value}% off` : `${promotion.value.toFixed(2)} ${promotion.currency ?? "PLN"} off`}</Badge>
                <Badge color={promotion.ecwidCouponId ? "blue" : "gray"} variant="light">{promotion.ecwidCouponId ? "Ecwid synced" : "OmniLodge only"}</Badge>
              </Group>
              <SimpleGrid cols={2} mt="auto">
                <div><Text size="xs" c="dimmed">Minimum subtotal</Text><Text size="sm" fw={600}>{promotion.minSubtotal.toFixed(2)}</Text></div>
                <div><Text size="xs" c="dimmed">Redemptions</Text><Text size="sm" fw={600}>{promotion.redemptionCount}{promotion.maxRedemptions ? ` / ${promotion.maxRedemptions}` : ""}</Text></div>
              </SimpleGrid>
              {syncingId === promotion.id && <Text size="xs" c="blue">Synchronizing with Ecwid…</Text>}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      {filtered.length === 0 && <Paper withBorder p={40}><Text ta="center" c="dimmed">No discount codes found.</Text></Paper>}

      <Modal opened={formOpen} onClose={() => !submitting && setFormOpen(false)} title={editing ? "Edit discount code" : "New discount code"} size="lg" centered>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value.toUpperCase() })} />
            <TextInput label="Promotion name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
            <Select label="Discount type" data={[{ value: "percentage", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }]} value={form.type} allowDeselect={false} onChange={(value) => setForm({ ...form, type: value as FormState["type"] })} />
            <NumberInput label={form.type === "percentage" ? "Discount percentage" : "Discount amount"} min={0} max={form.type === "percentage" ? 100 : undefined} value={form.value} onChange={(value) => setForm({ ...form, value })} />
            <NumberInput label="Minimum subtotal" min={0} value={form.minSubtotal} onChange={(value) => setForm({ ...form, minSubtotal: value })} />
            <NumberInput label="Maximum redemptions" description="Leave blank for unlimited." min={1} allowDecimal={false} value={form.maxRedemptions} onChange={(value) => setForm({ ...form, maxRedemptions: value })} />
            <TextInput type="datetime-local" label="Valid from" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.currentTarget.value })} />
            <TextInput type="datetime-local" label="Valid until" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.currentTarget.value })} />
          </SimpleGrid>
          <MultiSelect label="Eligible products" description="Leave empty to apply to every product. OmniLodge scope only." searchable clearable data={productOptions} value={form.productIds} onChange={(productIds) => setForm({ ...form, productIds })} />
          <Switch label="Promotion is active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} />
          <Checkbox label="Also synchronize this code to Ecwid" checked={form.syncToEcwid} onChange={(e) => setForm({ ...form, syncToEcwid: e.currentTarget.checked })} />
          {form.maxRedemptions !== "" && Number(form.maxRedemptions) > 1 && form.syncToEcwid && <Alert color="yellow">Ecwid cannot enforce arbitrary total redemption limits. OmniLodge will enforce this limit; Ecwid will receive an unlimited coupon.</Alert>}
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end"><Button variant="default" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</Button><Button loading={submitting} onClick={save}>Save promotion</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

const SettingsStorefrontPromotions = () => (
  <PageAccessGuard pageSlug={PAGE_SLUGS.settingsStorefrontPromotions}>
    <Stack gap="md">
      <div>
        <Title order={3}>Storefront Promotions</Title>
        <Text size="sm" c="dimmed">Manage OmniLodge discount codes and synchronize Ecwid coupons.</Text>
      </div>
      <PromotionsContent />
    </Stack>
  </PageAccessGuard>
);

export default SettingsStorefrontPromotions;
