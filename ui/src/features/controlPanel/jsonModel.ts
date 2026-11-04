export type JsonKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null';
export type JsonNode = {
  id: string;
  kind: JsonKind;
  text: string;
  children: { key: string; node: JsonNode }[];
};
export class JsonFormLimitError extends Error {}
let sequence = 0;
export const newJsonNode = (kind: JsonKind): JsonNode => ({
  id: `json-${++sequence}`,
  kind,
  text: kind === 'number' ? '0' : kind === 'boolean' ? 'false' : '',
  children: [],
});

// Parse structure without converting numeric tokens through JavaScript Number.
// Formatting or editing another field must never round a large integer.
export function parseJsonNode(source: string): JsonNode {
  JSON.parse(source);
  let at = 0,
    count = 0;
  const space = () => {
    while (/\s/.test(source[at] || '') && at < source.length) at++;
  };
  const string = () => {
    const start = at++;
    while (at < source.length) {
      if (source[at] === '\\') {
        at += 2;
        continue;
      }
      if (source[at++] === '"') break;
    }
    return JSON.parse(source.slice(start, at)) as string;
  };
  const read = (depth: number): JsonNode => {
    if (depth > 100 || ++count > 20000)
      throw new JsonFormLimitError(
        'This document is too large or deeply nested for the form. Use JSON view.',
      );
    space();
    const char = source[at];
    if (char === '{' || char === '[') {
      const object = char === '{',
        node = newJsonNode(object ? 'object' : 'array'),
        end = object ? '}' : ']';
      at++;
      space();
      while (source[at] !== end) {
        const key = object ? string() : String(node.children.length);
        space();
        if (object) {
          at++;
          space();
        }
        node.children.push({ key, node: read(depth + 1) });
        space();
        if (source[at] === ',') {
          at++;
          space();
        } else break;
      }
      at++;
      return node;
    }
    if (char === '"') {
      const node = newJsonNode('string');
      node.text = string();
      return node;
    }
    if (source.startsWith('true', at) || source.startsWith('false', at)) {
      const node = newJsonNode('boolean');
      node.text = source.startsWith('true', at) ? 'true' : 'false';
      at += node.text.length;
      return node;
    }
    if (source.startsWith('null', at)) {
      at += 4;
      return newJsonNode('null');
    }
    const node = newJsonNode('number');
    node.text = source
      .slice(at)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)![0];
    at += node.text.length;
    return node;
  };
  return read(0);
}
export function jsonNodeSource(node: JsonNode, depth = 0): string {
  if (node.kind === 'string') return JSON.stringify(node.text);
  if (node.kind === 'null') return 'null';
  if (node.kind === 'number' || node.kind === 'boolean') return node.text;
  const object = node.kind === 'object',
    open = object ? '{' : '[',
    close = object ? '}' : ']';
  if (!node.children.length) return open + close;
  const pad = '  '.repeat(depth + 1);
  return (
    open +
    '\n' +
    node.children
      .map(
        (child) =>
          pad +
          (object ? JSON.stringify(child.key) + ': ' : '') +
          jsonNodeSource(child.node, depth + 1),
      )
      .join(',\n') +
    '\n' +
    '  '.repeat(depth) +
    close
  );
}
export function jsonNodeError(node: JsonNode, path = '$'): string | null {
  if (
    node.kind === 'number' &&
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(node.text)
  )
    return `${path}: enter a valid JSON number.`;
  if (node.kind === 'object') {
    const seen = new Set<string>();
    for (const child of node.children) {
      if (seen.has(child.key))
        return `${path}: duplicate field ${JSON.stringify(child.key)}.`;
      seen.add(child.key);
    }
  }
  for (const child of node.children) {
    const error = jsonNodeError(
      child.node,
      `${path}[${JSON.stringify(child.key)}]`,
    );
    if (error) return error;
  }
  return null;
}
