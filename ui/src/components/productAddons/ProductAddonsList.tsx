import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconBox,
  IconDotsVertical,
  IconEdit,
  IconLink,
  IconPlus,
  IconPuzzle,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createProductAddon,
  deleteProductAddon,
  fetchProductAddons,
  updateProductAddon,
} from "../../actions/productAddonActions";
import { fetchProducts } from "../../actions/productActions";
import { fetchAddons } from "../../actions/addonActions";
import type {
  ProductAddon,
  StorefrontAddonConfig,
} from "../../types/productAddons/ProductAddon";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { AddonStorefrontRulesEditor } from "../storefront/StorefrontRulesEditors";

const MODULE_SLUG = "product-addon-management";

type ProductAddonsListProps = {
  pageTitle?: string;
};

type ProductAddonForm = {
  productId: string | null;
  addonId: string | null;
  maxPerAttendee: number | string;
  priceOverride: number | string;
  sortOrder: number | string;
  storefrontConfig: StorefrontAddonConfig;
};

const EMPTY_FORM: ProductAddonForm = {
  productId: null,
  addonId: null,
  maxPerAttendee: "",
  priceOverride: "",
  sortOrder: 0,
  storefrontConfig: { selectionMode: "boolean" },
};

const formatPrice = (price: number) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
};

const ProductAddonsList = (_props: ProductAddonsListProps) => {
  const dispatch = useAppDispatch();
  const productAddonsState = useAppSelector((state) => state.productAddons)[0];
  const productsState = useAppSelector((state) => state.products)[0];
  const addonsState = useAppSelector((state) => state.addons)[0];
  const permissions = useModuleAccess(MODULE_SLUG);

  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState<string | null>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Partial<ProductAddon> | null>(null);
  const [form, setForm] = useState<ProductAddonForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    dispatch(fetchProductAddons());
    dispatch(fetchProducts());
    dispatch(fetchAddons());
  }, [dispatch]);

  const records = useMemo(
    () => productAddonsState.data[0]?.data ?? [],
    [productAddonsState.data],
  );
  const products = useMemo(
    () => productsState.data[0]?.data ?? [],
    [productsState.data],
  );
  const addons = useMemo(
    () => addonsState.data[0]?.data ?? [],
    [addonsState.data],
  );

  const productLabelById = useMemo(
    () =>
      new Map(
        products
          .filter((product) => typeof product.id === "number")
          .map((product) => [product.id as number, product.name ?? `Product ${product.id}`]),
      ),
    [products],
  );
  const addonLabelById = useMemo(
    () =>
      new Map(
        addons
          .filter((addon) => typeof addon.id === "number")
          .map((addon) => [addon.id as number, addon.name ?? `Add-on ${addon.id}`]),
      ),
    [addons],
  );
  const addonPriceById = useMemo(
    () =>
      new Map(
        addons
          .filter((addon) => typeof addon.id === "number")
          .map((addon) => [addon.id as number, addon.basePrice]),
      ),
    [addons],
  );
  const productOptions = useMemo(
    () =>
      Array.from(productLabelById.entries()).map(([id, label]) => ({
        value: String(id),
        label,
      })),
    [productLabelById],
  );
  const addonOptions = useMemo(
    () =>
      Array.from(addonLabelById.entries()).map(([id, label]) => ({
        value: String(id),
        label,
      })),
    [addonLabelById],
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records
      .filter((record) => {
        const productName =
          record.productName ?? productLabelById.get(Number(record.productId)) ?? "";
        const addonName =
          record.addonName ?? addonLabelById.get(Number(record.addonId)) ?? "";
        const matchesQuery =
          !normalizedQuery ||
          productName.toLowerCase().includes(normalizedQuery) ||
          addonName.toLowerCase().includes(normalizedQuery) ||
          String(record.id ?? "").includes(normalizedQuery);
        const matchesProduct =
          productFilter === "all" || String(record.productId) === productFilter;
        return matchesQuery && matchesProduct;
      })
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  }, [records, query, productFilter, productLabelById, addonLabelById]);

  const linkedProductCount = new Set(records.map((record) => record.productId)).size;
  const customPriceCount = records.filter(
    (record) => record.priceOverride !== null && record.priceOverride !== undefined,
  ).length;

  const closeForm = () => {
    if (submitting) return;
    setFormOpen(false);
    setEditingRecord(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const openCreateForm = () => {
    setEditingRecord(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditForm = (record: Partial<ProductAddon>) => {
    setEditingRecord(record);
    setForm({
      productId: record.productId === undefined ? null : String(record.productId),
      addonId: record.addonId === undefined ? null : String(record.addonId),
      maxPerAttendee: record.maxPerAttendee ?? "",
      priceOverride: record.priceOverride ?? "",
      sortOrder: record.sortOrder ?? 0,
      storefrontConfig: record.storefrontConfig ?? { selectionMode: "boolean" },
    });
    setFormError(null);
    setFormOpen(true);
  };

  const validateStorefrontRules = () => {
    const { selectionMode, allowedQuantities = [], options = [] } = form.storefrontConfig;
    if (selectionMode === "quantity" && allowedQuantities.length === 0) {
      return "Add at least one allowed quantity.";
    }
    if (
      selectionMode === "range" &&
      (!Number.isInteger(form.storefrontConfig.minQuantity) ||
        !Number.isInteger(form.storefrontConfig.maxQuantity) ||
        Number(form.storefrontConfig.minQuantity) < 1 ||
        Number(form.storefrontConfig.maxQuantity) <
          Number(form.storefrontConfig.minQuantity))
    ) {
      return "Set a valid minimum and maximum quantity.";
    }
    if (
      selectionMode === "options" &&
      (options.length === 0 ||
        options.some((option) => !option.label.trim() || !option.value.trim()))
    ) {
      return "Add at least one option and complete its label and internal value.";
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!form.productId || !form.addonId) {
      setFormError("Choose both a product and an add-on.");
      return;
    }
    const storefrontError = validateStorefrontRules();
    if (storefrontError) {
      setFormError(storefrontError);
      return;
    }
    const maxPerAttendee =
      form.maxPerAttendee === "" ? null : Number(form.maxPerAttendee);
    const priceOverride = form.priceOverride === "" ? null : Number(form.priceOverride);
    const sortOrder = Number(form.sortOrder);
    if (
      (maxPerAttendee !== null && (!Number.isInteger(maxPerAttendee) || maxPerAttendee < 1)) ||
      (priceOverride !== null && (!Number.isFinite(priceOverride) || priceOverride < 0)) ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0
    ) {
      setFormError("Check the quantity, price, and display order values.");
      return;
    }

    const payload: Partial<ProductAddon> = {
      productId: Number(form.productId),
      addonId: Number(form.addonId),
      maxPerAttendee,
      priceOverride,
      sortOrder,
      storefrontConfig: form.storefrontConfig,
    };

    setSubmitting(true);
    setFormError(null);
    setOperationError(null);
    try {
      if (typeof editingRecord?.id === "number") {
        await dispatch(
          updateProductAddon({ productAddonId: editingRecord.id, payload }),
        ).unwrap();
      } else {
        await dispatch(createProductAddon(payload)).unwrap();
      }
      await dispatch(fetchProductAddons()).unwrap();
      setSubmitting(false);
      closeForm();
    } catch (submitError) {
      setFormError(getErrorMessage(submitError, "Unable to save this product add-on."));
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: Partial<ProductAddon>) => {
    const addonName =
      record.addonName ?? addonLabelById.get(Number(record.addonId)) ?? "this add-on";
    if (
      typeof record.id !== "number" ||
      !window.confirm(`Remove “${addonName}” from this product?`)
    ) {
      return;
    }
    setDeletingId(record.id);
    setOperationError(null);
    try {
      await dispatch(deleteProductAddon(record.id)).unwrap();
      await dispatch(fetchProductAddons()).unwrap();
    } catch (deleteError) {
      setOperationError(getErrorMessage(deleteError, "Unable to remove this product add-on."));
    } finally {
      setDeletingId(null);
    }
  };

  if (!permissions.ready || (productAddonsState.loading && records.length === 0)) {
    return (
      <Center mih={280}>
        <Loader variant="dots" />
      </Center>
    );
  }

  if (!permissions.canView) {
    return (
      <Alert color="yellow" title="No access">
        You do not have permission to view product add-ons.
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" size="lg" radius="md"><IconLink size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Add-on links</Text>
              <Text size="xl" fw={700}>{records.length}</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color="teal" variant="light" size="lg" radius="md"><IconBox size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Products covered</Text>
              <Text size="xl" fw={700}>{linkedProductCount}</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color="orange" variant="light" size="lg" radius="md"><IconPuzzle size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Custom prices</Text>
              <Text size="xl" fw={700}>{customPriceCount}</Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" align="flex-end">
          <Group gap="sm" align="flex-end" style={{ flex: 1 }}>
            <TextInput
              aria-label="Search product add-ons"
              placeholder="Search products or add-ons..."
              leftSection={<IconSearch size={16} />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              style={{ flex: "1 1 260px", maxWidth: 440 }}
            />
            <Select
              aria-label="Filter by product"
              data={[{ value: "all", label: "All products" }, ...productOptions]}
              value={productFilter}
              onChange={setProductFilter}
              allowDeselect={false}
              searchable
              w={220}
            />
          </Group>
          <Group gap="xs">
            <Tooltip label="Refresh product add-ons">
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Refresh product add-ons"
                loading={productAddonsState.loading}
                onClick={() => dispatch(fetchProductAddons())}
              >
                <IconRefresh size={17} />
              </ActionIcon>
            </Tooltip>
            {permissions.canCreate && (
              <Button leftSection={<IconPlus size={17} />} onClick={openCreateForm}>
                Link add-on
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {(productAddonsState.error || operationError) && (
        <Alert color="red" title="Product add-ons error">
          {operationError ?? productAddonsState.error}
        </Alert>
      )}

      {filteredRecords.length === 0 ? (
        <Paper withBorder radius="md" p={40}>
          <Stack align="center" gap="xs">
            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
              <IconPuzzle size={24} />
            </ThemeIcon>
            <Text fw={600}>
              {records.length === 0 ? "No product add-ons yet" : "No matches found"}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {records.length === 0
                ? "Link an add-on to a product and configure how guests select it."
                : "Try changing your search or product filter."}
            </Text>
            {records.length === 0 && permissions.canCreate && (
              <Button mt="sm" leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
                Link first add-on
              </Button>
            )}
          </Stack>
        </Paper>
      ) : (
        <>
          <Text size="sm" c="dimmed">
            Showing {filteredRecords.length} of {records.length} product add-ons
          </Text>
          <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
            {filteredRecords.map((record) => {
              const productName =
                record.productName ??
                productLabelById.get(Number(record.productId)) ??
                `Product #${record.productId}`;
              const addonName =
                record.addonName ??
                addonLabelById.get(Number(record.addonId)) ??
                `Add-on #${record.addonId}`;
              const basePrice = addonPriceById.get(Number(record.addonId));
              const selectionMode = record.storefrontConfig?.selectionMode ?? "boolean";
              return (
                <Card key={record.id} withBorder radius="md" padding="lg">
                  <Stack gap="md" h="100%">
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap="sm" align="flex-start" wrap="nowrap">
                        <ThemeIcon size={42} radius="md" variant="light">
                          <IconPuzzle size={21} />
                        </ThemeIcon>
                        <div>
                          <Text fw={700} lh={1.25}>{addonName}</Text>
                          <Text size="sm" c="dimmed" mt={3}>for {productName}</Text>
                        </div>
                      </Group>
                      {(permissions.canUpdate || permissions.canDelete) && (
                        <Menu position="bottom-end" withinPortal shadow="md">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label="Product add-on actions">
                              <IconDotsVertical size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {permissions.canUpdate && (
                              <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => openEditForm(record)}>
                                Edit link
                              </Menu.Item>
                            )}
                            {permissions.canDelete && (
                              <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={16} />}
                                disabled={deletingId === record.id}
                                onClick={() => handleDelete(record)}
                              >
                                Remove link
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Group>
                    <Group gap="xs">
                      <Badge variant="light">
                        {selectionMode === "boolean"
                          ? "Yes / no"
                          : selectionMode === "quantity"
                            ? "Specific quantities"
                            : selectionMode === "range"
                              ? "Quantity range"
                              : "Options"}
                      </Badge>
                      {record.maxPerAttendee && (
                        <Badge color="gray" variant="light">Max {record.maxPerAttendee} per guest</Badge>
                      )}
                      <Badge color="gray" variant="outline">Order {record.sortOrder ?? 0}</Badge>
                    </Group>
                    <Paper bg="var(--mantine-color-gray-0)" radius="sm" p="sm" mt="auto">
                      <Group justify="space-between">
                        <div>
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            {record.priceOverride !== null && record.priceOverride !== undefined
                              ? "Custom price"
                              : "Add-on base price"}
                          </Text>
                          <Text fw={700}>
                            {record.priceOverride !== null && record.priceOverride !== undefined
                              ? formatPrice(Number(record.priceOverride))
                              : basePrice === null || basePrice === undefined
                                ? "Not set"
                                : formatPrice(Number(basePrice))}
                          </Text>
                        </div>
                        <Text size="xs" c="dimmed">ID #{record.id}</Text>
                      </Group>
                    </Paper>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        </>
      )}

      <Modal
        opened={formOpen}
        onClose={closeForm}
        title={editingRecord ? "Edit product add-on" : "Link an add-on"}
        size="xl"
        centered
        radius="md"
      >
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Product"
              placeholder="Choose a product"
              required
              searchable
              data={productOptions}
              value={form.productId}
              onChange={(value) => setForm((current) => ({ ...current, productId: value }))}
            />
            <Select
              label="Add-on"
              placeholder="Choose an add-on"
              required
              searchable
              data={addonOptions}
              value={form.addonId}
              onChange={(value) => setForm((current) => ({ ...current, addonId: value }))}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NumberInput
              label="Maximum per guest"
              description="Leave blank for no limit."
              min={1}
              allowDecimal={false}
              value={form.maxPerAttendee}
              onChange={(value) => setForm((current) => ({ ...current, maxPerAttendee: value }))}
            />
            <NumberInput
              label="Price override"
              description="Leave blank to use the add-on price."
              min={0}
              decimalScale={2}
              value={form.priceOverride}
              onChange={(value) => setForm((current) => ({ ...current, priceOverride: value }))}
            />
            <NumberInput
              label="Display order"
              description="Lower numbers appear first."
              min={0}
              allowDecimal={false}
              value={form.sortOrder}
              onChange={(value) => setForm((current) => ({ ...current, sortOrder: value }))}
            />
          </SimpleGrid>
          <AddonStorefrontRulesEditor
            value={form.storefrontConfig}
            onChange={(storefrontConfig) =>
              setForm((current) => ({ ...current, storefrontConfig }))
            }
          />
          {formError && <Alert color="red" title="Unable to save">{formError}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeForm} disabled={submitting}>Cancel</Button>
            <Button loading={submitting} onClick={handleSubmit}>
              {editingRecord ? "Save changes" : "Link add-on"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ProductAddonsList;
