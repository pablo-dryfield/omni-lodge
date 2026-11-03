import { WorkspaceError } from './types.js';
export function savedQueryValue(
  input: Record<string, unknown>,
  maxSqlBytes: number,
) {
  const allowed = new Set([
    'title',
    'sql',
    'targetId',
    'folder',
    'tags',
    'favorite',
    'plan',
    'parameterDefinitions',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new WorkspaceError(
      400,
      'QUERY_VALUES_PRIVATE',
      'Reusable queries accept SQL and declared metadata only. Bound parameter values belong in the private tab draft.',
    );
  if (
    typeof input.sql !== 'string' ||
    !input.sql.trim() ||
    Buffer.byteLength(input.sql) > maxSqlBytes ||
    typeof input.targetId !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(input.targetId)
  )
    throw new WorkspaceError(
      400,
      'QUERY_DOCUMENT',
      'A saved query needs bounded SQL and a registered target ID.',
    );
  for (const key of ['title', 'folder'])
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' || (input[key] as string).length > 120)
    )
      throw new WorkspaceError(
        400,
        'QUERY_DOCUMENT',
        'Use bounded text for the query title and folder.',
      );
  if (
    input.tags !== undefined &&
    (!Array.isArray(input.tags) ||
      input.tags.length > 20 ||
      input.tags.some((tag) => typeof tag !== 'string' || tag.length > 40))
  )
    throw new WorkspaceError(
      400,
      'QUERY_TAGS',
      'Use at most 20 short text tags.',
    );
  if (input.favorite !== undefined && typeof input.favorite !== 'boolean')
    throw new WorkspaceError(
      400,
      'QUERY_DOCUMENT',
      'Favorite must be a boolean.',
    );
  if (input.parameterDefinitions !== undefined) {
    if (
      !Array.isArray(input.parameterDefinitions) ||
      input.parameterDefinitions.length > 100
    )
      throw new WorkspaceError(
        400,
        'QUERY_PARAMETERS',
        'Declare at most 100 parameters.',
      );
    for (const value of input.parameterDefinitions) {
      const p = value as {
        name?: unknown;
        type?: unknown;
        required?: unknown;
        sensitive?: unknown;
        defaultValue?: unknown;
      };
      if (
        !p ||
        typeof p !== 'object' ||
        Object.keys(p).some(
          (key) =>
            !['name', 'type', 'required', 'sensitive', 'defaultValue'].includes(
              key,
            ),
        ) ||
        typeof p.name !== 'string' ||
        p.name.length > 80 ||
        ![
          'text',
          'integer',
          'bigint',
          'numeric',
          'boolean',
          'date',
          'timestamp',
          'timestamptz',
          'uuid',
          'jsonb',
        ].includes(String(p.type)) ||
        typeof p.required !== 'boolean' ||
        typeof p.sensitive !== 'boolean' ||
        (p.defaultValue !== undefined &&
          (p.sensitive ||
            (p.defaultValue !== null &&
              (typeof p.defaultValue !== 'string' ||
                p.defaultValue.length > 10000))))
      )
        throw new WorkspaceError(
          400,
          'QUERY_PARAMETERS',
          'Parameter declarations need a name, supported PostgreSQL type, required/sensitive flags and an optional nonsensitive text/null default. Sensitive defaults are never saved.',
        );
    }
  }
  return input;
}
