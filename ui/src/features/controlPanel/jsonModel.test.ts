import {
  parseJsonNode,
  jsonNodeSource,
  jsonNodeError,
  newJsonNode,
  JsonFormLimitError,
} from './jsonModel';
test('all JSON value types, escaped names, empty names and nested lists round-trip', () => {
  for (const source of [
    'null',
    'true',
    'false',
    '"text\\nvalue"',
    '-12.50e+2',
    '[]',
    '{}',
    '{"":null,"quote\\\"key":[false,{"value":"a\\nb"}]}',
  ]) {
    const node = parseJsonNode(source);
    expect(jsonNodeError(node)).toBeNull();
    expect(JSON.parse(jsonNodeSource(node))).toEqual(JSON.parse(source));
  }
});
test('formatting and unrelated form edits preserve exact numeric tokens', () => {
  const node = parseJsonNode(
    '{"id":900719925474099312345,"amount":1.234567890123456789e-10,"label":"before"}',
  );
  node.children[2].node.text = 'after';
  const text = jsonNodeSource(node);
  expect(text).toContain('900719925474099312345');
  expect(text).toContain('1.234567890123456789e-10');
  expect(text).toContain('"after"');
});
test('duplicate field names and incomplete numeric edits are rejected without coercion', () => {
  expect(jsonNodeError(parseJsonNode('{"same":1,"same":2}'))).toContain(
    'duplicate field',
  );
  const number = newJsonNode('number');
  number.text = '1e';
  expect(jsonNodeSource(number)).toBe('1e');
  expect(jsonNodeError(number)).toContain('valid JSON number');
});
test('special property names are treated as ordinary data and raw JSON can remain available beyond form limits', () => {
  const source = '{"__proto__":{"polluted":true},"constructor":"field"}';
  expect(jsonNodeSource(parseJsonNode(source))).toContain('"__proto__"');
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  expect(() => parseJsonNode('['.repeat(102) + '0' + ']'.repeat(102))).toThrow(
    JsonFormLimitError,
  );
});
