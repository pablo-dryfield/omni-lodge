import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
  Select,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { ParameterDefinition } from './api';
export function ParameterForm({
  value,
  onChange,
  definitions = [],
  onDefinitionsChange,
}: {
  value: string;
  onChange: (value: string) => void;
  definitions?: ParameterDefinition[];
  onDefinitionsChange?: (value: ParameterDefinition[]) => void;
}) {
  let values: (string | null)[];
  try {
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((v) => v !== null && typeof v !== 'string')
    )
      throw Error();
    values = parsed;
  } catch {
    return (
      <Textarea
        label="Bound parameters — JSON array of exact strings or null"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    );
  }
  const update = (index: number, next: string | null) =>
    onChange(JSON.stringify(values.map((v, i) => (i === index ? next : v))));
  const definition = (i: number): ParameterDefinition =>
    definitions[i] || {
      name: `Parameter ${i + 1}`,
      type: 'text',
      required: false,
      sensitive: false,
    };
  const describe = (i: number, patch: Partial<ParameterDefinition>) =>
    onDefinitionsChange?.(
      values.map((_, index) =>
        index === i ? { ...definition(index), ...patch } : definition(index),
      ),
    );
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Bound PostgreSQL parameters preserve exact text and SQL NULL. Values are
        private to this tab and are not included when saving or sharing a query.
      </Text>
      {values.map((v, i) => (
        <Stack key={i} gap={4}>
          <Group align="end" gap="sm">
            <Textarea
              size="xs"
              label={`$${i + 1} · ${definition(i).name} (${definition(i).type})${definition(i).required ? ' · required' : ''}${definition(i).sensitive ? ' · sensitive' : ''}`}
              aria-label={`Parameter $${i + 1}`}
              value={v ?? ''}
              disabled={v === null}
              onChange={(e) => update(i, e.currentTarget.value)}
              autosize
              minRows={1}
              maxRows={5}
              style={{ flex: 1 }}
            />
            <Checkbox
              label="SQL NULL"
              size="xs"
              mb={7}
              checked={v === null}
              onChange={(e) => update(i, e.currentTarget.checked ? null : '')}
            />
            {i === values.length - 1 && (
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove parameter $${i + 1}`}
                onClick={() => {
                  onChange(JSON.stringify(values.slice(0, -1)));
                  onDefinitionsChange?.(
                    definitions.slice(0, values.length - 1),
                  );
                }}
              >
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
          {onDefinitionsChange && (
            <details>
              <summary style={{ fontSize: 12 }}>
                Parameter metadata saved with this query
              </summary>
              <Stack gap="xs" mt="xs">
                <Group grow>
                  <TextInput
                    size="xs"
                    label="Name"
                    maxLength={80}
                    value={definition(i).name}
                    onChange={(e) =>
                      describe(i, { name: e.currentTarget.value })
                    }
                  />
                  <Select
                    size="xs"
                    label="PostgreSQL type"
                    data={[
                      'text',
                      'integer',
                      'bigint',
                      'numeric',
                      'boolean',
                      'date',
                      'timestamp',
                      'timestamptz',
                      'uuid',
                      'jsonb',
                    ]}
                    value={definition(i).type}
                    onChange={(v) => describe(i, { type: v || 'text' })}
                  />
                </Group>
                <Group>
                  <Checkbox
                    size="xs"
                    label="Required"
                    checked={definition(i).required}
                    onChange={(e) =>
                      describe(i, { required: e.currentTarget.checked })
                    }
                  />
                  <Checkbox
                    size="xs"
                    label="Sensitive"
                    checked={definition(i).sensitive}
                    onChange={(e) =>
                      describe(i, {
                        sensitive: e.currentTarget.checked,
                        defaultValue: undefined,
                      })
                    }
                  />
                </Group>
                {!definition(i).sensitive && (
                  <TextInput
                    size="xs"
                    label="Reusable default (optional; never copies the current value)"
                    value={definition(i).defaultValue || ''}
                    onChange={(e) =>
                      describe(i, {
                        defaultValue: e.currentTarget.value || undefined,
                      })
                    }
                  />
                )}
              </Stack>
            </details>
          )}
        </Stack>
      ))}
      <Button
        size="compact-xs"
        variant="light"
        disabled={values.length >= 100}
        onClick={() => onChange(JSON.stringify([...values, '']))}
      >
        Add bound parameter
      </Button>
    </Stack>
  );
}
