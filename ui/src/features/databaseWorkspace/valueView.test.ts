import { boundedText, jsonTree } from './valueView';
import { TextEncoder, TextDecoder } from 'util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
it('retains numeric tokens, duplicate keys, JSON null and escaped strings in its display tree', () => {
  const result = jsonTree(
    '{"id":9007199254740993123,"id":1.200000000000000001,"items":[null,"line\\nnext",true]}',
  );
  expect(result.children?.[0].value).toBe('9007199254740993123');
  expect(result.children?.[1].value).toBe('1.200000000000000001');
  expect(result.children?.[2].children?.[0].kind).toBe('JSON null');
  expect(result.children?.[2].children?.[1].value).toBe('line\nnext');
});
it('rejects malformed or unbounded trees without modifying the raw value', () => {
  expect(() => jsonTree('{"a":1} trailing')).toThrow();
  expect(() => jsonTree('[1,2,3]', 2)).toThrow();
  expect(() => jsonTree('{"a":01}')).toThrow();
});
it('bounds display bytes while retaining the original value for copy', () => {
  const original = 'Kraków '.repeat(100);
  const display = boundedText(original, 30);
  expect(display.clipped).toBe(true);
  expect(new TextEncoder().encode(display.text).length).toBeLessThanOrEqual(32);
  expect(original.length).toBe(700);
});
