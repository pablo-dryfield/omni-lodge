export type JsonNode = {
  label: string;
  kind: string;
  value?: string;
  children?: JsonNode[];
};
/** A bounded display parser: numeric tokens stay text, including >2^53. */
export function jsonTree(raw: string, maxNodes = 1000): JsonNode {
  const token =
    /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,])/y;
  let offset = 0,
    nodes = 0;
  const next = () => {
    token.lastIndex = offset;
    const m = token.exec(raw);
    if (!m) throw new Error('Incomplete JSON');
    offset = token.lastIndex;
    return m[1];
  };
  const node = (label: string, value: string, depth: number): JsonNode => {
    if (++nodes > maxNodes || depth > 30)
      throw new Error('Tree display limit reached');
    if (value === '{' || value === '[') {
      const object = value === '{',
        children: JsonNode[] = [],
        close = object ? '}' : ']';
      let part = next();
      if (part !== close)
        for (;;) {
          let name = String(children.length);
          if (object) {
            if (!part.startsWith('"')) throw new Error('Object key expected');
            name = JSON.parse(part);
            if (next() !== ':') throw new Error('Colon expected');
            part = next();
          }
          children.push(node(name, part, depth + 1));
          part = next();
          if (part === close) break;
          if (part !== ',') throw new Error('Comma expected');
          part = next();
        }
      return { label, kind: object ? 'object' : 'array', children };
    }
    if (value.startsWith('"'))
      return { label, kind: 'string', value: JSON.parse(value) };
    if (
      !/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(
        value,
      )
    )
      throw new Error('Invalid JSON token');
    return {
      label,
      kind:
        value === 'null'
          ? 'JSON null'
          : ['true', 'false'].includes(value)
            ? 'boolean'
            : 'number',
      value,
    };
  };
  const result = node('root', next(), 0);
  if (raw.slice(offset).trim()) throw new Error('Trailing JSON');
  return result;
}
export function boundedText(raw: string, maxBytes: number) {
  const bytes = new TextEncoder().encode(raw.slice(0, maxBytes));
  const clipped = raw.length > maxBytes || bytes.length > maxBytes;
  return {
    text: new TextDecoder().decode(bytes.slice(0, maxBytes), { stream: true }),
    clipped,
  };
}
