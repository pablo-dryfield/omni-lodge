import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { api, type Field, type WireValue } from './api';
import { boundedText, jsonTree, type JsonNode } from './valueView';
import { downloadBookingBlob } from '../../utils/bookingTableExport';

function Tree({ node }: { node: JsonNode }) {
  return node.children ? (
    <details>
      <summary>
        {node.label}: {node.kind} ({node.children.length})
      </summary>
      <div style={{ paddingLeft: 16 }}>
        {node.children.map((child, i) => (
          <Tree node={child} key={i} />
        ))}
      </div>
    </details>
  ) : (
    <Text
      size="xs"
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {node.label}: <Code>{node.value}</Code>{' '}
      <Text component="span" c="dimmed" size="xs">
        {node.kind}
      </Text>
    </Text>
  );
}
export function ValueInspector({
  field,
  value,
}: {
  field: Field;
  value: WireValue;
}) {
  const capabilities = useQuery({
    queryKey: ['database-workspace-capabilities'],
    queryFn: api.capabilities,
  });
  const [notice, setNotice] = useState('');
  const display = useMemo(
    () =>
      boundedText(value || '', capabilities.data?.cellDisplayMaxBytes || 65536),
    [value, capabilities.data?.cellDisplayMaxBytes],
  );
  const tree = useMemo(() => {
    if (
      value === null ||
      display.clipped ||
      !['json', 'jsonb'].includes(field.pgType)
    )
      return;
    try {
      return jsonTree(value);
    } catch {
      return;
    }
  }, [field.pgType, value, display.clipped]);
  return (
    <Stack>
      <Badge variant="light">
        {value === null
          ? 'SQL NULL'
          : value === ''
            ? 'Empty text'
            : 'Exact PostgreSQL text'}
      </Badge>
      {display.clipped && (
        <Alert color="blue">
          Display is shortened to its configured byte budget. Copy and download
          use the complete captured value.
        </Alert>
      )}
      {field.pgType === 'timestamp' && (
        <Text size="xs" c="dimmed">
          Timestamp without time zone; no browser timezone conversion is
          applied.
        </Text>
      )}
      {field.pgType === 'timestamptz' && (
        <Text size="xs" c="dimmed">
          Timestamp with time zone, returned in UTC by this connection.
        </Text>
      )}
      {field.pgType.startsWith('_') && (
        <Text size="xs" c="dimmed">
          PostgreSQL array text preserves dimensions, lower bounds, quoting and
          element NULLs.
        </Text>
      )}
      <Textarea
        aria-label="Exact cell value"
        value={value === null ? 'SQL NULL' : display.text}
        readOnly
        autosize
        minRows={8}
        maxRows={28}
        styles={{
          input: { fontFamily: 'ui-monospace,monospace', fontSize: 12 },
        }}
      />
      {tree && (
        <div aria-label="Lossless JSON tree">
          <Text size="xs" fw={600}>
            JSON tree · numbers retain their original text
          </Text>
          <Tree node={tree} />
        </div>
      )}
      {field.pgType === 'bytea' && value?.startsWith('\\x') && (
        <Code block>
          Hex preview (first 256 bytes):{' '}
          {value
            .slice(2, 514)
            .match(/.{1,2}/g)
            ?.join(' ')}
        </Code>
      )}
      <Group>
        <Button
          variant="light"
          disabled={value === null}
          onClick={() =>
            void navigator.clipboard
              .writeText(value || '')
              .then(() => setNotice('Exact value copied.'))
              .catch(() => setNotice('Clipboard access unavailable.'))
          }
        >
          Copy exact value
        </Button>
        <Button
          variant="default"
          disabled={value === null}
          onClick={() =>
            downloadBookingBlob(
              new Blob([value || ''], { type: 'text/plain;charset=utf-8' }),
              'cell-value.txt',
            )
          }
        >
          Download exact value
        </Button>
      </Group>
      {notice && (
        <Text size="xs" role="status">
          {notice}
        </Text>
      )}
    </Stack>
  );
}
