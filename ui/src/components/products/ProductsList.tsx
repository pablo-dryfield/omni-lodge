import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconBox,
  IconCheck,
  IconDotsVertical,
  IconEdit,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createProduct,
  deleteProduct,
  fetchProducts,
  updateProduct,
} from "../../actions/productActions";
import { fetchProductTypes } from "../../actions/productTypeActions";
import { Product } from "../../types/products/Product";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { ProductStorefrontRulesEditor } from "../storefront/StorefrontRulesEditors";

const DEFAULT_MODULE_SLUG = "product-catalog";

type ProductsListProps = {
  moduleSlug?: string;
  pageTitle?: string;
};

type ProductForm = {
  name: string;
  productTypeId: string | null;
  price: number | string;
  status: boolean;
  requiresNightReportCostReconciliation: boolean;
  storefrontConfig: Product["storefrontConfig"];
};

const EMPTY_FORM: ProductForm = {
  name: "",
  productTypeId: null,
  price: 0,
  status: true,
  requiresNightReportCostReconciliation: false,
  storefrontConfig: {},
};

const formatPrice = (price?: number) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(price ?? 0));

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
};

const ProductList = ({
  moduleSlug = DEFAULT_MODULE_SLUG,
}: ProductsListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.products)[0];
  const productTypesState = useAppSelector((state) => state.productTypes)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);
  const permissions = useModuleAccess(moduleSlug);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>("all");
  const [typeFilter, setTypeFilter] = useState<string | null>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    dispatch(fetchProducts());
    dispatch(fetchProductTypes());
  }, [dispatch]);

  const products = useMemo(() => data[0]?.data ?? [], [data]);
  const productTypes = useMemo(
    () => productTypesState.data[0]?.data ?? [],
    [productTypesState.data],
  );
  const typeNameById = useMemo(
    () =>
      new Map(
        productTypes
          .filter((type) => typeof type.id === "number")
          .map((type) => [type.id as number, type.name ?? `Type ${type.id}`]),
      ),
    [productTypes],
  );
  const typeOptions = useMemo(
    () =>
      productTypes
        .filter((type) => typeof type.id === "number")
        .map((type) => ({ value: String(type.id), label: type.name ?? `Type ${type.id}` })),
    [productTypes],
  );

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const typeName = typeNameById.get(Number(product.productTypeId)) ?? "";
      const matchesQuery =
        !normalizedQuery ||
        product.name?.toLowerCase().includes(normalizedQuery) ||
        typeName.toLowerCase().includes(normalizedQuery) ||
        String(product.id ?? "").includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? product.status !== false : product.status === false);
      const matchesType =
        typeFilter === "all" || String(product.productTypeId) === typeFilter;
      return matchesQuery && matchesStatus && matchesType;
    });
  }, [products, query, statusFilter, typeFilter, typeNameById]);

  const activeCount = products.filter((product) => product.status !== false).length;
  const reconciliationCount = products.filter(
    (product) => product.requiresNightReportCostReconciliation,
  ).length;

  const closeForm = () => {
    if (submitting) return;
    setFormOpen(false);
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const openCreateForm = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditForm = (product: Partial<Product>) => {
    setEditingProduct(product);
    setForm({
      name: product.name ?? "",
      productTypeId:
        product.productTypeId === undefined ? null : String(product.productTypeId),
      price: Number(product.price ?? 0),
      status: product.status !== false,
      requiresNightReportCostReconciliation:
        product.requiresNightReportCostReconciliation === true,
      storefrontConfig: product.storefrontConfig ?? {},
    });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError("Product name is required.");
      return;
    }
    if (!form.productTypeId) {
      setFormError("Choose a product type.");
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      setFormError("Price must be zero or greater.");
      return;
    }

    const payload: Partial<Product> = {
      name: form.name.trim(),
      productTypeId: Number(form.productTypeId),
      price,
      status: form.status,
      requiresNightReportCostReconciliation:
        form.requiresNightReportCostReconciliation,
      storefrontConfig: form.storefrontConfig,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      if (editingProduct?.id !== undefined) {
        await dispatch(
          updateProduct({
            productId: editingProduct.id,
            productData: { ...payload, updatedBy: loggedUserId },
          }),
        ).unwrap();
      } else {
        await dispatch(createProduct({ ...payload, createdBy: loggedUserId })).unwrap();
      }
      await dispatch(fetchProducts()).unwrap();
      setSubmitting(false);
      closeForm();
    } catch (submitError) {
      setFormError(getErrorMessage(submitError, "Unable to save this product."));
      setSubmitting(false);
    }
  };

  const handleDelete = async (product: Partial<Product>) => {
    if (
      typeof product.id !== "number" ||
      !window.confirm(`Delete “${product.name ?? "this product"}”? This cannot be undone.`)
    ) {
      return;
    }
    setDeletingId(product.id);
    try {
      await dispatch(deleteProduct(product.id)).unwrap();
      await dispatch(fetchProducts()).unwrap();
    } catch (deleteError) {
      setFormError(getErrorMessage(deleteError, "Unable to delete this product."));
    } finally {
      setDeletingId(null);
    }
  };

  if (!permissions.ready || (loading && products.length === 0)) {
    return (
      <Center mih={280}>
        <Loader variant="dots" />
      </Center>
    );
  }

  if (!permissions.canView) {
    return (
      <Alert color="yellow" title="No access">
        You do not have permission to view the product catalog.
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" size="lg" radius="md">
              <IconBox size={20} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Catalog</Text>
              <Text size="xl" fw={700}>{products.length}</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color="teal" variant="light" size="lg" radius="md">
              <IconCheck size={20} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Active</Text>
              <Text size="xl" fw={700}>{activeCount}</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color="orange" variant="light" size="lg" radius="md">
              <IconReceipt size={20} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Cost reconciliation</Text>
              <Text size="xl" fw={700}>{reconciliationCount}</Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" align="flex-end">
          <Group gap="sm" align="flex-end" style={{ flex: 1 }}>
            <TextInput
              aria-label="Search products"
              placeholder="Search products..."
              leftSection={<IconSearch size={16} />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              style={{ flex: "1 1 240px", maxWidth: 420 }}
            />
            <Select
              aria-label="Filter by status"
              data={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
              allowDeselect={false}
              w={155}
            />
            <Select
              aria-label="Filter by product type"
              data={[{ value: "all", label: "All types" }, ...typeOptions]}
              value={typeFilter}
              onChange={setTypeFilter}
              allowDeselect={false}
              searchable
              w={190}
            />
          </Group>
          <Group gap="xs">
            <Tooltip label="Refresh products">
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Refresh products"
                loading={loading}
                onClick={() => dispatch(fetchProducts())}
              >
                <IconRefresh size={17} />
              </ActionIcon>
            </Tooltip>
            {permissions.canCreate && (
              <Button leftSection={<IconPlus size={17} />} onClick={openCreateForm}>
                Add product
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {error && (
        <Alert color="red" title="Could not load products">
          {error}
        </Alert>
      )}

      {filteredProducts.length === 0 ? (
        <Paper withBorder radius="md" p={40}>
          <Stack align="center" gap="xs">
            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
              <IconBox size={24} />
            </ThemeIcon>
            <Text fw={600}>
              {products.length === 0 ? "No products yet" : "No products match your filters"}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {products.length === 0
                ? "Create the first sellable experience in your catalog."
                : "Try changing the search term or filters."}
            </Text>
            {products.length === 0 && permissions.canCreate && (
              <Button mt="sm" leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
                Create product
              </Button>
            )}
          </Stack>
        </Paper>
      ) : (
        <>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Showing {filteredProducts.length} of {products.length} products
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
            {filteredProducts.map((product) => {
              const productType =
                typeNameById.get(Number(product.productTypeId)) ??
                `Type ${product.productTypeId ?? "—"}`;
              return (
                <Card key={product.id} withBorder radius="md" padding="lg">
                  <Stack gap="md" h="100%">
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap="sm" align="flex-start" wrap="nowrap">
                        <ThemeIcon size={42} radius="md" variant="light">
                          <IconBox size={21} />
                        </ThemeIcon>
                        <Box>
                          <Text fw={700} lh={1.25}>{product.name || "Unnamed product"}</Text>
                          <Text size="sm" c="dimmed" mt={3}>{productType}</Text>
                        </Box>
                      </Group>
                      {(permissions.canUpdate || permissions.canDelete) && (
                        <Menu position="bottom-end" withinPortal shadow="md">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label="Product actions">
                              <IconDotsVertical size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {permissions.canUpdate && (
                              <Menu.Item
                                leftSection={<IconEdit size={16} />}
                                onClick={() => openEditForm(product)}
                              >
                                Edit product
                              </Menu.Item>
                            )}
                            {permissions.canDelete && (
                              <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={16} />}
                                disabled={deletingId === product.id}
                                onClick={() => handleDelete(product)}
                              >
                                Delete product
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Group>

                    <Group gap="xs">
                      <Badge color={product.status !== false ? "teal" : "gray"} variant="light">
                        {product.status !== false ? "Active" : "Inactive"}
                      </Badge>
                      {product.requiresNightReportCostReconciliation && (
                        <Badge color="orange" variant="light">Cost reconciliation</Badge>
                      )}
                    </Group>

                    <Divider />
                    <Group justify="space-between" align="flex-end" mt="auto">
                      <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Base price</Text>
                        <Text size="xl" fw={700}>{formatPrice(product.price)}</Text>
                      </div>
                      <Text size="xs" c="dimmed">ID #{product.id}</Text>
                    </Group>
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
        title={editingProduct ? "Edit product" : "New product"}
        size="lg"
        centered
        radius="md"
      >
        <Stack gap="md">
          <TextInput
            label="Product name"
            placeholder="e.g. Old Town walking tour"
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Product type"
              placeholder="Choose a type"
              required
              searchable
              data={typeOptions}
              value={form.productTypeId}
              onChange={(value) => setForm((current) => ({ ...current, productTypeId: value }))}
            />
            <NumberInput
              label="Base price"
              required
              min={0}
              decimalScale={2}
              fixedDecimalScale
              value={form.price}
              onChange={(value) => setForm((current) => ({ ...current, price: value }))}
            />
          </SimpleGrid>
          <Paper withBorder radius="md" p="md">
            <Stack gap="md">
              <Switch
                label="Product is active"
                description="Inactive products remain in the catalog but cannot be selected for new sales."
                checked={form.status}
                onChange={(event) =>
                  setForm((current) => ({ ...current, status: event.currentTarget.checked }))
                }
              />
              <Switch
                label="Require night cost reconciliation"
                description="Include this product in night-report cost reconciliation."
                checked={form.requiresNightReportCostReconciliation}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    requiresNightReportCostReconciliation: event.currentTarget.checked,
                  }))
                }
              />
            </Stack>
          </Paper>
          <ProductStorefrontRulesEditor
            value={form.storefrontConfig}
            onChange={(storefrontConfig) =>
              setForm((current) => ({ ...current, storefrontConfig }))
            }
          />
          {formError && (
            <Alert color="red" title="Unable to save">{formError}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeForm} disabled={submitting}>Cancel</Button>
            <Button loading={submitting} onClick={handleSubmit}>
              {editingProduct ? "Save changes" : "Create product"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ProductList;
