import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Group,
  LoadingOverlay,
  MultiSelect,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconAlertCircle, IconChartBar, IconInfoCircle } from '@tabler/icons-react';
import dayjs from 'dayjs';

import { fetchChannelNumbersSummary } from '../../api/channelNumbers';
import {
  ChannelNumbersAddon,
  ChannelNumbersSummary as ChannelNumbersSummaryType,
  ChannelProductMetrics,
} from '../../types/channelNumbers/ChannelNumbersSummary';

type Preset = 'thisMonth' | 'lastMonth' | 'custom';

const DATE_FORMAT = 'YYYY-MM-DD';
const MAIN_PRODUCT_TYPE_SLUG = 'main product';
const MAIN_PRODUCT_LABEL = 'Main Product';
const ACTIVITY_PRODUCT_LABEL = 'Activities';

const normalizeTypeName = (value?: string | null) => (value ?? 'Other').trim().toLowerCase();

const formatDisplayRange = (value: [Date | null, Date | null]) => {
  const [start, end] = value;
  if (!start || !end) {
    return 'Select a date range';
  }
  return `${dayjs(start).format('MMM D, YYYY')} - ${dayjs(end).format('MMM D, YYYY')}`;
};

type ProductGroup = {
  id: number | string;
  name: string;
  slug: string;
  addons: ChannelNumbersAddon[];
};

type ProductTypeGroup = {
  id: number | string;
  name: string;
  slug: string;
  products: ProductGroup[];
};

const getProductColumnCount = (product: ProductGroup) =>
  product.addons.length > 0 ? product.addons.length * 2 + 2 : 2;

const getTypeColumnCount = (type: ProductTypeGroup) =>
  type.products.reduce((sum, product) => sum + getProductColumnCount(product), 0);

const getProductKey = (productId: number | string) => productId.toString();

const getQuantityForProduct = (product: ProductGroup, metrics?: ChannelProductMetrics): number => {
  if (!metrics) {
    return 0;
  }
  if (product.addons.length === 0) {
    return metrics.normal;
  }
  return product.addons.reduce((sum, addon) => sum + (metrics.addons[addon.key] ?? 0), 0);
};

const CELL_BORDER_STYLE: CSSProperties = {
  border: '1px solid var(--mantine-color-gray-4)',
  textAlign: 'center',
};
const EMPHASIS_BORDER = '2px solid var(--mantine-color-gray-6)';
const NO_LEFT_BORDER: CSSProperties = { borderLeft: '0' };
const mergeCellStyles = (...styles: Array<CSSProperties | undefined>) =>
  Object.assign({}, CELL_BORDER_STYLE, ...styles.filter(Boolean));

const ChannelNumbersSummary = () => {
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [range, setRange] = useState<[Date | null, Date | null]>([
    dayjs().startOf('month').toDate(),
    dayjs().endOf('month').toDate(),
  ]);
  const [summary, setSummary] = useState<ChannelNumbersSummaryType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProductTypes, setSelectedProductTypes] = useState<string[]>([]);

  const handlePresetChange = useCallback((value: Preset) => {
    setPreset(value);
    if (value === 'thisMonth') {
      setRange([dayjs().startOf('month').toDate(), dayjs().endOf('month').toDate()]);
      return;
    }
    if (value === 'lastMonth') {
      const lastMonthEnd = dayjs().startOf('month').subtract(1, 'day');
      setRange([lastMonthEnd.startOf('month').toDate(), lastMonthEnd.endOf('month').toDate()]);
      return;
    }
  }, []);

  useEffect(() => {
    const [start, end] = range;
    if (!start || !end) {
      return undefined;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchChannelNumbersSummary({
      startDate: dayjs(start).format(DATE_FORMAT),
      endDate: dayjs(end).format(DATE_FORMAT),
    })
      .then((response) => {
        if (!isMounted) return;
        setSummary(response);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const message =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err as { message?: string }).message ??
          'Failed to load channel numbers';
        setError(message);
        setSummary(null);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [range]);

  const productTypeGroups = useMemo<ProductTypeGroup[]>(() => {
    if (!summary) {
      return [];
    }
    const addonLookup = new Map<string, ChannelNumbersAddon>();
    (summary?.addons ?? []).forEach((addon) => {
      addonLookup.set(addon.key, addon);
    });

    const rawProducts =
      summary?.products && summary.products.length > 0
        ? summary.products
        : (() => {
            const grouped = new Map<
              number | string,
              {
                id: number | string;
                name: string;
                productTypeId: number | null;
                productTypeName: string | null;
                addonKeys: string[];
              }
            >();
            (summary?.addons ?? []).forEach((addon) => {
              const key = addon.productId ?? addon.productName ?? addon.key;
              const existing =
                grouped.get(key) ??
                {
                  id: addon.productId ?? key,
                  name: addon.productName ?? addon.name,
                  productTypeId: addon.productTypeId ?? null,
                  productTypeName: addon.productTypeName ?? null,
                  addonKeys: [],
                };
              existing.addonKeys.push(addon.key);
              grouped.set(key, existing);
            });
            return Array.from(grouped.values());
          })();

    const groups = new Map<string, ProductTypeGroup>();
    const ensureGroup = (typeId: number | string | null, typeName: string | null): ProductTypeGroup => {
      const slug = normalizeTypeName(typeName ?? 'Other');
      if (!groups.has(slug)) {
        groups.set(slug, {
          id: typeId ?? slug,
          name: typeName ?? 'Other',
          slug,
          products: [],
        });
      }
      return groups.get(slug)!;
    };

    rawProducts.forEach((product) => {
      const group = ensureGroup(product.productTypeId ?? `type-${product.id}`, product.productTypeName ?? null);
      const addons =
        (product.addonKeys ?? [])
          .map((key) => addonLookup.get(key))
          .filter((addon): addon is ChannelNumbersAddon => Boolean(addon)) ?? [];
      group.products.push({
        id: product.id,
        name: product.name,
        slug: normalizeTypeName(product.name),
        addons,
      });
    });

    if (groups.size === 0) {
      groups.set(MAIN_PRODUCT_TYPE_SLUG, {
        id: MAIN_PRODUCT_TYPE_SLUG,
        name: MAIN_PRODUCT_LABEL,
        slug: MAIN_PRODUCT_TYPE_SLUG,
        products: [
          {
            id: 'default-main',
            name: MAIN_PRODUCT_LABEL,
            slug: normalizeTypeName(MAIN_PRODUCT_LABEL),
            addons: [],
          },
        ],
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        products: group.products.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [summary]);

  const selectableProductTypes = useMemo(() => {
    const names = new Set(productTypeGroups.map((group) => group.name));
    return Array.from(names);
  }, [productTypeGroups]);

  useEffect(() => {
    if (selectableProductTypes.length === 0) {
      setSelectedProductTypes([]);
      return;
    }
    setSelectedProductTypes((prev) => {
      const prevKey = [...prev].sort().join('|');
      const nextKey = [...selectableProductTypes].sort().join('|');
      if (prevKey === nextKey) {
        return prev;
      }
      return selectableProductTypes;
    });
  }, [selectableProductTypes]);

  const visibleTypeGroups = useMemo(() => {
    if (selectedProductTypes.length === 0) {
      return productTypeGroups;
    }
    const selected = new Set(selectedProductTypes);
    return productTypeGroups.filter((group) => selected.has(group.name));
  }, [productTypeGroups, selectedProductTypes]);

  const totalTypeColumns = useMemo(
    () => visibleTypeGroups.reduce((sum, group) => sum + getTypeColumnCount(group), 0),
    [visibleTypeGroups],
  );

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0,
      }),
    [],
  );
  const renderValue = useCallback(
    (value: number) => <Text fw={value > 0 ? 600 : undefined}>{numberFormatter.format(value)}</Text>,
    [numberFormatter],
  );

  const renderMetricCard = (label: string, value: number, color: string) => (
    <Paper withBorder p="md" key={label}>
      <Group justify="space-between">
        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Text size="xl" fw={700}>
            {numberFormatter.format(value)}
          </Text>
        </Stack>
        <ThemeIcon color={color} variant="light" size="lg">
          <IconChartBar size={18} />
        </ThemeIcon>
      </Group>
    </Paper>
  );

  const tableHasData = Boolean(summary && summary.channels.length > 0);

  return (
    <Stack mt="lg">
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end">
            <Stack gap={4}>
              <Text fw={600}>Reporting period</Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant={preset === 'thisMonth' ? 'filled' : 'light'}
                  onClick={() => handlePresetChange('thisMonth')}
                >
                  This Month
                </Button>
                <Button
                  size="xs"
                  variant={preset === 'lastMonth' ? 'filled' : 'light'}
                  onClick={() => handlePresetChange('lastMonth')}
                >
                  Last Month
                </Button>
                <Button
                  size="xs"
                  variant={preset === 'custom' ? 'filled' : 'light'}
                  onClick={() => setPreset('custom')}
                >
                  Custom
                </Button>
              </Group>
            </Stack>
            {preset === 'custom' ? (
              <DatePickerInput
                type="range"
                value={range}
                onChange={setRange}
                maxDate={dayjs().endOf('day').toDate()}
                placeholder="Select range"
                allowSingleDateInRange
              />
            ) : (
              <Text size="sm" c="dimmed">
                {formatDisplayRange(range)}
              </Text>
            )}
          </Group>
          {selectableProductTypes.length > 0 && (
            <MultiSelect
              label="Product types"
              data={selectableProductTypes.map((type) => ({ label: type, value: type }))}
              value={selectedProductTypes}
              onChange={setSelectedProductTypes}
              placeholder="Select product types"
              clearable
            />
          )}
        </Stack>
      </Paper>

      <Paper withBorder p="md" pos="relative">
        <LoadingOverlay visible={loading} zIndex={5} />
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} mb="md">
            {error}
          </Alert>
        )}
        {summary && (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              {renderMetricCard('Pub crawl attendees', summary.totals.normal, 'blue')}
              {renderMetricCard(
                'Add-ons sold',
                Object.values(summary.totals.addons).reduce((sum, v) => sum + v, 0),
                'green',
              )}
              {renderMetricCard('Platform total', summary.totals.total, 'violet')}
            </SimpleGrid>
            <ScrollArea>
              <Table
                highlightOnHover
                withColumnBorders
                withRowBorders
                withTableBorder
                horizontalSpacing="sm"
                verticalSpacing="xs"
                style={{ borderWidth: 2, borderColor: 'var(--mantine-color-gray-5)' }}
              >
                <thead>
                  <tr>
                    <th
                      rowSpan={3}
                      style={mergeCellStyles({
                        textAlign: 'center',
                        borderRight: EMPHASIS_BORDER,
                        borderBottom: EMPHASIS_BORDER,
                      })}
                    >
                      Channel
                    </th>
                    {visibleTypeGroups.map((group, groupIndex) => (
                      <th
                        key={`type-${group.slug}`}
                        colSpan={getTypeColumnCount(group)}
                        style={{
                          ...mergeCellStyles({
                            textAlign: 'center',
                            fontWeight: 700,
                            borderLeft: groupIndex === 0 ? undefined : EMPHASIS_BORDER,
                            borderRight: groupIndex === visibleTypeGroups.length - 1 ? undefined : EMPHASIS_BORDER,
                            borderBottom: EMPHASIS_BORDER,
                          }),
                        }}
                      >
                        {group.name}
                      </th>
                    ))}
                    <th
                      rowSpan={3}
                      style={mergeCellStyles({
                        textAlign: 'center',
                        borderLeft: EMPHASIS_BORDER,
                        borderBottom: EMPHASIS_BORDER,
                        fontWeight: 700,
                      })}
                    >
                      Totals by Platform
                    </th>
                  </tr>
                  <tr>
                    {visibleTypeGroups.flatMap((group, groupIndex) =>
                      group.products.map((product, productIndex) => (
                        <th
                          key={`product-${group.slug}-${product.slug}`}
                          colSpan={getProductColumnCount(product)}
                          style={{
                            ...mergeCellStyles({
                              textAlign: 'center',
                              fontWeight: 600,
                              borderBottom: EMPHASIS_BORDER,
                            }),
                            borderLeft: EMPHASIS_BORDER,
                            borderRight:
                              productIndex === group.products.length - 1
                                ? groupIndex === visibleTypeGroups.length - 1
                                  ? undefined
                                  : EMPHASIS_BORDER
                                : undefined,
                          }}
                        >
                          {product.name}
                        </th>
                      )),
                    )}
                  </tr>
                  <tr>
                    {visibleTypeGroups.flatMap((group, groupIndex) =>
                      group.products.flatMap((product, productIndex) =>
                        product.addons.length > 0
                          ? [
                              <th
                                key={`label-normal-${group.slug}-${product.slug}`}
                                style={{
                                  ...mergeCellStyles({ textAlign: 'center', fontWeight: 600 }),
                                  borderLeft: EMPHASIS_BORDER,
                                  borderBottom: EMPHASIS_BORDER,
                                }}
                              >
                                Normal
                              </th>,
                              <th
                                key={`label-nonshow-${group.slug}-${product.slug}`}
                                style={mergeCellStyles(
                                  { textAlign: 'center', fontWeight: 600, borderBottom: EMPHASIS_BORDER },
                                  NO_LEFT_BORDER,
                                )}
                              >
                                Non-Show
                              </th>,
                              ...product.addons.flatMap((addon, addonIndex) => [
                                <th
                                  key={`label-addon-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles({
                                    textAlign: 'center',
                                    fontWeight: 600,
                                    borderBottom: EMPHASIS_BORDER,
                                  })}
                                >
                                  {addon.name}
                                </th>,
                                <th
                                  key={`label-addon-nonshow-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles(
                                    {
                                      textAlign: 'center',
                                      fontWeight: 600,
                                      borderBottom: EMPHASIS_BORDER,
                                    },
                                    NO_LEFT_BORDER,
                                    addonIndex === product.addons.length - 1 &&
                                      (groupIndex !== visibleTypeGroups.length - 1 ||
                                        productIndex !== group.products.length - 1)
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  {`${addon.name} (Non-Show)`}
                                </th>,
                              ]),
                            ]
                          : [
                                <th
                                  key={`label-quantity-${group.slug}-${product.slug}`}
                                  style={{
                                    ...mergeCellStyles({ textAlign: 'center', fontWeight: 600 }),
                                    borderLeft: EMPHASIS_BORDER,
                                    borderBottom: EMPHASIS_BORDER,
                                  }}
                                >
                                  Quantity
                                </th>,
                                <th
                                  key={`label-quantity-nonshow-${group.slug}-${product.slug}`}
                                  style={mergeCellStyles(
                                    {
                                      textAlign: 'center',
                                      fontWeight: 600,
                                      borderBottom: EMPHASIS_BORDER,
                                    },
                                    NO_LEFT_BORDER,
                                    productIndex === group.products.length - 1 && groupIndex !== visibleTypeGroups.length - 1
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  Non-Show
                                </th>,
                              ],
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tableHasData ? (
                    summary.channels.map((channel) => (
                      <tr key={channel.channelId}>
                        <td style={mergeCellStyles({ borderRight: EMPHASIS_BORDER })}>
                          <Text fw={600}>{channel.channelName}</Text>
                        </td>
                        {visibleTypeGroups.flatMap((group, groupIndex) =>
                          group.products.flatMap((product, productIndex) => {
                            const isLastProductInGroup = productIndex === group.products.length - 1;
                            const productKey = getProductKey(product.id);
                            const productMetrics = channel.products?.[productKey];
                            if (product.addons.length > 0) {
                              const normalValue = productMetrics?.normal ?? 0;
                              const nonShowValue = productMetrics?.nonShow ?? 0;
                              return [
                                <td
                                  key={`normal-${group.slug}-${product.slug}-${channel.channelId}`}
                                  style={mergeCellStyles({
                                    fontWeight:
                                      group.slug === MAIN_PRODUCT_TYPE_SLUG && normalValue > 0 ? 600 : undefined,
                                    borderLeft: EMPHASIS_BORDER,
                                  })}
                                >
                                  {renderValue(normalValue)}
                                </td>,
                                <td
                                  key={`nonshow-${group.slug}-${product.slug}-${channel.channelId}`}
                                  style={mergeCellStyles(NO_LEFT_BORDER)}
                                >
                                  {renderValue(nonShowValue)}
                                </td>,
                                ...product.addons.flatMap((addon, addonIndex) => [
                                  <td
                                    key={`addon-${group.slug}-${product.slug}-${addon.key}-${channel.channelId}`}
                                    style={mergeCellStyles()}
                                  >
                                    {renderValue(productMetrics?.addons?.[addon.key] ?? 0)}
                                  </td>,
                                <td
                                  key={`addon-nonshow-${group.slug}-${product.slug}-${addon.key}-${channel.channelId}`}
                                  style={mergeCellStyles(
                                    NO_LEFT_BORDER,
                                    isLastProductInGroup &&
                                      addonIndex === product.addons.length - 1 &&
                                      groupIndex !== visibleTypeGroups.length - 1
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  {renderValue(productMetrics?.addonNonShow?.[addon.key] ?? 0)}
                                </td>,
                              ]),
                              ];
                            }
                            return [
                              <td
                                key={`quantity-${group.slug}-${product.slug}-${channel.channelId}`}
                                style={mergeCellStyles(
                                  { borderLeft: EMPHASIS_BORDER },
                                )}
                              >
                                {renderValue(getQuantityForProduct(product, productMetrics))}
                              </td>,
                              <td
                                key={`quantity-nonshow-${group.slug}-${product.slug}-${channel.channelId}`}
                                style={mergeCellStyles(
                                  NO_LEFT_BORDER,
                                  isLastProductInGroup && groupIndex !== visibleTypeGroups.length - 1
                                    ? { borderRight: EMPHASIS_BORDER }
                                    : undefined,
                                )}
                              >
                                {renderValue(productMetrics?.nonShow ?? 0)}
                              </td>,
                            ];
                          }),
                        )}
                        <td style={mergeCellStyles({ fontWeight: 600, borderLeft: EMPHASIS_BORDER })}>
                          {renderValue(channel.total)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={1 + totalTypeColumns + 1}
                        style={mergeCellStyles({ textAlign: 'center', borderLeft: EMPHASIS_BORDER, borderRight: EMPHASIS_BORDER })}
                      >
                        <Group justify="center" gap="xs">
                          <IconInfoCircle size={16} />
                          <Text c="dimmed" size="sm">
                            No channel metrics available for the selected period.
                          </Text>
                        </Group>
                      </td>
                    </tr>
                  )}
                </tbody>
                {tableHasData && (
                  <tfoot>
                    <tr>
                      <td style={mergeCellStyles({ borderRight: EMPHASIS_BORDER, borderTop: EMPHASIS_BORDER })}>
                        <Text fw={700}>Total</Text>
                      </td>
                      {visibleTypeGroups.flatMap((group, groupIndex) =>
                        group.products.flatMap((product, productIndex) => {
                          const isLastProductInGroup = productIndex === group.products.length - 1;
                          const productKey = getProductKey(product.id);
                          const productTotals = summary.productTotals?.[productKey];
                          if (product.addons.length > 0) {
                            const normalTotal = productTotals?.normal ?? 0;
                            const nonShowTotal = productTotals?.nonShow ?? 0;
                            return [
                              <td
                                key={`total-normal-${group.slug}-${product.slug}`}
                                style={mergeCellStyles({ borderTop: EMPHASIS_BORDER, borderLeft: EMPHASIS_BORDER })}
                              >
                                {renderValue(normalTotal)}
                              </td>,
                              <td
                                key={`total-nonshow-${group.slug}-${product.slug}`}
                                style={mergeCellStyles({ borderTop: EMPHASIS_BORDER }, NO_LEFT_BORDER)}
                              >
                                {renderValue(nonShowTotal)}
                              </td>,
                              ...product.addons.flatMap((addon, addonIndex) => [
                                <td
                                  key={`total-addon-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles({ borderTop: EMPHASIS_BORDER })}
                                >
                                  {renderValue(productTotals?.addons?.[addon.key] ?? 0)}
                                </td>,
                                <td
                                  key={`total-addon-nonshow-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles(
                                    { borderTop: EMPHASIS_BORDER },
                                    NO_LEFT_BORDER,
                                    isLastProductInGroup &&
                                      addonIndex === product.addons.length - 1 &&
                                      groupIndex !== visibleTypeGroups.length - 1
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  {renderValue(productTotals?.addonNonShow?.[addon.key] ?? 0)}
                                </td>,
                              ]),
                            ];
                          }
                          return [
                            <td
                              key={`total-quantity-${group.slug}-${product.slug}`}
                              style={mergeCellStyles(
                                { borderTop: EMPHASIS_BORDER, borderLeft: EMPHASIS_BORDER },
                              )}
                            >
                              {renderValue(getQuantityForProduct(product, productTotals))}
                            </td>,
                            <td
                              key={`total-quantity-nonshow-${group.slug}-${product.slug}`}
                              style={mergeCellStyles(
                                { borderTop: EMPHASIS_BORDER },
                                NO_LEFT_BORDER,
                                isLastProductInGroup && groupIndex !== visibleTypeGroups.length - 1
                                  ? { borderRight: EMPHASIS_BORDER }
                                  : undefined,
                              )}
                            >
                              {renderValue(productTotals?.nonShow ?? 0)}
                            </td>,
                          ];
                        }),
                      )}
                      <td style={mergeCellStyles({ borderLeft: EMPHASIS_BORDER, borderTop: EMPHASIS_BORDER })}>
                        {renderValue(summary.totals.total)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </Table>
            </ScrollArea>
          </Stack>
        )}
        {!loading && !summary && !error && (
          <Stack align="center" gap={4} mt="md">
            <IconInfoCircle size={20} />
            <Text size="sm" c="dimmed">
              Select a reporting range to load channel metrics.
            </Text>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
};

export default ChannelNumbersSummary;
