import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const CONFIG_KEY = 'BOOKING_DYNAMIC_PARSERS';

const CIVITATIS_CURRENCY_CLAUSE = {
  source: 'textBody',
  pattern: 'NET\\s+PRICE\\s*(?:[:\\-])?\\s*([A-Za-z]{3}|Z\\u0141|ZL|\\u20AC|\\$|\\u00A3)',
  group: 1,
  label: 'Civitatis net price currency',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCivitatisParser = (entry: Record<string, unknown>): boolean => {
  const platform = typeof entry.platform === 'string' ? entry.platform.trim().toLowerCase() : '';
  const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
  return platform === 'civitatis' || id === 'civitatis-v1' || id.startsWith('civitatis');
};

const loadDynamicParserConfig = async (qi: QueryInterface): Promise<unknown[] | null> => {
  const [rows] = await qi.sequelize.query('SELECT value FROM config_values WHERE key = :key', {
    replacements: { key: CONFIG_KEY },
  });
  const rawValue = (rows as Array<{ value: string | null }>)[0]?.value ?? null;
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const saveDynamicParserConfig = async (qi: QueryInterface, config: unknown[]): Promise<void> => {
  await qi.sequelize.query(
    'UPDATE config_values SET value = :value, updated_at = NOW() WHERE key = :key',
    {
      replacements: {
        key: CONFIG_KEY,
        value: JSON.stringify(config),
      },
    },
  );
};

export async function up({ context }: MigrationParams): Promise<void> {
  const config = await loadDynamicParserConfig(context);
  if (!config) {
    return;
  }

  let changed = false;
  const next = config.map((entry) => {
    if (!isRecord(entry) || !isCivitatisParser(entry)) {
      return entry;
    }
    if (!isRecord(entry.extract)) {
      return entry;
    }
    if (entry.extract.currency != null) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      extract: {
        ...entry.extract,
        currency: CIVITATIS_CURRENCY_CLAUSE,
      },
    };
  });

  if (changed) {
    await saveDynamicParserConfig(context, next);
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const config = await loadDynamicParserConfig(context);
  if (!config) {
    return;
  }

  let changed = false;
  const next = config.map((entry) => {
    if (!isRecord(entry) || !isCivitatisParser(entry) || !isRecord(entry.extract)) {
      return entry;
    }

    const currentCurrency = entry.extract.currency;
    if (!isRecord(currentCurrency)) {
      return entry;
    }

    const matchesInjectedClause =
      currentCurrency.source === CIVITATIS_CURRENCY_CLAUSE.source &&
      currentCurrency.pattern === CIVITATIS_CURRENCY_CLAUSE.pattern &&
      currentCurrency.group === CIVITATIS_CURRENCY_CLAUSE.group &&
      currentCurrency.label === CIVITATIS_CURRENCY_CLAUSE.label;

    if (!matchesInjectedClause) {
      return entry;
    }

    changed = true;
    const { currency: _currency, ...restExtract } = entry.extract;
    return {
      ...entry,
      extract: restExtract,
    };
  });

  if (changed) {
    await saveDynamicParserConfig(context, next);
  }
}
