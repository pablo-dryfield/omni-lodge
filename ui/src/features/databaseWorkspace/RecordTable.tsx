import { useMemo } from 'react';
import { Code, Text } from '@mantine/core';
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef,
} from 'mantine-react-table';
export const displayValue = (v: unknown): string =>
  v === null
    ? 'NULL'
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v ?? '');
export function RecordTable({
  rows,
  label = 'Records',
  actions,
}: {
  rows: Record<string, unknown>[];
  label?: string;
  actions?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  const keys = useMemo(() => [...new Set(rows.flatMap(Object.keys))], [rows]);
  const columns = useMemo<MRT_ColumnDef<Record<string, unknown>>[]>(
    () =>
      keys.map((key) => ({
        accessorFn: (row) => displayValue(row[key]),
        id: key,
        header: key.replace(/_/g, ' '),
        size: key === 'query' || key === 'definition' ? 380 : 160,
        Cell: ({ cell }) =>
          key === 'query' || key === 'definition' ? (
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 140,
                overflow: 'auto',
              }}
            >
              {cell.getValue<string>()}
            </Code>
          ) : (
            <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
              {cell.getValue<string>()}
            </Text>
          ),
      })),
    [keys],
  );
  const table = useMantineReactTable({
    columns,
    data: rows,
    enableColumnResizing: true,
    enableColumnPinning: true,
    enableDensityToggle: true,
    enableFullScreenToggle: false,
    enableRowVirtualization: false,
    enableRowActions: Boolean(actions),
    renderRowActions: ({ row }) => actions?.(row.original),
    initialState: { density: 'xs', pagination: { pageIndex: 0, pageSize: 20 } },
    mantineTableContainerProps: { style: { maxHeight: 500 } },
    mantineTableProps: { 'aria-label': label },
    renderEmptyRowsFallback: () => (
      <Text p="lg" c="dimmed" size="sm">
        No records in this snapshot.
      </Text>
    ),
  });
  return <MantineReactTable table={table} />;
}
