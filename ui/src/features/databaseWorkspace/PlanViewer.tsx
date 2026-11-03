import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import { api, message, type Job } from './api';
import { RecordTable } from './RecordTable';
type Node = Record<string, unknown> & { Plans?: Node[] };
export function flattenPlan(
  root: Node,
  depth = 0,
  path = '0',
): Array<{ node: Node; depth: number; path: string }> {
  return [
    { node: root, depth, path },
    ...(root.Plans || []).flatMap((n, i) =>
      flattenPlan(n, depth + 1, `${path}.${i}`),
    ),
  ].slice(0, 500);
}
function parsePlan(raw: unknown): Record<string, unknown> {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const plan = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!plan || typeof plan !== 'object' || !plan.Plan)
    throw new Error('Use PostgreSQL EXPLAIN (FORMAT JSON) output.');
  return plan;
}
export function PlanViewer({ job, index }: { job: Job; index: number }) {
  const result = useQuery({
    queryKey: ['dw-plan', job.id, index],
    queryFn: () => api.result(job.id, index, { page: 0, pageSize: 1 }),
    retry: false,
  });
  const saved = useQuery({
    queryKey: ['dw-plan-library'],
    queryFn: () => api.documents('query'),
    retry: false,
  });
  const [inspect, setInspect] = useState<Node>(),
    [baseline, setBaseline] = useState(''),
    [paste, setPaste] = useState(''),
    [error, setError] = useState('');
  const parsed = useMemo(() => {
    try {
      return { plan: parsePlan(result.data?.rows[0]?.[0]) };
    } catch (e) {
      return { error: message(e) };
    }
  }, [result.data]);
  const plan = parsed.plan,
    root = plan?.Plan as Node | undefined,
    nodes = useMemo(() => (root ? flattenPlan(root) : []), [root]);
  const compare = useMemo(() => {
    try {
      return baseline === 'paste' && paste
        ? parsePlan(paste)
        : (saved.data?.find((d) => d.id === baseline)?.value.plan as
            | Record<string, unknown>
            | undefined);
    } catch {
      return undefined;
    }
  }, [baseline, paste, saved.data]);
  if (result.error || (!result.isLoading && parsed.error))
    return (
      <Alert color="red">
        {result.error ? message(result.error) : parsed.error}
      </Alert>
    );
  if (!root)
    return (
      <Text p="md" size="sm">
        Loading query plan…
      </Text>
    );
  function tree(node: Node, path: string, depth = 0): React.ReactNode {
    return (
      <details
        key={path}
        open={depth < 2}
        style={{
          marginLeft: depth ? 18 : 0,
          padding: 5,
          borderLeft: '2px solid var(--dw-border)',
        }}
      >
        <summary>
          <button
            className="dw-nav"
            style={{ display: 'inline-flex' }}
            onClick={() => setInspect(node)}
          >
            {String(node['Node Type'])}
            {node['Relation Name'] ? ` · ${node['Relation Name']}` : ''}
            <Badge size="xs" variant="light">
              cost {String(node['Total Cost'] ?? '—')}
            </Badge>
          </button>
        </summary>
        <Text size="xs" c="dimmed" ml="md">
          Estimated rows {String(node['Plan Rows'] ?? '—')} · actual rows/loop{' '}
          {String(node['Actual Rows'] ?? 'not executed')} · loops{' '}
          {String(node['Actual Loops'] ?? '—')}
        </Text>
        {(node.Plans || []).map((n, i) => tree(n, `${path}.${i}`, depth + 1))}
      </details>
    );
  }
  return (
    <Stack p="md">
      <Group justify="space-between">
        <Group>
          <Badge variant="light">
            {root['Actual Rows'] === undefined
              ? 'Estimated plan'
              : 'Executed plan'}
          </Badge>
          <Text size="xs">
            Planning {String(plan?.['Planning Time'] ?? '—')} ms · execution{' '}
            {String(plan?.['Execution Time'] ?? '—')} ms
          </Text>
        </Group>
        <Button
          size="compact-xs"
          variant="light"
          onClick={() =>
            void api
              .saveDocument({
                kind: 'query',
                value: {
                  title: `Plan · ${new Date().toLocaleString()}`,
                  sql: job.outcomes[index].sql,
                  targetId: job.targetId,
                  plan,
                  folder: 'Query plans',
                },
              })
              .then(() => saved.refetch())
              .catch((e) => setError(message(e)))
          }
        >
          Save plan snapshot
        </Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <Text size="xs" c="dimmed">
        Costs are planner units. Node times include child work and are measured
        per loop; adding them double-counts time. A sequential scan can be the
        best plan.
      </Text>
      <Tabs defaultValue="tree">
        <Tabs.List>
          <Tabs.Tab value="tree">Plan tree</Tabs.Tab>
          <Tabs.Tab value="graph">Graph</Tabs.Tab>
          <Tabs.Tab value="nodes">Node table</Tabs.Tab>
          <Tabs.Tab value="compare">Compare</Tabs.Tab>
          <Tabs.Tab value="json">JSON</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="tree" pt="sm">
          {tree(root, '0')}
        </Tabs.Panel>
        <Tabs.Panel value="graph" pt="sm">
          <div style={{ overflow: 'auto', maxHeight: 600 }}>
            <svg
              role="img"
              aria-label="Query plan graph; the Plan tree and Node table provide accessible alternatives"
              width={Math.max(600, ...nodes.map((n) => n.depth * 90 + 440))}
              height={nodes.length * 70 + 20}
            >
              {nodes.map(({ node, depth, path }, i) => {
                const x = depth * 90 + 12,
                  y = i * 70 + 8,
                  parent = nodes.findIndex(
                    (n) => n.path === path.slice(0, path.lastIndexOf('.')),
                  );
                return (
                  <g key={path}>
                    {parent >= 0 && (
                      <path
                        d={`M${nodes[parent].depth * 90 + 25},${parent * 70 + 53} V${y + 22} H${x}`}
                        fill="none"
                        stroke="#8796aa"
                      />
                    )}
                    <g
                      role="button"
                      tabIndex={0}
                      onClick={() => setInspect(node)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setInspect(node);
                      }}
                      aria-label={`Inspect ${node['Node Type']}`}
                    >
                      <rect
                        x={x}
                        y={y}
                        width={330}
                        height={52}
                        rx={7}
                        fill="var(--dw-soft)"
                        stroke="var(--dw-border)"
                      />
                      <text
                        x={x + 12}
                        y={y + 20}
                        fill="var(--dw-text)"
                        fontSize={12}
                      >
                        {String(node['Node Type'])}{' '}
                        {String(node['Relation Name'] || '')}
                      </text>
                      <text
                        x={x + 12}
                        y={y + 38}
                        fill="var(--dw-muted)"
                        fontSize={11}
                      >
                        cost {String(node['Total Cost'])} · rows{' '}
                        {String(node['Plan Rows'])}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="nodes" pt="sm">
          <RecordTable
            rows={nodes.map(({ node, depth, path }) => ({
              path,
              depth,
              ...Object.fromEntries(
                Object.entries(node).filter(([k]) => k !== 'Plans'),
              ),
            }))}
            label="Query plan nodes"
          />
        </Tabs.Panel>
        <Tabs.Panel value="json" pt="sm">
          <Code block style={{ maxHeight: 500, overflow: 'auto' }}>
            {JSON.stringify(plan, null, 2)}
          </Code>
        </Tabs.Panel>
        <Tabs.Panel value="compare" pt="sm">
          <Stack>
            <Select
              label="Baseline plan"
              value={baseline || null}
              onChange={(v) => setBaseline(v || '')}
              data={[
                { value: 'paste', label: 'Paste JSON plan' },
                ...(saved.data || [])
                  .filter((d) => d.value.plan)
                  .map((d) => ({ value: d.id, label: String(d.value.title) })),
              ]}
            />
            {baseline === 'paste' && (
              <Textarea
                label="Baseline JSON"
                value={paste}
                onChange={(e) => setPaste(e.currentTarget.value)}
                minRows={6}
              />
            )}
            <Alert color="blue">
              Compare matching SQL, parameters, database version and settings.
              Statistics and data changes can affect plans; these snapshots do
              not prove a performance regression.
            </Alert>
            {compare && (
              <RecordTable
                rows={[
                  'Planning Time',
                  'Execution Time',
                  ...['Total Cost', 'Plan Rows'].map((k) => `Plan.${k}`),
                ].map((metric) => {
                  const value = (p: Record<string, unknown>) =>
                    metric.startsWith('Plan.')
                      ? (p.Plan as Node)?.[metric.slice(5)]
                      : p[metric];
                  return {
                    metric,
                    baseline: value(compare),
                    current: value(plan!),
                    difference:
                      typeof value(plan!) === 'number' &&
                      typeof value(compare) === 'number'
                        ? Number(value(plan!)) - Number(value(compare))
                        : 'not comparable',
                  };
                })}
              />
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Drawer
        opened={Boolean(inspect)}
        onClose={() => setInspect(undefined)}
        title={String(inspect?.['Node Type'] || 'Plan node')}
        position="right"
        size="lg"
      >
        <RecordTable
          rows={Object.entries(inspect || {})
            .filter(([k]) => k !== 'Plans')
            .map(([property, value]) => ({ property, value }))}
        />
        {inspect &&
          Number(inspect['Actual Rows']) >
            Number(inspect['Plan Rows']) * 10 && (
            <Alert color="orange" mt="md">
              Actual rows per loop exceed the estimate by more than 10×.
              Consider statistics freshness and predicate correlation; this is a
              diagnostic, not an automatic index recommendation.
            </Alert>
          )}
      </Drawer>
    </Stack>
  );
}
