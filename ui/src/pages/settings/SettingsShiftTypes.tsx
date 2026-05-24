import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Group, MultiSelect, Stack, Text, TextInput } from "@mantine/core";
import {
  useCreateShiftType,
  useDeleteShiftType,
  useShiftTypes,
  useUpdateShiftType,
  useUpdateShiftTypeProducts,
} from "../../api/scheduling";
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
  const createMutation = useCreateShiftType();
  const updateTypeMutation = useUpdateShiftType();
  const deleteTypeMutation = useDeleteShiftType();
  const productsState = useAppSelector((state) => state.products[0]);
  const [overrides, setOverrides] = useState<Record<number, string[]>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({ key: "", name: "", description: "" });
  const [editForm, setEditForm] = useState({ key: "", name: "", description: "" });

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
  const isSaving =
    updateMutation.isPending ||
    createMutation.isPending ||
    updateTypeMutation.isPending ||
    deleteTypeMutation.isPending;

  const handleSelectionChange = async (shiftTypeId: number, values: string[]) => {
    setOverrides((prev) => ({ ...prev, [shiftTypeId]: values }));
    await updateMutation.mutateAsync({
      shiftTypeId,
      productIds: values.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
    });
  };

  const beginEdit = (shiftType: ShiftType) => {
    setEditingId(shiftType.id);
    setEditForm({
      key: shiftType.key ?? "",
      name: shiftType.name ?? "",
      description: shiftType.description ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ key: "", name: "", description: "" });
  };

  const submitCreate = async () => {
    if (!moduleAccess.canCreate || createMutation.isPending) return;
    if (!createForm.name.trim()) return;
    await createMutation.mutateAsync({
      key: createForm.key.trim() || undefined,
      name: createForm.name.trim(),
      description: createForm.description.trim() || null,
    });
    setCreateForm({ key: "", name: "", description: "" });
  };

  const submitEdit = async (shiftTypeId: number) => {
    if (!moduleAccess.canUpdate || updateTypeMutation.isPending) return;
    if (!editForm.name.trim()) return;
    await updateTypeMutation.mutateAsync({
      shiftTypeId,
      key: editForm.key.trim() || undefined,
      name: editForm.name.trim(),
      description: editForm.description.trim() || null,
    });
    cancelEdit();
  };

  const handleDelete = async (shiftType: ShiftType) => {
    if (!moduleAccess.canDelete || deleteTypeMutation.isPending) return;
    const confirmed = window.confirm(
      `Delete shift type "${shiftType.name}"?\n\nThis only works if it is not used by templates, instances, or availability.`,
    );
    if (!confirmed) return;
    await deleteTypeMutation.mutateAsync(shiftType.id);
    if (editingId === shiftType.id) {
      cancelEdit();
    }
  };

  const mutationError =
    (createMutation.error as Error | undefined)?.message ||
    (updateTypeMutation.error as Error | undefined)?.message ||
    (deleteTypeMutation.error as Error | undefined)?.message ||
    (updateMutation.error as Error | undefined)?.message ||
    null;

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

        {mutationError ? (
          <Alert color="red" title="Shift type operation failed">
            {mutationError}
          </Alert>
        ) : null}

        <Card withBorder radius="md" padding="md">
          <Stack gap="sm">
            <Text fw={600}>Create shift type</Text>
            <Group align="flex-end">
              <TextInput
                label="Name"
                placeholder="e.g. Event Support"
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.currentTarget.value }))}
                disabled={!moduleAccess.canCreate || createMutation.isPending}
                required
                style={{ flex: 1, minWidth: 220 }}
              />
              <TextInput
                label="Key (optional)"
                placeholder="EVENT_SUPPORT"
                value={createForm.key}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, key: event.currentTarget.value }))}
                disabled={!moduleAccess.canCreate || createMutation.isPending}
                style={{ flex: 1, minWidth: 220 }}
              />
            </Group>
            <TextInput
              label="Description"
              placeholder="Optional description"
              value={createForm.description}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.currentTarget.value }))}
              disabled={!moduleAccess.canCreate || createMutation.isPending}
            />
            <Group justify="flex-end">
              <Button
                onClick={submitCreate}
                disabled={!moduleAccess.canCreate || !createForm.name.trim()}
                loading={createMutation.isPending}
              >
                Create Shift Type
              </Button>
            </Group>
          </Stack>
        </Card>

        <Stack gap="md">
          {shiftTypes.map((shiftType) => {
            const selected =
              overrides[shiftType.id] ??
              (shiftType.productIds ?? []).map((value) => value.toString());
            const isEditing = editingId === shiftType.id;
            return (
              <Card key={shiftType.id} withBorder radius="md" padding="md">
                <Stack gap="sm">
                  {isEditing ? (
                    <>
                      <Group align="flex-end">
                        <TextInput
                          label="Name"
                          value={editForm.name}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, name: event.currentTarget.value }))
                          }
                          style={{ flex: 1, minWidth: 220 }}
                        />
                        <TextInput
                          label="Key"
                          value={editForm.key}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, key: event.currentTarget.value }))
                          }
                          style={{ flex: 1, minWidth: 220 }}
                        />
                      </Group>
                      <TextInput
                        label="Description"
                        value={editForm.description}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, description: event.currentTarget.value }))
                        }
                      />
                      <Group justify="flex-end">
                        <Button variant="light" onClick={cancelEdit} disabled={updateTypeMutation.isPending}>
                          Cancel
                        </Button>
                        <Button
                          onClick={() => submitEdit(shiftType.id)}
                          disabled={!editForm.name.trim()}
                          loading={updateTypeMutation.isPending}
                        >
                          Save
                        </Button>
                      </Group>
                    </>
                  ) : (
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Stack gap={4} style={{ flex: 1 }}>
                        <Text fw={600}>{shiftType.name}</Text>
                        <Text size="xs" c="dimmed">
                          Key: {shiftType.key}
                        </Text>
                        {shiftType.description ? (
                          <Text size="sm" c="dimmed">
                            {shiftType.description}
                          </Text>
                        ) : null}
                      </Stack>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => beginEdit(shiftType)}
                          disabled={!moduleAccess.canUpdate || isSaving}
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          onClick={() => handleDelete(shiftType)}
                          disabled={!moduleAccess.canDelete || isSaving}
                        >
                          Delete
                        </Button>
                      </Group>
                    </Group>
                  )}

                  <MultiSelect
                    data={productOptions}
                    label="Linked products"
                    placeholder={productOptions.length === 0 ? "No products available" : "Select products"}
                    value={selected}
                    onChange={(values) => handleSelectionChange(shiftType.id, values)}
                    searchable
                    clearable
                    nothingFoundMessage="No products"
                    disabled={updateMutation.isPending || !moduleAccess.canUpdate}
                    w={360}
                  />
                </Stack>
              </Card>
            );
          })}
        </Stack>
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsShiftTypes;
