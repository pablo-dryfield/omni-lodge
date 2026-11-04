import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {
  newJsonNode,
  parseJsonNode,
  jsonNodeSource,
  jsonNodeError,
  type JsonNode,
  type JsonKind,
  JsonFormLimitError,
} from './jsonModel';
const kinds = [
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'List' },
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'null', label: 'Null' },
];
function NodeForm({
  node,
  onChange,
  label,
  depth = 0,
}: {
  node: JsonNode;
  onChange: (node: JsonNode) => void;
  label: string;
  depth?: number;
}) {
  const [key, setKey] = useState(''),
    [kind, setKind] = useState<JsonKind>('string');
  const container = node.kind === 'object' || node.kind === 'array';
  const changeChild = (index: number, next: JsonNode) =>
    onChange({
      ...node,
      children: node.children.map((child, i) =>
        i === index ? { ...child, node: next } : child,
      ),
    });
  return (
    <Stack gap="xs" className="cp-json-node">
      <Group gap="xs" wrap="wrap" justify="space-between">
        <Text size="xs" fw={600} style={{ overflowWrap: 'anywhere' }}>
          {label}
        </Text>
        <Select
          aria-label={`Type of ${label}`}
          data={kinds}
          value={node.kind}
          onChange={(value) =>
            value &&
            onChange({ ...newJsonNode(value as JsonKind), id: node.id })
          }
          allowDeselect={false}
          size="xs"
          w={125}
        />
      </Group>
      {node.kind === 'string' && (
        <Textarea
          aria-label={`Value of ${label}`}
          value={node.text}
          autosize
          minRows={1}
          maxRows={8}
          onChange={(e) => onChange({ ...node, text: e.currentTarget.value })}
        />
      )}
      {node.kind === 'number' && (
        <TextInput
          aria-label={`Value of ${label}`}
          inputMode="decimal"
          value={node.text}
          onChange={(e) => onChange({ ...node, text: e.currentTarget.value })}
          error={jsonNodeError(node, label)}
        />
      )}
      {node.kind === 'boolean' && (
        <Switch
          label={node.text === 'true' ? 'Enabled' : 'Disabled'}
          aria-label={`Value of ${label}`}
          checked={node.text === 'true'}
          onChange={(e) =>
            onChange({ ...node, text: String(e.currentTarget.checked) })
          }
        />
      )}
      {node.kind === 'null' && (
        <Text size="xs" c="dimmed">
          No value (null)
        </Text>
      )}
      {container && (
        <details open={depth < 1} className="cp-json-container">
          <summary>
            <Badge variant="light" size="xs">
              {node.children.length}{' '}
              {node.kind === 'object' ? 'fields' : 'items'}
            </Badge>
          </summary>
          <Stack gap="sm" mt="xs">
            {node.children.map((child, index) => (
              <div className="cp-json-child" key={child.node.id}>
                <Group gap="xs" wrap="nowrap" align="flex-end">
                  {node.kind === 'object' ? (
                    <TextInput
                      label="Field name"
                      aria-label={`Field name ${label} ${index + 1}`}
                      value={child.key}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        onChange({
                          ...node,
                          children: node.children.map((c, i) =>
                            i === index ? { ...c, key: value } : c,
                          ),
                        });
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  ) : (
                    <Text size="sm" fw={600}>
                      Item {index + 1}
                    </Text>
                  )}
                  {node.kind === 'array' && (
                    <>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Move item ${index + 1} up in ${label}`}
                        disabled={index === 0}
                        onClick={() => {
                          const children = [...node.children];
                          [children[index - 1], children[index]] = [
                            children[index],
                            children[index - 1],
                          ];
                          onChange({ ...node, children });
                        }}
                      >
                        <IconArrowUp size={15} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Move item ${index + 1} down in ${label}`}
                        disabled={index === node.children.length - 1}
                        onClick={() => {
                          const children = [...node.children];
                          [children[index + 1], children[index]] = [
                            children[index],
                            children[index + 1],
                          ];
                          onChange({ ...node, children });
                        }}
                      >
                        <IconArrowDown size={15} />
                      </ActionIcon>
                    </>
                  )}
                  <ActionIcon
                    variant="light"
                    color="red"
                    aria-label={`Remove ${node.kind === 'object' ? child.key : 'item ' + (index + 1)} from ${label}`}
                    onClick={() =>
                      onChange({
                        ...node,
                        children: node.children.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
                <NodeForm
                  node={child.node}
                  onChange={(next) => changeChild(index, next)}
                  label={
                    node.kind === 'object'
                      ? `${label}.${child.key}`
                      : `${label}[${index}]`
                  }
                  depth={depth + 1}
                />
              </div>
            ))}
            <Group gap="xs" align="flex-end" wrap="wrap">
              {node.kind === 'object' && (
                <TextInput
                  label="New field name"
                  aria-label={`New field in ${label}`}
                  placeholder="fieldName"
                  value={key}
                  onChange={(e) => setKey(e.currentTarget.value)}
                  style={{ flex: '1 1 130px' }}
                />
              )}
              <Select
                label="Value type"
                aria-label={`New value type in ${label}`}
                data={kinds}
                value={kind}
                onChange={(v) => v && setKind(v as JsonKind)}
                allowDeselect={false}
                w={140}
              />
              <Button
                variant="light"
                size="sm"
                leftSection={<IconPlus size={14} />}
                disabled={
                  node.kind === 'object' &&
                  node.children.some((c) => c.key === key)
                }
                onClick={() => {
                  onChange({
                    ...node,
                    children: [
                      ...node.children,
                      {
                        key:
                          node.kind === 'object'
                            ? key
                            : String(node.children.length),
                        node: newJsonNode(kind),
                      },
                    ],
                  });
                  setKey('');
                }}
              >
                {node.kind === 'object' ? 'Add field' : 'Add item'}
              </Button>
            </Group>
          </Stack>
        </details>
      )}
    </Stack>
  );
}
export function StructuredJsonEditor({
  value,
  onChange,
  onError,
}: {
  value: string;
  onChange: (value: string) => void;
  onError: (error: string | null) => void;
}) {
  const analysis = useMemo(() => {
    try {
      const node = parseJsonNode(value);
      return { node, error: jsonNodeError(node) };
    } catch (error) {
      return {
        node: null,
        error:
          error instanceof JsonFormLimitError
            ? null
            : value.trim()
              ? error instanceof Error
                ? error.message
                : 'Invalid JSON'
              : null,
        formMessage: error instanceof JsonFormLimitError ? error.message : null,
      };
    }
  }, [value]);
  const [mode, setMode] = useState<'form' | 'json'>(
      analysis.node || !value.trim() ? 'form' : 'json',
    ),
    [node, setNode] = useState<JsonNode | null>(analysis.node),
    [undo, setUndo] = useState<string[]>([]);
  const emitted = useRef(value);
  useEffect(() => {
    onError(analysis.error);
  }, [analysis.error, onError]);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setNode(analysis.node);
    }
  }, [value, analysis.node]);
  const publish = (next: JsonNode) => {
    const text = jsonNodeSource(next);
    setUndo((previous) => [...previous, value].slice(-20));
    emitted.current = text;
    setNode(next);
    onChange(text);
  };
  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap={4}>
          <Button
            size="xs"
            variant={mode === 'form' ? 'filled' : 'default'}
            disabled={Boolean(value.trim() && !analysis.node)}
            onClick={() => {
              setNode(analysis.node);
              setMode('form');
            }}
          >
            Form
          </Button>
          <Button
            size="xs"
            variant={mode === 'json' ? 'filled' : 'default'}
            onClick={() => setMode('json')}
          >
            JSON
          </Button>
        </Group>
        <Group gap={4}>
          <Button
            size="xs"
            variant="subtle"
            disabled={!undo.length}
            onClick={() => {
              const previous = undo[undo.length - 1];
              setUndo(undo.slice(0, -1));
              onChange(previous);
            }}
          >
            Undo
          </Button>
          <Button
            size="xs"
            variant="light"
            disabled={!analysis.node || Boolean(analysis.error)}
            onClick={() => {
              if (analysis.node) onChange(jsonNodeSource(analysis.node));
            }}
          >
            Format JSON
          </Button>
        </Group>
      </Group>
      {mode === 'json' ? (
        <Textarea
          label="JSON value"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          minRows={10}
          maxRows={25}
          autosize
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          styles={{
            input: { fontFamily: 'ui-monospace,monospace', fontSize: 13 },
          }}
        />
      ) : node ? (
        <NodeForm node={node} onChange={publish} label="$" />
      ) : (
        <Group>
          <Button
            variant="light"
            onClick={() => publish(newJsonNode('object'))}
          >
            Start an object
          </Button>
          <Button variant="light" onClick={() => publish(newJsonNode('array'))}>
            Start a list
          </Button>
        </Group>
      )}
      {analysis.error && (
        <Alert color="red" title="Check JSON">
          {analysis.error}
        </Alert>
      )}
      {'formMessage' in analysis && analysis.formMessage && (
        <Alert color="blue">{analysis.formMessage}</Alert>
      )}
      <Text size="xs" c="dimmed">
        Use field types to add nested objects, lists, text, numbers, booleans
        and null values. Changes are saved only when you select Save changes.
      </Text>
    </Stack>
  );
}
