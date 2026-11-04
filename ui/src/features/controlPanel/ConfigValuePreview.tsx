import { Badge, Code, Group, Stack, Text } from '@mantine/core';
import type { ConfigEntry } from '../../api/config';
export function ConfigValuePreview({ entry }: { entry: ConfigEntry }) {
  const source = entry.isCleared
    ? 'Cleared'
    : entry.isSecret
      ? entry.isSet
        ? 'Configured'
        : 'Not set'
      : entry.value != null
        ? 'Configured'
        : entry.defaultValue != null
          ? 'Default'
          : 'Not set';
  let value = entry.value ?? entry.defaultValue;
  if (entry.isCleared) value = 'Fallback disabled';
  else if (entry.isSecret) value = entry.isSet ? '••••••••' : 'Not set';
  else if (entry.valueType === 'json' && value != null) {
    try {
      const parsed = JSON.parse(value);
      value = Array.isArray(parsed)
        ? `${parsed.length} list items`
        : parsed !== null && typeof parsed === 'object'
          ? `${Object.keys(parsed).length} fields · ${Object.keys(parsed).slice(0, 4).join(', ')}${Object.keys(parsed).length > 4 ? '…' : ''}`
          : String(parsed);
    } catch {
      value = 'Invalid stored JSON';
    }
  }
  return (
    <Stack gap={5}>
      <Group gap={5}>
        <Badge
          size="xs"
          variant="light"
          color={entry.isCleared ? 'orange' : entry.isSet ? 'teal' : 'gray'}
        >
          {source}
        </Badge>
        <Badge size="xs" variant="outline" color="gray">
          {entry.valueType}
        </Badge>
        {entry.isSecret && (
          <Badge size="xs" color="violet" variant="light">
            Secret
          </Badge>
        )}
      </Group>
      {entry.valueType === 'boolean' && !entry.isCleared ? (
        <Badge
          size="sm"
          color={value === 'true' ? 'teal' : 'gray'}
          variant="dot"
        >
          {value === 'true' ? 'Enabled' : 'Disabled'}
        </Badge>
      ) : entry.isSecret ? (
        <Text size="sm">{value}</Text>
      ) : (
        <Code className="cp-value-preview">
          {value == null
            ? 'Not set'
            : value.slice(0, 240) + (value.length > 240 ? '…' : '')}
        </Code>
      )}
    </Stack>
  );
}
