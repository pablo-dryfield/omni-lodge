import { useState } from 'react';
import { Alert, Button, Group, Menu, Select, Stack, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconChevronDown, IconCopy, IconDownload, IconFileSpreadsheet, IconFileTypeCsv, IconFileTypePdf, IconPhoto } from '@tabler/icons-react';
import type { MRT_TableInstance } from 'mantine-react-table';
import type { RevenueBookingRow } from './RevenueBookingsTable';
import { buildBookingExport, copyBookingExportImage, downloadBookingExport, type BookingExportFormat, type BookingExportScope } from '../../utils/bookingTableExport';

const filterText = (value: unknown): string => {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (Array.isArray(value)) return value.map(filterText).join(' to ');
  return String(value ?? '');
};

const BookingTableExportControls = ({ table }: { table: MRT_TableInstance<RevenueBookingRow> }) => {
  const [scope, setScope] = useState<BookingExportScope>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const matching = table.getPrePaginationRowModel().rows;
  const page = table.getRowModel().rows;
  const selectedRows = scope === 'all' ? matching : page;
  const visibleColumns = table.getVisibleLeafColumns().filter(column => !!column.accessorFn);
  const disabled = !selectedRows.length || !visibleColumns.length || !!busy;

  const run = async (format: BookingExportFormat | 'copy') => {
    // Capture the exact scope, sort, filters and visibility at click time.
    const state = table.getState();
    const filters = state.columnFilters.map(filter => {
      const column = table.getColumn(filter.id);
      return `${column.columnDef.header} (${state.columnFilterFns[filter.id]}): ${column.getIsVisible() ? filterText(filter.value) : 'applied to a hidden column'}`;
    });
    const sorting = state.sorting.map(sort => `${table.getColumn(sort.id).columnDef.header} ${sort.desc ? 'descending' : 'ascending'}`);
    const model = buildBookingExport(selectedRows.map(row => row.original), visibleColumns.map(column => ({
      id: column.id, label: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
      width: Math.max(110, Math.min(260, column.getSize())),
    })), [
      `${scope === 'all' ? 'All matching bookings' : 'Current page'} · ${selectedRows.length} of ${matching.length} matching · ${table.options.data.length} in selected Summary scope`,
      // Search text can contain a hidden email/ID: describe its presence without exposing it.
      ...(state.globalFilter ? ['Global search applied'] : []),
      ...filters.map(filter => `Filter: ${filter}`),
      ...(sorting.length ? [`Sorted by: ${sorting.join(', ')}`] : []),
    ]);
    setBusy(format); setNotice(null);
    try {
      if (format === 'copy') {
        const result = await copyBookingExportImage(model);
        setNotice({ error: false, message: result === 'copied' ? 'Image copied to clipboard. You can paste it into your message.' : 'Clipboard access was unavailable. Your PNG was downloaded instead.' });
      } else {
        await downloadBookingExport(model, format);
        setNotice({ error: false, message: `${format.toUpperCase()} download prepared with ${model.rows.length.toLocaleString()} ${model.rows.length === 1 ? 'booking' : 'bookings'}.` });
      }
    } catch (error) {
      setNotice({ error: true, message: error instanceof Error ? error.message : 'Could not export bookings. Please try again.' });
    } finally { setBusy(null); }
  };

  return <Stack gap="xs" mb="sm" p="sm" style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 'var(--mantine-radius-md)' }}>
    <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
      <Select label="Rows to share or download" aria-label="Export row scope" value={scope}
        onChange={value => setScope(value === 'page' ? 'page' : 'all')} disabled={!!busy}
        allowDeselect={false} style={{ flex: '1 1 250px', maxWidth: 380 }} data={[
          { value: 'all', label: 'All matching bookings' },
          { value: 'page', label: 'Current page' },
        ]} />
      <Group gap="xs" wrap="wrap">
        <Tooltip label="Copy a PNG image to your clipboard" withArrow><Button variant="light" leftSection={<IconCopy size={16} />} disabled={disabled} loading={busy === 'copy'} onClick={() => void run('copy')}>Share image</Button></Tooltip>
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target><Button leftSection={<IconDownload size={16} />} rightSection={<IconChevronDown size={14} />} disabled={disabled} loading={!!busy && busy !== 'copy'}>Download</Button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>{`${selectedRows.length.toLocaleString()} rows · ${visibleColumns.length} visible columns`}</Menu.Label>
            <Menu.Item leftSection={<IconFileSpreadsheet size={18} />} onClick={() => void run('xlsx')}>Excel workbook (.xlsx)</Menu.Item>
            <Menu.Item leftSection={<IconFileTypePdf size={18} />} onClick={() => void run('pdf')}>PDF report (.pdf)</Menu.Item>
            <Menu.Item leftSection={<IconPhoto size={18} />} onClick={() => void run('png')}>Image (.png)</Menu.Item>
            <Menu.Item leftSection={<IconFileTypeCsv size={18} />} onClick={() => void run('csv')}>CSV spreadsheet (.csv)</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
    <Text size="xs" c="dimmed">{`${selectedRows.length.toLocaleString()} ${selectedRows.length === 1 ? 'booking' : 'bookings'} · ${visibleColumns.length} visible columns. Current filters and sorting apply. All matching bookings includes every page in the selected Summary scope.`}</Text>
    {notice && <Alert color={notice.error ? 'red' : 'teal'} title={notice.error ? 'Export unavailable' : 'Ready'}
      icon={notice.error ? undefined : <IconCheck size={16} />} withCloseButton onClose={() => setNotice(null)} role={notice.error ? 'alert' : 'status'}>{notice.message}</Alert>}
  </Stack>;
};

export default BookingTableExportControls;
