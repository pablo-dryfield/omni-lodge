import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { sql, PostgreSQL, schemaCompletionSource } from '@codemirror/lang-sql';
import { completionSchema, columnCompletionSource } from './sqlCompletions';
// CRA's Jest resolver predates package exports. Use the package's actual CJS
// distribution so these tests exercise real CodeMirror parsing/completion.
jest.mock('@marijn/find-cluster-break', () =>
  jest.requireActual(
    '../../../node_modules/@marijn/find-cluster-break/dist/index.cjs',
  ),
);
const columns = [
  { schema: 'public', table: 'users', name: 'id', type: 'integer' },
  { schema: 'public', table: 'users', name: 'firstName', type: 'text' },
  { schema: 'public', table: 'bookings', name: 'booking_date', type: 'date' },
  { schema: 'archive', table: 'users', name: 'archived_at', type: 'timestamp' },
];
function context(text: string) {
  const pos = text.indexOf('|');
  return new CompletionContext(
    EditorState.create({
      doc: text.replace('|', ''),
      extensions: [sql({ dialect: PostgreSQL })],
    }),
    pos,
    true,
  );
}
async function suggestions(text: string) {
  return (await columnCompletionSource(columns)(context(text)))?.options || [];
}
test('unqualified columns use the FROM clause after the cursor without selecting an explorer object', async () => {
  const result = await suggestions('SELECT fi| FROM users');
  expect(result.map((o) => o.label)).toEqual(['id', 'firstName']);
  expect(result.find((o) => o.label === 'firstName')?.apply).toBe(
    '"firstName"',
  );
});
test('joins include both relations, preserve schema identity, and exclude other statements', async () => {
  expect(
    (
      await suggestions('SELECT | FROM users u JOIN bookings b ON u.id=b.id')
    ).map((o) => o.label),
  ).toEqual(['id', 'firstName', 'booking_date']);
  expect(
    (
      await suggestions(
        'SELECT * FROM public.users; SELECT | FROM archive.users',
      )
    ).map((o) => o.label),
  ).toEqual(['archived_at']);
});
test('qualified table and alias completion uses the complete nested schema', async () => {
  const source = schemaCompletionSource({
    dialect: PostgreSQL,
    schema: completionSchema(columns),
    defaultSchema: 'public',
  });
  expect(
    (await source(context('SELECT u.| FROM public.users u')))?.options.map(
      (o) => o.label,
    ),
  ).toContain('firstName');
  expect(
    (
      await source(context('SELECT archive.users.| FROM archive.users'))
    )?.options.map((o) => o.label),
  ).toEqual(['archived_at']);
});
test('columns are not suggested in strings, comments, or where a table is expected', async () => {
  expect(await suggestions("SELECT 'fi|' FROM users")).toEqual([]);
  expect(await suggestions('SELECT -- fi|\n FROM users')).toEqual([]);
  expect(await suggestions('SELECT * FROM |')).toEqual([]);
});
test('quoted column prefixes and names without FROM remain discoverable', async () => {
  expect(
    (await suggestions('SELECT "fi|" FROM users')).map((o) => o.label),
  ).toContain('firstName');
  expect((await suggestions('SELECT fi|')).map((o) => o.label)).toContain(
    'firstName',
  );
});
