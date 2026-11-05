import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Badge, Box, Button, Collapse, Group, Loader, NumberInput, Pagination, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowDown, IconArrowUp, IconArrowsSort, IconFilter, IconSearch, IconX } from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import type { OngoingCart, OngoingCartPage } from '../../types/storefrontOngoingCarts';
import classes from './OngoingCartsPanel.module.css';

const FILTERS = ['search', 'status', 'recovery', 'productId', 'country', 'currency', 'activityFrom', 'activityTo', 'experienceFrom', 'experienceTo', 'minAmount', 'maxAmount'] as const;
type Filters = Record<typeof FILTERS[number], string>;
const keyFor = (key: string) => `cart${key[0].toUpperCase()}${key.slice(1)}`;
const readFilters = (params: URLSearchParams): Filters => Object.fromEntries(FILTERS.map(key => [key, params.get(keyFor(key)) ?? ''])) as Filters;
const STATUS = [{ value: 'active', label: 'Active cart' }, { value: 'checkout_started', label: 'Checkout started' }, { value: 'sending_recovery', label: 'Sending recovery' }, { value: 'recovery_sent', label: 'Recovery sent' }];
const RECOVERY = [{ value: 'not_sent', label: 'Not sent' }, { value: 'due', label: 'Due, not sent' }, { value: 'sent', label: 'Sent, not opened' }, { value: 'opened', label: 'Link opened' }];
const SORTS = [
  { value: 'activity_desc', label: 'Last activity: newest first' }, { value: 'activity_asc', label: 'Last activity: oldest first' },
  { value: 'created_desc', label: 'Created: newest first' }, { value: 'created_asc', label: 'Created: oldest first' },
  { value: 'customer_asc', label: 'Customer: A–Z' }, { value: 'customer_desc', label: 'Customer: Z–A' },
  { value: 'amount_desc', label: 'Amount: highest first, by currency' }, { value: 'amount_asc', label: 'Amount: lowest first, by currency' },
  { value: 'experience_asc', label: 'Experience: earliest first' }, { value: 'experience_desc', label: 'Experience: latest first' },
  { value: 'recovery_desc', label: 'Recovery emails: most first' }, { value: 'recovery_asc', label: 'Recovery emails: fewest first' },
];
const FILTER_LABELS: Record<keyof Filters, string> = { search: 'Search', status: 'Status', recovery: 'Recovery', productId: 'Product', country: 'Country', currency: 'Currency', activityFrom: 'Activity from', activityTo: 'Activity to', experienceFrom: 'Experience from', experienceTo: 'Experience to', minAmount: 'Min amount', maxAmount: 'Max amount' };
const countryName = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; } };
const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(value)) : '—';
const money = (cart: OngoingCart) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cart.currency }).format(cart.total);
type Props = {
  revision: number;
  renderCustomer: (cart: OngoingCart) => ReactNode;
  renderExperiences: (cart: OngoingCart) => ReactNode;
  renderActions: (cart: OngoingCart) => ReactNode;
};

export default function OngoingCartsPanel({ revision, renderCustomer, renderExperiences, renderActions }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterKey = JSON.stringify(readFilters(searchParams));
  const applied = useMemo(() => JSON.parse(filterKey) as Filters, [filterKey]);
  const [draft, setDraft] = useState<Filters>(applied);
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<OngoingCartPage | null>(null);
  const [loadedRequestKey, setLoadedRequestKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [retry, setRetry] = useState(0);
  const isMobile = useMediaQuery('(max-width: 62em)');
  const sort = SORTS.some(option => option.value === searchParams.get('cartSort')) ? searchParams.get('cartSort')! : 'activity_desc';
  const pageSize = ['10', '25', '50', '100'].includes(searchParams.get('cartPageSize') ?? '') ? searchParams.get('cartPageSize')! : '25';
  const page = Math.max(1, Math.min(1000000, Math.floor(Number(searchParams.get('cartPage')) || 1)));
  const filterCount = FILTERS.filter(key => applied[key]).length;
  const pendingFilters = FILTERS.some(key => draft[key] !== applied[key]);
  useEffect(() => { setDraft(applied); setFormError(''); }, [applied]);
  const requestKey = JSON.stringify({ ...applied, sort, pageSize, page });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void axiosInstance.get<OngoingCartPage>('/storefront-ongoing-carts', { params: JSON.parse(requestKey), signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) { setResult(response.data); setLoadedRequestKey(requestKey); } })
      .catch(err => { if (!controller.signal.aborted) { setResult(null); setError(err.response?.data?.message ?? err.response?.data?.error?.message ?? err.response?.data?.[0]?.message ?? err.message ?? 'Unable to load carts.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestKey, revision, retry]);
  useEffect(() => {
    if (loading || !result || loadedRequestKey !== requestKey || result.pagination.page === page) return;
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('cartPage', String(result.pagination.page)); return next; }, { replace: true });
  }, [loading, result, loadedRequestKey, requestKey, page, setSearchParams]);
  const changeQuery = (values: Record<string, string | null>) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    Object.entries(values).forEach(([key, value]) => { if (value) next.set(keyFor(key), value); else next.delete(keyFor(key)); });
    return next;
  });
  const apply = () => {
    for (const group of ['activity', 'experience'] as const) {
      if (draft[`${group}From`] && draft[`${group}To`] && draft[`${group}From`] > draft[`${group}To`]) { setFormError('Start date cannot be after end date.'); setExpanded(true); return; }
    }
    if (draft.minAmount && draft.maxAmount && Number(draft.minAmount) > Number(draft.maxAmount)) { setFormError('Minimum amount cannot exceed maximum amount.'); setExpanded(true); return; }
    setFormError(''); changeQuery({ ...draft, page: null });
  };
  const reset = () => changeQuery({ ...Object.fromEntries(FILTERS.map(key => [key, null])), page: null });
  const update = (key: keyof Filters, value: string | null) => setDraft(current => ({ ...current, [key]: value ?? '', ...(key === 'currency' && value !== current.currency ? { minAmount: '', maxAmount: '' } : {}) }));
  const sortHeader = (label: string, field: string, firstDirection = 'asc') => {
    const selected = sort.startsWith(`${field}_`), descending = sort.endsWith('_desc');
    return <Table.Th aria-sort={selected ? descending ? 'descending' : 'ascending' : 'none'}><UnstyledButton className={classes.sortHeader} onClick={() => changeQuery({ sort: `${field}_${selected ? descending ? 'asc' : 'desc' : firstDirection}`, page: null })} aria-label={`Sort by ${label}`}>
      {label}{selected ? descending ? <IconArrowDown size={14} /> : <IconArrowUp size={14} /> : <IconArrowsSort size={14} />}
    </UnstyledButton></Table.Th>;
  };
  const recoveryCell = (cart: OngoingCart) => <Stack gap={2} align="center"><Text size="sm">{cart.recoveryCount || 0} emails sent</Text><Text size="xs" c="dimmed">{cart.recoveryOpenedAt ? `Opened ${dateTime(cart.recoveryOpenedAt)}` : cart.recoverySentAt ? `Sent ${dateTime(cart.recoverySentAt)}` : `Due ${dateTime(cart.recoveryDueAt)}`}</Text></Stack>;
  const statusCell = (cart: OngoingCart) => <Badge variant="light" color={cart.recoveryOpenedAt ? 'cyan' : cart.status === 'sending_recovery' ? 'yellow' : 'blue'}>{cart.recoveryOpenedAt ? 'Recovery link opened' : STATUS.find(option => option.value === cart.status)?.label ?? cart.status}</Badge>;
  const activityCell = (cart: OngoingCart) => <Stack gap={2} align="center"><Text size="sm">{dateTime(cart.lastActivityAt)}</Text>{cart.events?.[0] && <Tooltip label={cart.events[0].message} multiline maw={320}><Text size="xs" c={cart.events[0].severity === 'error' ? 'red' : 'dimmed'} lineClamp={2} maw={240}>{cart.events[0].message}</Text></Tooltip>}</Stack>;
  const filterLabel = (key: keyof Filters) => key === 'status' ? STATUS.find(option => option.value === applied[key])?.label : key === 'recovery' ? RECOVERY.find(option => option.value === applied[key])?.label : key === 'productId' ? result?.filters.products.find(option => option.value === applied[key])?.label : key === 'country' ? countryName(applied[key]) : applied[key];
  const total = result?.pagination.total ?? 0;
  const currentPage = result?.pagination.page ?? page;
  const summary = [
    ['Matching carts', result?.summary.total, 'All carts matching your filters, across every page.'],
    ['Checkout started', result?.summary.checkoutStarted, 'Matching carts where the customer reached checkout. They remain unpaid.'],
    ['Recovery emailed', result?.summary.recoverySent, 'Matching carts sent at least one recovery email.'],
    ['Recovery link opened', result?.summary.recoveryOpened, 'Matching carts whose tracked recovery link was opened.'],
  ] as const;
  return <Stack gap="md" aria-label="Ongoing carts browser">
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">{summary.map(([label, value, description]) => <Tooltip key={label} label={description} multiline maw={260}><Paper withBorder radius="md" p="sm" ta="center"><Text size="xs" c="dimmed" fw={600}>{label}</Text><Text size="xl" fw={700}>{loading || !result ? '—' : value?.toLocaleString()}</Text></Paper></Tooltip>)}</SimpleGrid>
    <Paper withBorder radius="md" p="md" component="form" onSubmit={event => { event.preventDefault(); apply(); }}>
      <Stack gap="sm">
        <div className={classes.toolbar}>
          <TextInput label="Search carts" placeholder="Customer, email, phone or cart ID" maxLength={200} leftSection={<IconSearch size={16} />} value={draft.search} onChange={event => update('search', event.currentTarget.value)} />
          <Select label="Status" placeholder="All statuses" clearable data={STATUS} value={draft.status || null} onChange={value => update('status', value)} />
          <Select label="Sort by" data={SORTS} value={sort} allowDeselect={false} onChange={value => changeQuery({ sort: value, page: null })} />
          <Group gap="xs" wrap="nowrap"><Button variant={expanded ? 'light' : 'default'} leftSection={<IconFilter size={16} />} onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="ongoing-cart-filters">Filters{filterCount ? ` (${filterCount})` : ''}</Button><Button type="submit">Apply</Button></Group>
        </div>
        <Collapse in={expanded} id="ongoing-cart-filters">
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="sm" mt="sm">
            <Select label="Product" placeholder="All products" searchable clearable data={result?.filters.products ?? []} value={draft.productId || null} onChange={value => update('productId', value)} />
            <Select label="Recovery" placeholder="All recovery stages" clearable data={RECOVERY} value={draft.recovery || null} onChange={value => update('recovery', value)} />
            <Select label="Customer country" description="Country selected with their phone" placeholder="All countries" searchable clearable data={(result?.filters.countries ?? []).map(code => ({ value: code, label: countryName(code) })).sort((a, b) => a.label.localeCompare(b.label))} value={draft.country || null} onChange={value => update('country', value)} />
            <Select label="Currency" placeholder="All currencies" clearable data={result?.filters.currencies ?? []} value={draft.currency || null} onChange={value => update('currency', value)} />
            <TextInput type="date" label="Experience from" value={draft.experienceFrom} onChange={event => update('experienceFrom', event.currentTarget.value)} />
            <TextInput type="date" label="Experience to" value={draft.experienceTo} onChange={event => update('experienceTo', event.currentTarget.value)} />
            <TextInput type="date" label="Last activity from" value={draft.activityFrom} onChange={event => update('activityFrom', event.currentTarget.value)} />
            <TextInput type="date" label="Last activity to" value={draft.activityTo} onChange={event => update('activityTo', event.currentTarget.value)} />
            <NumberInput label="Minimum amount" placeholder={draft.currency || 'Choose currency first'} disabled={!draft.currency} min={0} decimalScale={2} value={draft.minAmount} onChange={value => update('minAmount', String(value))} />
            <NumberInput label="Maximum amount" placeholder={draft.currency || 'Choose currency first'} disabled={!draft.currency} min={0} decimalScale={2} value={draft.maxAmount} onChange={value => update('maxAmount', String(value))} />
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="sm">Filters combine together. Activity dates use Europe/Warsaw time. Product and experience dates match the same experience within a cart.</Text>
        </Collapse>
        {formError && <Alert color="red">{formError}</Alert>}
        {(filterCount > 0 || pendingFilters) && <Group gap="xs">{FILTERS.filter(key => applied[key]).map(key => <Badge key={key} variant="light" tt="none">{FILTER_LABELS[key]}: {filterLabel(key) ?? applied[key]}</Badge>)}{pendingFilters && <Text size="xs" c="dimmed">Press Apply to update results.</Text>}<Button size="compact-xs" variant="subtle" leftSection={<IconX size={12} />} onClick={() => { setDraft(readFilters(new URLSearchParams())); setFormError(''); reset(); }}>Clear filters</Button></Group>}
      </Stack>
    </Paper>
    <Group justify="space-between" gap="sm"><Text size="sm" c="dimmed" role="status" aria-live="polite">{loading ? 'Loading carts…' : !result ? 'Carts unavailable' : total ? `Showing ${(currentPage - 1) * result.pagination.pageSize + 1}–${Math.min(currentPage * result.pagination.pageSize, total)} of ${total.toLocaleString()} carts` : '0 matching carts'}</Text><Select aria-label="Carts per page" w={120} value={pageSize} data={['10', '25', '50', '100'].map(value => ({ value, label: `${value} per page` }))} allowDeselect={false} onChange={value => changeQuery({ pageSize: value, page: null })} /></Group>
    {error ? <Alert title="Unable to load ongoing carts" color="red">{error}<Button variant="subtle" size="xs" onClick={() => setRetry(value => value + 1)}>Try again</Button></Alert> : loading ? <Box mih={200} style={{ display: 'grid', placeItems: 'center' }} aria-label="Loading ongoing carts"><Loader /></Box> : !total ? <Paper withBorder radius="md" p="xl" ta="center"><Text fw={600}>{filterCount ? 'No carts match these filters' : 'No ongoing carts'}</Text><Text size="sm" c="dimmed">{filterCount ? 'Adjust or clear the filters to see more carts.' : 'Customer carts awaiting payment will appear here.'}</Text></Paper> : isMobile ? <Stack gap="sm">{result?.data.map(cart => <Paper key={cart.publicId} withBorder radius="md" p="md" ta="center"><Stack gap="sm">{renderCustomer(cart)}<Group justify="center">{statusCell(cart)}<Text fw={700}>{money(cart)}</Text></Group>{renderExperiences(cart)}{recoveryCell(cart)}<Text size="xs" c="dimmed">Last activity</Text>{activityCell(cart)}{renderActions(cart)}</Stack></Paper>)}</Stack> : <Paper withBorder radius="md" style={{ overflowX: 'auto' }}><Table className={classes.table} horizontalSpacing="sm" verticalSpacing="sm" striped highlightOnHover miw={1000}>
      <Table.Thead><Table.Tr>{sortHeader('Customer', 'customer')}{sortHeader('Experiences', 'experience')}<Table.Th>Status</Table.Th>{sortHeader('Total', 'amount', 'desc')}{sortHeader('Recovery', 'recovery', 'desc')}{sortHeader('Last activity', 'activity', 'desc')}<Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{result?.data.map(cart => <Table.Tr key={cart.publicId}><Table.Td>{renderCustomer(cart)}</Table.Td><Table.Td>{renderExperiences(cart)}</Table.Td><Table.Td>{statusCell(cart)}</Table.Td><Table.Td><Text fw={700} style={{ whiteSpace: 'nowrap' }}>{money(cart)}</Text></Table.Td><Table.Td>{recoveryCell(cart)}</Table.Td><Table.Td>{activityCell(cart)}</Table.Td><Table.Td>{renderActions(cart)}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></Paper>}
    {result && !loading && !error && <Group justify="center"><Pagination total={result.pagination.totalPages} value={currentPage} onChange={value => changeQuery({ page: String(value) })} siblings={isMobile ? 0 : 1} withEdges size={isMobile ? 'sm' : 'md'} getControlProps={control => ({ 'aria-label': `${control[0].toUpperCase()}${control.slice(1)} page` })} getItemProps={value => ({ 'aria-label': `Page ${value}` })} /></Group>}
    <Text size="xs" c="dimmed" ta="center">Counts cover all matching carts, not just this page. A cart can appear in more than one summary count. Amount sorting groups currencies; experience sorting uses the earliest experience in each cart.</Text>
  </Stack>;
}
