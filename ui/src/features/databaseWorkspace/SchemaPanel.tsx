import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Code,
  Group,
  MultiSelect,
  Select,
  Slider,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import { api, message, type Capabilities, type Document } from './api';
import { RecordTable } from './RecordTable';
import { downloadBookingBlob } from '../../utils/bookingTableExport';

type Node = {
  id: string;
  schema: string;
  name: string;
  columns: { name: string; type: string; notNull: boolean }[];
};
type Edge = {
  id: string;
  name: string;
  source: string;
  target: string;
  source_columns: string[];
  target_columns: string[];
  definition: string;
};
type Snapshot = {
  hash: string;
  measuredAt: string;
  nodes: Node[];
  edges: Edge[];
  warnings: string[];
  objects: {
    key: string;
    family: string;
    definition: string;
    dependencies: string[];
  }[];
};
type Comparison = {
  sourceHash: string;
  targetHash: string;
  unresolved: number;
  changes: Record<string, unknown>[];
  sql: string;
  warnings: string[];
};
type Position = { x: number; y: number };
export function SchemaPanel({
  targetId,
  capabilities,
  onScript,
}: {
  targetId: string;
  capabilities: Capabilities;
  onScript: (sql: string) => void;
}) {
  const snapshot = useQuery<Snapshot>({
    queryKey: ['dw-schema', targetId],
    queryFn: () => api.schema(targetId),
    retry: false,
  });
  const [selected, setSelected] = useState<string[]>([]),
    [positions, setPositions] = useState<Record<string, Position>>({}),
    [zoom, setZoom] = useState(100),
    [error, setError] = useState(''),
    [layout, setLayout] = useState<Document>(),
    [source, setSource] = useState(targetId),
    [destination, setDestination] = useState(targetId),
    [drops, setDrops] = useState(false),
    [comparison, setComparison] = useState<Comparison>(),
    [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      id: string;
      clientX: number;
      clientY: number;
      position: Position;
    }>();
  useEffect(() => {
    setSelected([]);
    setPositions({});
    setLayout(undefined);
    void api
      .documents('layout')
      .then((docs) => {
        const saved = docs.find((d) => d.value.scope === `erd:${targetId}`);
        if (saved) {
          setLayout(saved);
          setSelected((saved.value.selected as string[]) || []);
          setPositions(
            (saved.value.positions as Record<string, Position>) || {},
          );
        }
      })
      .catch(() => {});
  }, [targetId]);
  const nodes = useMemo(() => {
    const all = snapshot.data?.nodes || [];
    return all.filter((n) =>
      (selected.length ? selected : all.slice(0, 12).map((x) => x.id)).includes(
        n.id,
      ),
    );
  }, [selected, snapshot.data]);
  const position = (n: Node, i: number) =>
    positions[n.id] || {
      x: 24 + (i % 3) * 340,
      y: 24 + Math.floor(i / 3) * 250,
    };
  const points = new Map(nodes.map((n, i) => [n.id, position(n, i)])),
    width = Math.max(1050, ...[...points.values()].map((p) => p.x + 300)),
    height = Math.max(300, ...[...points.values()].map((p) => p.y + 225));
  async function save() {
    setError('');
    try {
      setLayout(
        await api.saveDocument({
          id: layout?.id,
          revision: layout?.revision,
          kind: 'layout',
          value: { scope: `erd:${targetId}`, positions, selected },
        }),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function exportGraph(format: 'svg' | 'png' | 'pdf') {
    if (!svg.current) return;
    setError('');
    try {
      const serialized = new XMLSerializer().serializeToString(svg.current),
        blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
      if (format === 'svg') {
        downloadBookingBlob(blob, 'database-relationships.svg');
        return;
      }
      if (width > 5000 || height > 5000)
        throw new Error(
          'Choose fewer tables or compact the layout before exporting an image. SVG preserves the full graph.',
        );
      const image = new Image(),
        url = URL.createObjectURL(blob);
      try {
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0);
        if (format === 'png') {
          const png = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((v) =>
              v ? resolve(v) : reject(new Error('Image export failed.')),
            ),
          );
          downloadBookingBlob(png, 'database-relationships.png');
        } else {
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({
            orientation: width > height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [width, height],
          });
          pdf.addImage(
            canvas.toDataURL('image/png'),
            'PNG',
            0,
            0,
            width,
            height,
          );
          pdf.save('database-relationships.pdf');
        }
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function compare() {
    setBusy(true);
    setError('');
    try {
      setComparison(
        await api.compareSchemas({
          sourceId: source,
          targetId: destination,
          includeDrops: drops,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      {(error || snapshot.error) && (
        <Alert color="red">{error || message(snapshot.error)}</Alert>
      )}
      <Tabs defaultValue="erd">
        <Tabs.List>
          <Tabs.Tab value="erd">Relationships</Tabs.Tab>
          <Tabs.Tab value="definitions">Definitions</Tabs.Tab>
          <Tabs.Tab value="compare">Compare schemas</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="erd" pt="sm">
          <Stack>
            <Text size="xs" c="dimmed">
              Actual foreign-key constraints only. The arrow points to the
              referenced table; uniqueness and nullability determine
              one-to-one/optional relationships. Drag tables or use arrow keys
              on a focused table. Snapshot {snapshot.data?.measuredAt}.
            </Text>
            <MultiSelect
              searchable
              clearable
              label="Tables in the diagram"
              placeholder="First 12 tables by default"
              value={selected}
              onChange={setSelected}
              data={(snapshot.data?.nodes || []).map((n) => ({
                value: n.id,
                label: `${n.schema}.${n.name}`,
              }))}
              maxValues={80}
            />
            <Group>
              <Text size="xs">Zoom</Text>
              <Slider
                w={130}
                min={40}
                max={150}
                value={zoom}
                onChange={setZoom}
                aria-label="Diagram zoom"
              />
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setPositions({});
                  setZoom(100);
                }}
              >
                Auto layout
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => void save()}
              >
                Save layout
              </Button>
              {(['svg', 'png', 'pdf'] as const).map((f) => (
                <Button
                  key={f}
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => void exportGraph(f)}
                >
                  {f.toUpperCase()}
                </Button>
              ))}
            </Group>
            <div
              style={{
                overflow: 'auto',
                maxHeight: 620,
                border: '1px solid var(--dw-border)',
                borderRadius: 7,
                background: '#f7f9fc',
              }}
            >
              <div
                style={{
                  width: (width * zoom) / 100,
                  height: (height * zoom) / 100,
                }}
              >
                <svg
                  ref={svg}
                  xmlns="http://www.w3.org/2000/svg"
                  width={width}
                  height={height}
                  viewBox={`0 0 ${width} ${height}`}
                  style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top left',
                    touchAction: 'none',
                    background: '#f7f9fc',
                  }}
                  role="img"
                  aria-label="Database foreign-key relationship diagram"
                >
                  <defs>
                    <marker
                      id="dw-erd-arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 Z" fill="#5982af" />
                    </marker>
                  </defs>
                  {(snapshot.data?.edges || [])
                    .filter((e) => points.has(e.source) && points.has(e.target))
                    .map((e) => {
                      const from = points.get(e.source)!,
                        to = points.get(e.target)!;
                      return (
                        <g key={e.id}>
                          <title>
                            {e.name}: {e.source_columns.join(', ')} →{' '}
                            {e.target_columns.join(', ')}
                          </title>
                          <path
                            d={`M${from.x + 270},${from.y + 40} C${from.x + 315},${from.y + 40} ${to.x - 40},${to.y + 40} ${to.x},${to.y + 40}`}
                            stroke="#5982af"
                            fill="none"
                            markerEnd="url(#dw-erd-arrow)"
                          />
                        </g>
                      );
                    })}
                  {nodes.map((n, i) => {
                    const p = position(n, i);
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${p.x} ${p.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Move ${n.schema}.${n.name}`}
                        onKeyDown={(e) => {
                          const delta: Record<string, Position> = {
                            ArrowLeft: { x: -20, y: 0 },
                            ArrowRight: { x: 20, y: 0 },
                            ArrowUp: { x: 0, y: -20 },
                            ArrowDown: { x: 0, y: 20 },
                          };
                          if (delta[e.key]) {
                            e.preventDefault();
                            setPositions((previous) => ({
                              ...previous,
                              [n.id]: {
                                x: Math.max(0, p.x + delta[e.key].x),
                                y: Math.max(0, p.y + delta[e.key].y),
                              },
                            }));
                          }
                        }}
                        onPointerDown={(e) => {
                          drag.current = {
                            id: n.id,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            position: p,
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          const d = drag.current;
                          if (d?.id === n.id)
                            setPositions((previous) => ({
                              ...previous,
                              [n.id]: {
                                x: Math.max(
                                  0,
                                  Math.min(
                                    4600,
                                    d.position.x +
                                      ((e.clientX - d.clientX) * 100) / zoom,
                                  ),
                                ),
                                y: Math.max(
                                  0,
                                  Math.min(
                                    4600,
                                    d.position.y +
                                      ((e.clientY - d.clientY) * 100) / zoom,
                                  ),
                                ),
                              },
                            }));
                        }}
                        onPointerUp={() => {
                          drag.current = undefined;
                        }}
                      >
                        <rect
                          width={270}
                          height={215}
                          rx={8}
                          fill="#fff"
                          stroke="#b7c7db"
                        />
                        <rect width={270} height={33} rx={8} fill="#e6effb" />
                        <text
                          x={12}
                          y={22}
                          fontFamily="sans-serif"
                          fontSize={12}
                          fontWeight={600}
                          fill="#163859"
                        >
                          {n.schema}.{n.name}
                        </text>
                        {(n.columns || []).slice(0, 8).map((c, j) => (
                          <text
                            key={c.name}
                            x={12}
                            y={53 + j * 19}
                            fontFamily="sans-serif"
                            fontSize={11}
                            fill="#34465c"
                          >
                            {c.name} · {c.type}
                            {c.notNull ? ' *' : ''}
                          </text>
                        ))}
                        {n.columns?.length > 8 && (
                          <text
                            x={12}
                            y={208}
                            fontFamily="sans-serif"
                            fontSize={10}
                            fill="#64748b"
                          >
                            +{n.columns.length - 8} columns
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
            <details>
              <summary>Accessible relationship list</summary>
              <RecordTable
                rows={
                  (snapshot.data?.edges || []) as unknown as Record<
                    string,
                    unknown
                  >[]
                }
                label="Foreign-key constraints"
              />
            </details>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="definitions" pt="sm">
          <RecordTable
            rows={
              (snapshot.data?.objects || []) as unknown as Record<
                string,
                unknown
              >[]
            }
            label="Schema definitions"
          />
        </Tabs.Panel>
        <Tabs.Panel value="compare" pt="sm">
          <Stack>
            <Group grow>
              <Select
                label="Desired source schema"
                value={source}
                onChange={(v) => setSource(v || targetId)}
                data={capabilities.targets.map((t) => ({
                  value: t.id,
                  label: t.label,
                }))}
              />
              <Select
                label="Destination schema"
                value={destination}
                onChange={(v) => setDestination(v || targetId)}
                data={capabilities.targets.map((t) => ({
                  value: t.id,
                  label: t.label,
                }))}
              />
            </Group>
            <Checkbox
              label="Include explicit destructive drop statements"
              checked={drops}
              onChange={(e) => setDrops(e.currentTarget.checked)}
            />
            <Button loading={busy} onClick={() => void compare()}>
              Compare snapshots
            </Button>
            {comparison && (
              <>
                <Alert color={comparison.unresolved ? 'orange' : 'blue'}>
                  {comparison.changes.length} differences ·{' '}
                  {comparison.unresolved} require manual resolution. Renames are
                  never guessed. This comparison has not changed a database.
                </Alert>
                <RecordTable
                  rows={comparison.changes}
                  label="Schema differences"
                />
                <Code
                  block
                  style={{
                    maxHeight: 300,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {comparison.sql || '-- No supported-definition differences.'}
                </Code>
                {comparison.warnings.map((w) => (
                  <Text key={w} size="xs" c="dimmed">
                    {w}
                  </Text>
                ))}
                <Button
                  variant="light"
                  onClick={() => onScript(comparison.sql)}
                >
                  Use script in schema editor
                </Button>
                <Button
                  variant="default"
                  onClick={() =>
                    downloadBookingBlob(
                      new Blob([comparison.sql], {
                        type: 'text/plain;charset=utf-8',
                      }),
                      'schema-comparison.sql',
                    )
                  }
                >
                  Download reviewed draft SQL
                </Button>
              </>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
