import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconBuildingStore, IconPlus } from "@tabler/icons-react";
import { createFinanceVendor } from "../../actions/financeActions";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useAppDispatch } from "../../store/hooks";
import { getFinanceErrorMessage } from "./financeFormatters";
import { FinanceModal, FinanceModalFooter, FinancePrimaryAction } from "./FinanceUi";
import {
  CREATE_VENDOR_OPTION_VALUE,
  filterInlineVendorOptions,
  getInlineVendorNameSuggestion,
  resolveInlineVendorDefaultCategoryId,
  validateInlineVendorName,
  type VendorDefaultCategoryOption,
  type VendorOption,
} from "./inlineVendorCreate";

type InlineVendorSelectProps = {
  options: VendorOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  onCreateModalOpenChange?: (opened: boolean) => void;
  defaultCategoryId?: number | null;
  defaultCategoryOptions?: VendorDefaultCategoryOption[];
  disabled?: boolean;
};

export const InlineVendorSelect = ({
  options,
  value,
  onChange,
  onCreateModalOpenChange,
  defaultCategoryId = null,
  defaultCategoryOptions = [],
  disabled = false,
}: InlineVendorSelectProps) => {
  const dispatch = useAppDispatch();
  const vendorAccess = useModuleAccess(PAGE_SLUGS.financeVendors);
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorDefaultCategoryId, setVendorDefaultCategoryId] = useState<number | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreate = vendorAccess.ready && vendorAccess.canCreate;

  const selectOptions = useMemo(
    () => [
      ...options,
      ...(canCreate
        ? [{ value: CREATE_VENDOR_OPTION_VALUE, label: "Create new vendor" }]
        : []),
    ],
    [canCreate, options],
  );

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? null,
    [options, value],
  );

  const closeCreateModal = () => {
    if (saving) {
      return;
    }
    setCreateModalOpen(false);
    onCreateModalOpenChange?.(false);
    setVendorName("");
    setVendorDefaultCategoryId(null);
    setError(null);
  };

  const openCreateModal = () => {
    setVendorName(getInlineVendorNameSuggestion(vendorSearch, selectedLabel));
    setVendorDefaultCategoryId(
      resolveInlineVendorDefaultCategoryId(defaultCategoryId, defaultCategoryOptions),
    );
    setError(null);
    setCreateModalOpen(true);
    onCreateModalOpenChange?.(true);
  };

  const handleCreateVendor = async () => {
    const normalizedName = vendorName.trim();
    const validationError = validateInlineVendorName(normalizedName, options);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const createdVendor = await dispatch(
        createFinanceVendor({
          name: normalizedName,
          defaultCategoryId: vendorDefaultCategoryId,
          isActive: true,
        }),
      ).unwrap();
      onChange(String(createdVendor.id));
      setCreateModalOpen(false);
      onCreateModalOpenChange?.(false);
      setVendorName("");
      setVendorDefaultCategoryId(null);
      setVendorSearch(createdVendor.name);
    } catch (createError) {
      setError(getFinanceErrorMessage(createError, "Unable to create this vendor."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Select
        label="Vendor"
        aria-label="Vendor"
        data={selectOptions}
        value={value}
        onChange={(nextValue) => {
          if (nextValue === CREATE_VENDOR_OPTION_VALUE) {
            openCreateModal();
            return;
          }
          onChange(nextValue);
        }}
        onSearchChange={setVendorSearch}
        filter={canCreate ? filterInlineVendorOptions : undefined}
        renderOption={({ option }) =>
          option.value === CREATE_VENDOR_OPTION_VALUE ? (
            <Group gap="xs" wrap="nowrap" py={2} c="blue.7">
              <ThemeIcon size={24} radius="xl" variant="light" color="blue">
                <IconPlus size={15} stroke={2.4} />
              </ThemeIcon>
              <Text size="sm" fw={750}>Create new vendor</Text>
            </Group>
          ) : (
            option.label
          )
        }
        searchable
        withAsterisk
        disabled={disabled}
        nothingFoundMessage="No vendors found"
      />

      <FinanceModal
        opened={createModalOpen}
        onClose={closeCreateModal}
        title="Create vendor"
        size="sm"
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        zIndex={400}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleCreateVendor();
          }}
        >
          <Stack gap="md">
            <Group justify="center">
              <ThemeIcon size={42} radius="xl" color="blue" variant="light">
                <IconBuildingStore size={21} />
              </ThemeIcon>
            </Group>
            <TextInput
              label="Vendor name"
              placeholder="Business or supplier name"
              value={vendorName}
              onChange={(event) => {
                setVendorName(event.currentTarget.value);
                if (error) {
                  setError(null);
                }
              }}
              autoFocus
              withAsterisk
              maxLength={200}
              styles={{ label: { width: "100%", textAlign: "center" }, input: { textAlign: "center" } }}
            />
            <Select
              label="Default category (optional)"
              placeholder="No default category"
              data={defaultCategoryOptions}
              value={vendorDefaultCategoryId ? String(vendorDefaultCategoryId) : null}
              onChange={(nextValue) => {
                setVendorDefaultCategoryId(nextValue ? Number(nextValue) : null);
                setError(null);
              }}
              searchable
              clearable
              disabled={saving}
              nothingFoundMessage="No expense categories found"
              comboboxProps={{ zIndex: 500 }}
              styles={{ label: { width: "100%", textAlign: "center" }, input: { textAlign: "center" } }}
            />
            {error ? <Alert color="red" ta="center">{error}</Alert> : null}
            <FinanceModalFooter>
              <Button
                type="button"
                variant="default"
                onClick={closeCreateModal}
                disabled={saving}
                fullWidth={isMobile}
              >
                Cancel
              </Button>
              <FinancePrimaryAction
                type="submit"
                leftSection={<IconPlus size={16} />}
                loading={saving}
                disabled={!vendorName.trim()}
                fullWidth={isMobile}
              >
                Create and select
              </FinancePrimaryAction>
            </FinanceModalFooter>
          </Stack>
        </form>
      </FinanceModal>
    </>
  );
};
