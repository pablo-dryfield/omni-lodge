import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import type { SQLNamespace } from '@codemirror/lang-sql';
import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import type { CompletionColumn } from './api';

export function completionSchema(columns: CompletionColumn[]): SQLNamespace {
  const schemas: Record<string, Record<string, Completion[]>> = Object.create(
    null,
  );
  for (const column of columns) {
    const schema = (schemas[column.schema] ||= Object.create(null));
    (schema[column.table] ||= []).push({
      label: column.name,
      type: 'property',
      detail: column.type,
    });
  }
  return schemas;
}
const identifier = (value: string) =>
  value.startsWith('"')
    ? value.slice(1, -1).replace(/""/g, '"')
    : value.toLowerCase();

// CodeMirror resolves schema/table/alias-qualified names. This complementary
// source adds unqualified columns from FROM/JOIN relations in the current
// statement, including a FROM clause written after the cursor in SELECT.
export function columnCompletionSource(
  columns: CompletionColumn[],
  defaultSchema = 'public',
): CompletionSource {
  return (context) => {
    const tree =
      ensureSyntaxTree(context.state, context.state.doc.length, 50) ||
      syntaxTree(context.state);
    let node = tree.resolveInner(context.pos, -1);
    if (/String|Comment/.test(node.name)) return null;
    while (node.parent && node.name !== 'Statement') node = node.parent;
    const tokens: { value: string; name: string; from: number; to: number }[] =
      [];
    tree.iterate({
      from: node.from,
      to: node.to,
      enter(n) {
        if (!n.node.firstChild && !/String|Comment/.test(n.name))
          tokens.push({
            value: context.state.sliceDoc(n.from, n.to),
            name: n.name,
            from: n.from,
            to: n.to,
          });
      },
    });
    const word =
      context.matchBefore(/"(?:[^"\n]|"")*$/) ||
      context.matchBefore(/[\w$\u0080-\uFFFF]+/);
    const from = word?.from ?? context.pos;
    if (
      (!word && !context.explicit) ||
      /[."]/.test(context.state.sliceDoc(Math.max(0, from - 1), from))
    )
      return null;
    const last = tokens.filter((t) => t.to <= from).at(-1);
    if (
      last?.name === 'Keyword' &&
      /^(FROM|JOIN|UPDATE|INTO|TABLE|SCHEMA)$/i.test(last.value)
    )
      return null;
    const relations: { schema: string; table: string }[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (
        tokens[i].name !== 'Keyword' ||
        !/^(FROM|JOIN|UPDATE|INTO)$/i.test(tokens[i].value)
      )
        continue;
      const first = tokens[i + 1],
        dot = tokens[i + 2],
        second = tokens[i + 3];
      if (!first || !/^(QuotedIdentifier|Identifier)$/.test(first.name))
        continue;
      if (
        dot?.value === '.' &&
        second &&
        /^(QuotedIdentifier|Identifier)$/.test(second.name)
      )
        relations.push({
          schema: identifier(first.value),
          table: identifier(second.value),
        });
      else
        relations.push({
          schema: defaultSchema,
          table: identifier(first.value),
        });
    }
    const matching = relations.length
      ? columns.filter((c) =>
          relations.some((r) => r.schema === c.schema && r.table === c.table),
        )
      : columns;
    const options = new Map<string, Completion>();
    for (const c of matching) {
      const detail = `${c.schema}.${c.table} · ${c.type}`;
      const previous = options.get(c.name);
      if (!previous)
        options.set(c.name, {
          label: c.name,
          type: 'property',
          detail,
          apply: '"' + c.name.replace(/"/g, '""') + '"',
          boost: 2,
        });
      else if (!previous.detail?.includes(`${c.schema}.${c.table} ·`))
        previous.detail += '; ' + detail;
    }
    return options.size
      ? {
          from,
          to:
            context.state.sliceDoc(context.pos, context.pos + 1) === '"'
              ? context.pos + 1
              : undefined,
          options: [...options.values()],
          validFor: /^(?:"(?:[^"]|"")*"?|[\w$\u0080-\uFFFF]*)$/,
        }
      : null;
  };
}
