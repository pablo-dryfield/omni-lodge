import { WorkspaceError, type Field, type WireValue } from './types.js';

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'isNull'
  | 'notNull'
  | 'empty';
export type Filter =
  | { group: 'and' | 'or'; children: Filter[] }
  | {
      column: string;
      operator: FilterOperator;
      value?: WireValue | WireValue[];
    };
export type Sort = {
  column: string;
  direction: 'asc' | 'desc';
  nulls: 'first' | 'last';
};
const operators = new Set([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'in',
  'isNull',
  'notNull',
  'empty',
]);
export function validateFilter(
  input: unknown,
  columns: Set<string>,
  depth = 0,
  budget = { count: 0 },
): Filter | undefined {
  if (input == null) return undefined;
  if (
    depth > 6 ||
    ++budget.count > 100 ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    throw new WorkspaceError(
      400,
      'INVALID_FILTER',
      'The filter is invalid or too complex.',
    );
  const f = input as Record<string, unknown>;
  if (f.group) {
    if (
      !['and', 'or'].includes(String(f.group)) ||
      !Array.isArray(f.children) ||
      !f.children.length
    )
      throw new WorkspaceError(
        400,
        'INVALID_FILTER',
        'A filter group needs conditions.',
      );
    return {
      group: f.group as 'and' | 'or',
      children: f.children.map(
        (v) => validateFilter(v, columns, depth + 1, budget)!,
      ),
    };
  }
  if (!columns.has(String(f.column)) || !operators.has(String(f.operator)))
    throw new WorkspaceError(
      400,
      'INVALID_FILTER',
      'Unknown filter column or operator.',
    );
  if (!['isNull', 'notNull', 'empty'].includes(String(f.operator))) {
    const values = Array.isArray(f.value) ? f.value : [f.value];
    if (
      !values.length ||
      values.length > 100 ||
      values.some((v) => typeof v !== 'string' || v.length > 10000) ||
      (f.operator === 'in') !== Array.isArray(f.value)
    )
      throw new WorkspaceError(
        400,
        'INVALID_FILTER',
        'Filter values must be bounded typed text. Use the NULL operators for SQL NULL.',
      );
  }
  return {
    column: String(f.column),
    operator: f.operator as FilterOperator,
    value: f.value as WireValue | WireValue[] | undefined,
  };
}
export function validateSort(input: unknown, columns: Set<string>): Sort[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 10)
    throw new WorkspaceError(
      400,
      'INVALID_SORT',
      'Use at most ten sort columns.',
    );
  return input.map((s) => {
    if (
      !s ||
      !columns.has(s.column) ||
      !['asc', 'desc'].includes(s.direction) ||
      !['first', 'last'].includes(s.nulls)
    )
      throw new WorkspaceError(
        400,
        'INVALID_SORT',
        'Invalid sort column or direction.',
      );
    return { column: s.column, direction: s.direction, nulls: s.nulls };
  });
}
const decimal = /^[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?$/;
// Compare exact decimals without converting them to binary floating point.
export function compareDecimal(a: string, b: string): number {
  const normalize = (v: string) => {
    const [mantissa, exp = '0'] = v.toLowerCase().split('e');
    const negative = mantissa.startsWith('-');
    const [whole, fraction = ''] = mantissa.replace(/^[-+]/, '').split('.');
    const digits = (whole + fraction).replace(/^0+/, '') || '0';
    return {
      negative: negative && digits !== '0',
      digits,
      scale: BigInt(fraction.length) - BigInt(exp),
    };
  };
  const x = normalize(a),
    y = normalize(b);
  if (x.digits === '0' && y.digits === '0') return 0;
  if (x.negative !== y.negative) return x.negative ? -1 : 1;
  const sign = x.negative ? -1 : 1;
  if (x.digits === '0') return -sign;
  if (y.digits === '0') return sign;
  const sizeX = BigInt(x.digits.length) - x.scale;
  const sizeY = BigInt(y.digits.length) - y.scale;
  if (sizeX !== sizeY) return (sizeX < sizeY ? -1 : 1) * sign;
  const length = Math.max(x.digits.length, y.digits.length);
  const left = x.digits.padEnd(length, '0'),
    right = y.digits.padEnd(length, '0');
  return (left < right ? -1 : left > right ? 1 : 0) * sign;
}
export function compareValues(
  a: WireValue,
  b: WireValue,
  field: Field,
): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (
    ['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'oid'].includes(
      field.pgType,
    ) &&
    decimal.test(a) &&
    decimal.test(b)
  )
    return compareDecimal(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}
export function matches(
  row: WireValue[],
  fields: Field[],
  filter?: Filter,
): boolean {
  if (!filter) return true;
  if ('group' in filter)
    return filter.group === 'and'
      ? filter.children.every((f) => matches(row, fields, f))
      : filter.children.some((f) => matches(row, fields, f));
  const index = fields.findIndex((f) => f.id === filter.column),
    value = row[index];
  if (filter.operator === 'isNull') return value === null;
  if (filter.operator === 'notNull') return value !== null;
  if (value === null || value === undefined) return false;
  const needle = String(filter.value ?? ''),
    comparison = compareValues(value, needle, fields[index]);
  switch (filter.operator) {
    case 'eq':
      return comparison === 0;
    case 'ne':
      return comparison !== 0;
    case 'gt':
      return comparison > 0;
    case 'gte':
      return comparison >= 0;
    case 'lt':
      return comparison < 0;
    case 'lte':
      return comparison <= 0;
    case 'contains':
      return value.includes(needle);
    case 'startsWith':
      return value.startsWith(needle);
    case 'endsWith':
      return value.endsWith(needle);
    case 'empty':
      return value === '';
    case 'in':
      return (filter.value as string[]).some(
        (v) => compareValues(value, v, fields[index]) === 0,
      );
    default:
      return false;
  }
}
export const quoteIdentifier = (value: string) =>
  `"${value.replace(/"/g, '""')}"`;
export function compileFilter(
  filter: Filter | undefined,
  columns: Map<string, string>,
  values: unknown[],
): string {
  if (!filter) return 'TRUE';
  if ('group' in filter)
    return `(${filter.children.map((f) => compileFilter(f, columns, values)).join(filter.group === 'and' ? ' AND ' : ' OR ')})`;
  const name = columns.get(filter.column);
  if (!name) throw new WorkspaceError(400, 'INVALID_FILTER', 'Unknown column.');
  const column = quoteIdentifier(name);
  if (filter.operator === 'isNull') return `${column} IS NULL`;
  if (filter.operator === 'notNull') return `${column} IS NOT NULL`;
  if (filter.operator === 'empty') return `${column}::text = ''`;
  if (filter.operator === 'in')
    return `${column} IN (${(filter.value as string[])
      .map((v) => {
        values.push(v);
        return `$${values.length}`;
      })
      .join(',')})`;
  let value = filter.value;
  if (['contains', 'startsWith', 'endsWith'].includes(filter.operator)) {
    const escaped = String(value).replace(/[\\%_]/g, '\\$&');
    value = `${filter.operator === 'startsWith' ? '' : '%'}${escaped}${filter.operator === 'endsWith' ? '' : '%'}`;
    values.push(value);
    return `${column}::text LIKE $${values.length} ESCAPE E'\\\\'`;
  }
  values.push(value);
  return `${column} ${{ eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.operator as 'eq']} $${values.length}`;
}
