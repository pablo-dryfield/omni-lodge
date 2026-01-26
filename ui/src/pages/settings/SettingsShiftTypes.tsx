import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Group, MultiSelect, Stack, Text } from "@mantine/core";
import { useShiftTypes, useUpdateShiftTypeProducts } from "../../api/scheduling";
import { fetchProducts } from "../../actions/productActions";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import type { ShiftType } from "../../types/scheduling";
import type { Product } from "../../types/products/Product";

const PAGE_SLUG = PAGE_SLUGS.settingsShiftTypes;
const MODULE_SLUG = "shift-type-directory";

const SettingsShiftTypes = () => {
  const dispatch = useAppDispatch();
  const moduleAccess = useModuleAccess(MODULE_SLUG);
  const shiftTypesQuery = useShiftTypes();
  const updateMutation = useUpdateShiftTypeProducts();
  const productsState = useAppSelector((state) => state.products[0]);
  const [overrides, setOverrides] = useState<Record<number, string[]>>({});

  useEffect(() => {
    if (!productsState.loading && productsState.data[0]?.data.length === 0) {
      dispatch(fetchProducts());
    }
  }, [dispatch, productsState.data, productsState.loading]);

  const products = useMemo(
    () => (productsState.data[0]?.data ?? []) as Partial<Product>[],
    [productsState.data],
  );
  const productOptions = useMemo(
    () =>
      products
        .filter((product) => product.status !== false)
        .map((product) => ({
          value: String(product.id),
          label: product.name ?? `Product #${product.id}`,
        })),
    [products],
  );

  const shiftTypes = useMemo<ShiftType[]>(() => shiftTypesQuery.data ?? [], [shiftTypesQuery.data]);

  const handleSelectionChange = async (shiftTypeId: number, values: string[]) => {
    setOverrides((prev) => ({ ...prev, [shiftTypeId]: values }));
    await updateMutation.mutateAsync({
      shiftTypeId,
      productIds: values.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
    });
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack mt="lg" gap="lg">
        <Stack gap={4}>
          <Text fw={600}>Shift types</Text>
          <Text size="sm" c="dimmed">
            Link shift types to products so counters can prefill staff based on scheduled assignments.
          </Text>
        </Stack>

        {shiftTypesQuery.isError ? (
          <Alert color="red" title="Failed to load shift types">
            {(shiftTypesQuery.error as Error).message}
          </Alert>
        ) : null}

        {updateMutation.isError ? (
          <Alert color="red" title="Failed to save shift type products">
            {(updateMutation.error as Error).message}
          </Alert>
        ) : null}

        <Stack gap="md">
          {shiftTypes.map((shiftType) => {
            const selected =
              overrides[shiftType.id] ??
              (shiftType.productIds ?? []).map((value) => value.toString());
            return (
              <Card key={shiftType.id} withBorder radius="md" padding="md">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Text fw={600}>{shiftType.name}</Text>
                    {shiftType.description ? (
                      <Text size="sm" c="dimmed">
                        {shiftType.description}
                      </Text>
                    ) : null}
                  </Stack>
                  <MultiSelect
                    data={productOptions}
                    placeholder={productOptions.length === 0 ? "No products available" : "Select products"}
                    value={selected}
                    onChange={(values) => handleSelectionChange(shiftType.id, values)}
                    searchable
                    clearable
                    nothingFoundMessage="No products"
                    disabled={updateMutation.isPending || !moduleAccess.canUpdate}
                    w={360}
                  />
                </Group>
              </Card>
            );
          })}
        </Stack>
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsShiftTypes;
