import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
export function ParameterForm({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
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
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Bound PostgreSQL parameters preserve exact text and SQL NULL. Values are
        private to this tab and are not included when saving or sharing a query.
      </Text>
      {values.map((v, i) => (
        <Group key={i} align="end" gap="sm">
          <Textarea
            size="xs"
            label={`$${i + 1}`}
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
              onClick={() => onChange(JSON.stringify(values.slice(0, -1)))}
            >
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
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
