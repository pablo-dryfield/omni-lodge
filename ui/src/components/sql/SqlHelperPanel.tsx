import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  Popover,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertTriangle, IconDatabase, IconPlayerPlay } from "@tabler/icons-react";
import type { AxiosError } from "axios";
import { useExecuteSql, type SqlStatementType } from "../../api/sqlHelper";
import axiosInstance from "../../utils/axiosInstance";

const DEFAULT_QUERY = "SELECT NOW();";

type SqlTokenType =
  | "keyword"
  | "identifier"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "punctuation"
  | "whitespace";

type SqlToken = {
  type: SqlTokenType;
  value: string;
};

type SqlSchemaTableMeta = {
  schema: string;
  table: string;
  fullName: string;
  columns: string[];
};

type SqlCompletionItem = {
  label: string;
  insertText: string;
  detail?: string;
};

type SqlCompletionContext = {
  kind: "table" | "column";
  replaceStart: number;
  replaceEnd: number;
  items: SqlCompletionItem[];
};

type SqlTableReferenceContext = {
  tables: string[];
  aliasToTable: Map<string, string>;
  tableToAliases: Map<string, string[]>;
};

const SQL_SCHEMA_METADATA_QUERY = `
SELECT COALESCE(
  json_agg(
    json_build_object(
      'table_schema', table_schema,
      'table_name', table_name,
      'columns', columns
    )
    ORDER BY table_schema, table_name
  ),
  '[]'::json
) AS tables
FROM (
  SELECT
    n.nspname AS table_schema,
    c.relname AS table_name,
    array_agg(a.attname ORDER BY a.attnum) AS columns
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  GROUP BY n.nspname, c.relname
) tables
`.trim();

const SQL_KEYWORDS = new Set<string>([
  "SELECT",
  "WITH",
  "AS",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "RETURNING",
  "JOIN",
  "LEFT",
  "RIGHT",
  "FULL",
  "INNER",
  "OUTER",
  "CROSS",
  "ON",
  "UNION",
  "ALL",
  "DISTINCT",
  "EXCEPT",
  "INTERSECT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "DATABASE",
  "SCHEMA",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "DEFAULT",
  "CHECK",
  "UNIQUE",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "GRANT",
  "REVOKE",
]);

const TABLE_CONTEXT_REGEX =
  /\b(?:from|join|into|update|table|truncate\s+table|delete\s+from)\s+([A-Za-z0-9_."$]*)$/iu;
const QUALIFIED_COLUMN_CONTEXT_REGEX =
  /(["A-Za-z_][A-Za-z0-9_$"]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_$"]*)?$/u;
const WORD_CONTEXT_REGEX = /([A-Za-z_][A-Za-z0-9_$]*)$/u;
const TABLE_REFERENCE_REGEX =
  /\b(?:from|join|into|update|table|truncate\s+table|delete\s+from)\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)(?:\s+(?:as\s+)?("?[A-Za-z_][A-Za-z0-9_$]*"?))?/giu;

const normalizeIdentifierPart = (value: string): string =>
  value.trim().replace(/^"(.+)"$/u, "$1").toLowerCase();

const normalizeQualifiedIdentifier = (value: string): string =>
  value
    .trim()
    .split(".")
    .map((part) => normalizeIdentifierPart(part))
    .join(".");

const parsePgTextArray = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [];
  }
  const body = trimmed.slice(1, -1);
  if (!body) {
    return [];
  }
  return body
    .split(",")
    .map((token) => token.trim().replace(/^"(.+)"$/u, "$1"))
    .filter(Boolean);
};

const parseColumnsValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return [];
    }
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => String(entry)).filter(Boolean);
        }
      } catch {
        // Ignore and fall back to PG text[] parsing.
      }
    }
    return parsePgTextArray(text);
  }
  return [];
};

const parseSchemaTablesPayload = (value: unknown): SqlSchemaTableMeta[] => {
  const normalized = (() => {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  })();

  return normalized
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as { table_schema?: unknown; table_name?: unknown; columns?: unknown };
      const schema = typeof row.table_schema === "string" ? row.table_schema.trim() : "";
      const table = typeof row.table_name === "string" ? row.table_name.trim() : "";
      if (!schema || !table) {
        return null;
      }
      const columns = parseColumnsValue(row.columns);
      return {
        schema,
        table,
        fullName: `${schema}.${table}`,
        columns,
      } satisfies SqlSchemaTableMeta;
    })
    .filter((entry): entry is SqlSchemaTableMeta => Boolean(entry));
};

const matchesAutocompletePattern = (candidate: string, pattern: string): boolean => {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return true;
  }
  try {
    return new RegExp(normalizedPattern, "i").test(candidate);
  } catch {
    return candidate.toLowerCase().includes(normalizedPattern.toLowerCase());
  }
};

const extractTableReferences = (sql: string): SqlTableReferenceContext => {
  const tableSet = new Set<string>();
  const aliasToTable = new Map<string, string>();
  const tableToAliases = new Map<string, string[]>();
  const regex = new RegExp(TABLE_REFERENCE_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sql)) !== null) {
    const rawTable = (match[1] ?? "").replace(/\s*\.\s*/gu, ".").trim();
    if (!rawTable) {
      continue;
    }
    const normalizedTable = normalizeQualifiedIdentifier(rawTable);
    tableSet.add(normalizedTable);

    const rawAlias = (match[2] ?? "").trim();
    if (!rawAlias) {
      continue;
    }
    const aliasKeywordCandidate = normalizeIdentifierPart(rawAlias).toUpperCase();
    if (SQL_KEYWORDS.has(aliasKeywordCandidate)) {
      continue;
    }
    const normalizedAlias = normalizeIdentifierPart(rawAlias);
    aliasToTable.set(normalizedAlias, normalizedTable);
    const aliases = tableToAliases.get(normalizedTable) ?? [];
    if (!aliases.includes(normalizedAlias)) {
      aliases.push(normalizedAlias);
      tableToAliases.set(normalizedTable, aliases);
    }
  }

  return {
    tables: Array.from(tableSet),
    aliasToTable,
    tableToAliases,
  };
};

const CLAUSE_KEYWORDS = new Set<string>([
  "SELECT",
  "WITH",
  "FROM",
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "UPDATE",
  "DELETE",
  "VALUES",
  "SET",
  "RETURNING",
  "JOIN",
  "LEFT",
  "RIGHT",
  "FULL",
  "INNER",
  "OUTER",
  "CROSS",
  "ON",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
]);

const TOKEN_COLORS: Record<SqlTokenType, string> = {
  keyword: "#0b5fff",
  identifier: "#1f2937",
  string: "#157f3b",
  number: "#8b5cf6",
  comment: "#64748b",
  operator: "#d97706",
  punctuation: "#334155",
  whitespace: "inherit",
};

const STATEMENT_LABELS: Record<SqlStatementType, string> = {
  read: "READ",
  write: "WRITE",
};

const STATEMENT_BADGE_COLOR: Record<SqlStatementType, string> = {
  read: "blue",
  write: "red",
};

const sanitizeQuery = (value: string) => value.trim();

const isWordStart = (char: string): boolean => /[A-Za-z_]/u.test(char);
const isWord = (char: string): boolean => /[A-Za-z0-9_$]/u.test(char);
const isDigit = (char: string): boolean => /[0-9]/u.test(char);

const tokenizeSql = (sql: string): SqlToken[] => {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const current = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (/\s/u.test(current)) {
      const start = index;
      while (index < sql.length && /\s/u.test(sql[index] ?? "")) {
        index += 1;
      }
      tokens.push({ type: "whitespace", value: sql.slice(start, index) });
      continue;
    }

    if (current === "-" && next === "-") {
      const start = index;
      index += 2;
      while (index < sql.length && (sql[index] ?? "") !== "\n") {
        index += 1;
      }
      tokens.push({ type: "comment", value: sql.slice(start, index) });
      continue;
    }

    if (current === "/" && next === "*") {
      const start = index;
      index += 2;
      while (index < sql.length) {
        if ((sql[index] ?? "") === "*" && (sql[index + 1] ?? "") === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      tokens.push({ type: "comment", value: sql.slice(start, index) });
      continue;
    }

    if (current === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        const char = sql[index] ?? "";
        const following = sql[index + 1] ?? "";
        if (char === "'" && following === "'") {
          index += 2;
          continue;
        }
        if (char === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ type: "string", value: sql.slice(start, index) });
      continue;
    }

    if (current === "$") {
      const fragment = sql.slice(index);
      const tagMatch = fragment.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/u) ?? fragment.match(/^\$\$/u);
      if (tagMatch) {
        const tag = tagMatch[0];
        const start = index;
        index += tag.length;
        const closeAt = sql.indexOf(tag, index);
        if (closeAt >= 0) {
          index = closeAt + tag.length;
        } else {
          index = sql.length;
        }
        tokens.push({ type: "string", value: sql.slice(start, index) });
        continue;
      }
    }

    if (current === "\"") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        const char = sql[index] ?? "";
        const following = sql[index + 1] ?? "";
        if (char === "\"" && following === "\"") {
          index += 2;
          continue;
        }
        if (char === "\"") {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ type: "identifier", value: sql.slice(start, index) });
      continue;
    }

    if (isDigit(current)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[0-9_.]/u.test(sql[index] ?? "")) {
        index += 1;
      }
      tokens.push({ type: "number", value: sql.slice(start, index) });
      continue;
    }

    if (isWordStart(current)) {
      const start = index;
      index += 1;
      while (index < sql.length && isWord(sql[index] ?? "")) {
        index += 1;
      }
      const rawWord = sql.slice(start, index);
      const upperWord = rawWord.toUpperCase();
      tokens.push({
        type: SQL_KEYWORDS.has(upperWord) ? "keyword" : "identifier",
        value: rawWord,
      });
      continue;
    }

    if ("(),.;".includes(current)) {
      tokens.push({ type: "punctuation", value: current });
      index += 1;
      continue;
    }

    if ("=<>!+-*/%|&:^~?".includes(current)) {
      const start = index;
      index += 1;
      while (index < sql.length && "=<>!+-*/%|&:^~?".includes(sql[index] ?? "")) {
        index += 1;
      }
      tokens.push({ type: "operator", value: sql.slice(start, index) });
      continue;
    }

    tokens.push({ type: "punctuation", value: current });
    index += 1;
  }

  return tokens;
};

const beautifySql = (rawSql: string): string => {
  const tokens = tokenizeSql(rawSql);
  const parts: string[] = [];
  let indentLevel = 0;
  let lineStart = true;
  let needsSpace = false;

  const currentIndent = () => "  ".repeat(Math.max(0, indentLevel));
  const trimTrailingWhitespace = () => {
    while (parts.length > 0 && /\s/u.test(parts[parts.length - 1] ?? "")) {
      parts.pop();
    }
  };
  const newLine = () => {
    trimTrailingWhitespace();
    if (parts.length > 0 && parts[parts.length - 1] !== "\n") {
      parts.push("\n");
    }
    parts.push(currentIndent());
    lineStart = true;
    needsSpace = false;
  };
  const append = (value: string) => {
    if (!value) {
      return;
    }
    if (lineStart) {
      parts.push(currentIndent());
      lineStart = false;
    } else if (needsSpace) {
      parts.push(" ");
    }
    parts.push(value);
    needsSpace = true;
  };

  tokens.forEach((token) => {
    if (token.type === "whitespace") {
      return;
    }

    if (token.type === "comment") {
      newLine();
      append(token.value.trim());
      newLine();
      return;
    }

    if (token.value === ";") {
      trimTrailingWhitespace();
      parts.push(";");
      parts.push("\n\n");
      lineStart = true;
      needsSpace = false;
      return;
    }

    if (token.value === "(") {
      append("(");
      indentLevel += 1;
      newLine();
      return;
    }

    if (token.value === ")") {
      indentLevel = Math.max(0, indentLevel - 1);
      newLine();
      append(")");
      return;
    }

    if (token.value === ",") {
      trimTrailingWhitespace();
      parts.push(",");
      newLine();
      return;
    }

    if (token.value === ".") {
      trimTrailingWhitespace();
      if (lineStart) {
        parts.push(currentIndent());
        lineStart = false;
      }
      parts.push(".");
      needsSpace = false;
      return;
    }

    if (token.type === "keyword") {
      const keyword = token.value.toUpperCase();
      if (CLAUSE_KEYWORDS.has(keyword) && !lineStart) {
        newLine();
      }
      append(keyword);
      return;
    }

    if (token.type === "operator") {
      append(token.value);
      return;
    }

    append(token.value);
  });

  return parts.join("").replace(/\s+$/u, "");
};

const splitTopLevelStatements = (query: string): string[] => {
  const statements: string[] = [];
  let index = 0;
  let statementStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag: string | null = null;

  while (index < query.length) {
    const current = query[index] ?? "";
    const next = query[index + 1] ?? "";

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
      }
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarQuoteTag) {
      if (query.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      index += 1;
      continue;
    }

    if (inSingleQuote) {
      if (current === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (current === "'") {
        inSingleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inDoubleQuote) {
      if (current === "\"" && next === "\"") {
        index += 2;
        continue;
      }
      if (current === "\"") {
        inDoubleQuote = false;
      }
      index += 1;
      continue;
    }

    if (current === "-" && next === "-") {
      lineComment = true;
      index += 2;
      continue;
    }

    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    if (current === "'") {
      inSingleQuote = true;
      index += 1;
      continue;
    }

    if (current === "\"") {
      inDoubleQuote = true;
      index += 1;
      continue;
    }

    if (current === "$") {
      const dollarMatch = query.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/u) ?? query.slice(index).match(/^\$\$/u);
      if (dollarMatch) {
        dollarQuoteTag = dollarMatch[0];
        index += dollarQuoteTag.length;
        continue;
      }
    }

    if (current === ";") {
      const candidate = query.slice(statementStart, index).trim();
      if (candidate.length > 0) {
        statements.push(candidate);
      }
      statementStart = index + 1;
      index += 1;
      continue;
    }

    index += 1;
  }

  const tail = query.slice(statementStart).trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
};

const determineStatementType = (raw: string): SqlStatementType => {
  const value = raw.trim();
  const withoutLeadingComments = value
    .replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*\s*/u, "")
    .trimStart();
  const firstToken = withoutLeadingComments.match(/^[A-Za-z]+/u)?.[0]?.toLowerCase() ?? "";
  if (["select", "with", "show", "explain", "describe", "values", "table"].includes(firstToken)) {
    return "read";
  }
  return "write";
};

const isAxiosError = (value: unknown): value is AxiosError<{ message?: string }> =>
  typeof value === "object" && value !== null && "isAxiosError" in value;

const SqlHelperPanel = () => {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<SqlStatementType>("read");
  const [beautifyError, setBeautifyError] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState(DEFAULT_QUERY.length);
  const [editorFocused, setEditorFocused] = useState(false);
  const [schemaTables, setSchemaTables] = useState<SqlSchemaTableMeta[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorScrollLeft, setEditorScrollLeft] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const executeMutation = useExecuteSql();

  useEffect(() => {
    let cancelled = false;
    const fetchSchemaMetadata = async () => {
      setSchemaLoading(true);
      setSchemaError(null);
      try {
        const response = await axiosInstance.post("/sql-helper/execute", {
          query: SQL_SCHEMA_METADATA_QUERY,
        });
        const rows = Array.isArray(response.data?.rows)
          ? (response.data.rows as Array<Record<string, unknown>>)
          : [];
        const payload = rows[0]?.tables;
        const parsedTables = parseSchemaTablesPayload(payload);
        if (!cancelled) {
          setSchemaTables(parsedTables);
          if (parsedTables.length === 0) {
            setSchemaError("No table metadata available for autocomplete.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = isAxiosError(error)
            ? error.response?.data?.message ?? error.message
            : error instanceof Error
              ? error.message
              : "Unable to load SQL metadata.";
          setSchemaError(message);
        }
      } finally {
        if (!cancelled) {
          setSchemaLoading(false);
        }
      }
    };

    fetchSchemaMetadata();
    return () => {
      cancelled = true;
    };
  }, []);

  const tableByFullName = useMemo(() => {
    const map = new Map<string, SqlSchemaTableMeta>();
    schemaTables.forEach((table) => {
      map.set(normalizeQualifiedIdentifier(table.fullName), table);
    });
    return map;
  }, [schemaTables]);

  const tablesByName = useMemo(() => {
    const map = new Map<string, SqlSchemaTableMeta[]>();
    schemaTables.forEach((table) => {
      const key = normalizeIdentifierPart(table.table);
      const bucket = map.get(key) ?? [];
      bucket.push(table);
      map.set(key, bucket);
    });
    return map;
  }, [schemaTables]);

  const resolveTableMeta = useCallback((rawReference: string): SqlSchemaTableMeta | null => {
    const normalized = normalizeQualifiedIdentifier(rawReference);
    const directMatch = tableByFullName.get(normalized);
    if (directMatch) {
      return directMatch;
    }
    if (!normalized.includes(".")) {
      const byNameMatches = tablesByName.get(normalized) ?? [];
      if (byNameMatches.length === 0) {
        return null;
      }
      const publicMatch = byNameMatches.find((entry) => normalizeIdentifierPart(entry.schema) === "public");
      return publicMatch ?? byNameMatches[0] ?? null;
    }
    return null;
  }, [tableByFullName, tablesByName]);

  const completionContext = useMemo<SqlCompletionContext | null>(() => {
    if (!editorFocused) {
      return null;
    }
    const cursor = Math.max(0, Math.min(cursorPosition, query.length));
    const leftText = query.slice(0, cursor);
    const tableReferences = extractTableReferences(leftText);

    const tableContextMatch = leftText.match(TABLE_CONTEXT_REGEX);
    if (tableContextMatch) {
      const partial = tableContextMatch[1] ?? "";
      const replaceEnd = cursor;
      const replaceStart = cursor - partial.length;
      const items = schemaTables
        .filter((table) => {
          const displayName = table.schema === "public" ? table.table : table.fullName;
          return (
            matchesAutocompletePattern(displayName, partial) ||
            matchesAutocompletePattern(table.fullName, partial)
          );
        })
        .slice(0, 40)
        .map((table) => {
          const displayName = table.schema === "public" ? table.table : table.fullName;
          const insertText =
            partial.includes(".") || table.schema !== "public" ? table.fullName : table.table;
          return {
            label: displayName,
            insertText,
            detail: `${table.columns.length} columns`,
          } satisfies SqlCompletionItem;
        });

      return {
        kind: "table",
        replaceStart,
        replaceEnd,
        items,
      };
    }

    const qualifiedColumnMatch = leftText.match(QUALIFIED_COLUMN_CONTEXT_REGEX);
    if (qualifiedColumnMatch) {
      const qualifier = qualifiedColumnMatch[1] ?? "";
      const partial = qualifiedColumnMatch[2] ?? "";
      const normalizedQualifier = normalizeIdentifierPart(qualifier);
      const tableRef =
        tableReferences.aliasToTable.get(normalizedQualifier) ??
        normalizeQualifiedIdentifier(qualifier);
      const tableMeta = resolveTableMeta(tableRef);

      if (!tableMeta) {
        return null;
      }

      const replaceEnd = cursor;
      const replaceStart = cursor - partial.length;
      const qualifierLabel = qualifier.replace(/^"(.+)"$/u, "$1");
      const items = tableMeta.columns
        .filter((column) => matchesAutocompletePattern(column, partial))
        .slice(0, 40)
        .map((column) => ({
          label: `${qualifierLabel}.${column}`,
          insertText: column,
          detail: tableMeta.fullName,
        }));

      return {
        kind: "column",
        replaceStart,
        replaceEnd,
        items,
      };
    }

    const wordMatch = leftText.match(WORD_CONTEXT_REGEX);
    if (!wordMatch) {
      return null;
    }
    const partial = wordMatch[1] ?? "";
    if (!partial) {
      return null;
    }
    const replaceEnd = cursor;
    const replaceStart = cursor - partial.length;
    const tokenPrefix = leftText.slice(0, replaceStart);
    if (tokenPrefix.endsWith(".")) {
      return null;
    }
    if (tableReferences.tables.length === 0) {
      return null;
    }

    const resolvedTables = tableReferences.tables
      .map((reference) => resolveTableMeta(reference))
      .filter((table): table is SqlSchemaTableMeta => Boolean(table));
    if (resolvedTables.length === 0) {
      return null;
    }

    const itemMap = new Map<string, SqlCompletionItem>();
    resolvedTables.forEach((table) => {
      const aliases =
        tableReferences.tableToAliases.get(normalizeQualifiedIdentifier(table.fullName)) ??
        tableReferences.tableToAliases.get(normalizeIdentifierPart(table.table)) ??
        [];
      const preferredQualifier = aliases[0] ?? table.table;
      table.columns.forEach((column) => {
        if (!matchesAutocompletePattern(column, partial)) {
          return;
        }
        const insertText =
          resolvedTables.length > 1 ? `${preferredQualifier}.${column}` : column;
        if (!itemMap.has(insertText)) {
          itemMap.set(insertText, {
            label: insertText,
            insertText,
            detail: table.fullName,
          });
        }
      });
    });

    return {
      kind: "column",
      replaceStart,
      replaceEnd,
      items: Array.from(itemMap.values()).slice(0, 40),
    };
  }, [cursorPosition, editorFocused, query, schemaTables, resolveTableMeta]);

  useEffect(() => {
    setActiveCompletionIndex(0);
  }, [completionContext?.items.length, completionContext?.kind]);

  const result = executeMutation.data;
  const columns = useMemo(() => (result ? result.columns ?? [] : []), [result]);
  const rows = useMemo(() => (result ? result.rows ?? [] : []), [result]);
  const statementType = result?.statementType ?? "read";
  const statementCount = result?.statementCount ?? (result ? 1 : 0);
  const batchResults = result?.results ?? [];
  const affectedCount = result?.affectedCount ?? 0;
  const errorMessage = useMemo(() => {
    if (!executeMutation.isError) {
      return null;
    }
    const error = executeMutation.error;
    if (isAxiosError(error)) {
      return error.response?.data?.message ?? error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "SQL execution failed.";
  }, [executeMutation.error, executeMutation.isError]);

  const hasResults = rows.length > 0;
  const tableHead = useMemo(
    () =>
      columns.map((column) => (
        <Table.Th key={column}>
          <Code fw={500}>{column}</Code>
        </Table.Th>
      )),
    [columns],
  );

  const tableRows = useMemo(
    () =>
      rows.map((row, rowIndex) => (
        <Table.Tr key={`sql-row-${rowIndex}`}>
          <Table.Td>
            <Code>{rowIndex + 1}</Code>
          </Table.Td>
          {columns.map((column) => {
            const value = row[column];
            const stringValue =
              value === null || value === undefined
                ? "NULL"
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value);
            return (
              <Table.Td key={`${column}-${rowIndex}`}>
                <Code>{stringValue}</Code>
              </Table.Td>
            );
          })}
        </Table.Tr>
      )),
    [columns, rows],
  );

  const highlightTokens = useMemo(() => tokenizeSql(query), [query]);

  const handleExecute = () => {
    const trimmed = sanitizeQuery(query);
    if (!trimmed) {
      return;
    }
    const statements = splitTopLevelStatements(trimmed);
    if (statements.length === 0) {
      return;
    }
    const hasWrite = statements.some((statement) => determineStatementType(statement) === "write");
    if (hasWrite) {
      setPendingQuery(trimmed);
      setPendingType("write");
      setConfirmationOpen(true);
      return;
    }
    executeMutation.mutate({ query: trimmed });
  };

  const handleBeautify = () => {
    const trimmed = sanitizeQuery(query);
    if (!trimmed) {
      setBeautifyError("Enter SQL before beautifying.");
      return;
    }
    try {
      const formatted = beautifySql(trimmed);
      setQuery(formatted);
      setCursorPosition(formatted.length);
      setBeautifyError(null);
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.focus();
          editorRef.current.setSelectionRange(formatted.length, formatted.length);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to beautify SQL.";
      setBeautifyError(message);
    }
  };

  const handleEditorScroll = (target: HTMLTextAreaElement) => {
    setEditorScrollTop(target.scrollTop);
    setEditorScrollLeft(target.scrollLeft);
  };

  const applyCompletion = (item: SqlCompletionItem) => {
    if (!completionContext) {
      return;
    }
    const nextQuery =
      query.slice(0, completionContext.replaceStart) +
      item.insertText +
      query.slice(completionContext.replaceEnd);
    const nextCursor = completionContext.replaceStart + item.insertText.length;
    setQuery(nextQuery);
    setCursorPosition(nextCursor);
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        editorRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const completionOpen = editorFocused && Boolean(completionContext?.items.length);

  const handleConfirm = () => {
    if (!pendingQuery) {
      return;
    }
    executeMutation.mutate({ query: pendingQuery });
    setPendingQuery(null);
    setConfirmationOpen(false);
  };

  const handleCancel = () => {
    setConfirmationOpen(false);
    setPendingQuery(null);
  };

  return (
    <Card withBorder shadow="sm" radius="lg">
      <Stack gap="lg">
        <Stack gap={4}>
          <Group gap="xs">
            <IconDatabase size={20} />
            <Title order={4}>SQL Helper</Title>
          </Group>
          <Text size="sm" c="dimmed">
            Run SQL statements against the production database. Administrator access is required.
          </Text>
        </Stack>

        {errorMessage ? (
          <Alert color="red" title="Query failed" icon={<IconAlertTriangle size={16} />}>
            {errorMessage}
          </Alert>
        ) : null}

        <Stack gap="xs">
          <Popover
            opened={completionOpen}
            position="bottom-start"
            width="target"
            withArrow
            shadow="md"
            withinPortal={false}
          >
            <Popover.Target>
              <div>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    SQL query
                  </Text>
                  <Text size="xs" c="dimmed">
                    Supports multiple statements separated by semicolons. Statements run sequentially.
                  </Text>
                </Stack>
                <div
                  style={{
                    position: "relative",
                    marginTop: 6,
                    overflow: "hidden",
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      overflow: "hidden",
                      zIndex: 1,
                    }}
                  >
                    <pre
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        margin: 0,
                        padding: "12px",
                        whiteSpace: "pre-wrap",
                        overflowWrap: "break-word",
                        transform: `translate(${-editorScrollLeft}px, ${-editorScrollTop}px)`,
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        fontSize: 14,
                        lineHeight: 1.55,
                      }}
                    >
                      {query.length === 0
                        ? "SELECT * FROM users LIMIT 20;"
                        : highlightTokens.map((token, tokenIndex) => (
                            <span
                              key={`sql-live-token-${tokenIndex}`}
                              style={{
                                color: TOKEN_COLORS[token.type],
                                fontStyle: token.type === "comment" ? "italic" : "normal",
                                fontWeight: token.type === "keyword" ? 700 : 400,
                              }}
                            >
                              {token.type === "keyword" ? token.value.toUpperCase() : token.value}
                            </span>
                          ))}
                    </pre>
                  </div>
                  <textarea
                    ref={editorRef}
                    value={query}
                    spellCheck={false}
                    onChange={(event) => {
                      setQuery(event.currentTarget.value);
                      setCursorPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                      handleEditorScroll(event.currentTarget);
                      if (beautifyError) {
                        setBeautifyError(null);
                      }
                    }}
                    onFocus={() => setEditorFocused(true)}
                    onBlur={() => {
                      setTimeout(() => {
                        setEditorFocused(false);
                      }, 120);
                    }}
                    onSelect={(event) => {
                      setCursorPosition(event.currentTarget.selectionStart ?? 0);
                    }}
                    onClick={(event) => {
                      setCursorPosition(event.currentTarget.selectionStart ?? 0);
                    }}
                    onKeyUp={(event) => {
                      setCursorPosition(event.currentTarget.selectionStart ?? 0);
                    }}
                    onScroll={(event) => {
                      handleEditorScroll(event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (!completionOpen || !completionContext || completionContext.items.length === 0) {
                        return;
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setActiveCompletionIndex((prev) =>
                          Math.min(prev + 1, completionContext.items.length - 1),
                        );
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setActiveCompletionIndex((prev) => Math.max(prev - 1, 0));
                        return;
                      }
                      if (event.key === "Enter" || event.key === "Tab") {
                        const item =
                          completionContext.items[
                            Math.max(0, Math.min(activeCompletionIndex, completionContext.items.length - 1))
                          ];
                        if (item) {
                          event.preventDefault();
                          applyCompletion(item);
                        }
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditorFocused(false);
                      }
                    }}
                    style={{
                      position: "relative",
                      zIndex: 2,
                      width: "100%",
                      minHeight: 220,
                      padding: "12px",
                      borderRadius: 8,
                      border: editorFocused
                        ? "1px solid var(--mantine-color-blue-5)"
                        : "1px solid var(--mantine-color-gray-4)",
                      background: "transparent",
                      color: "transparent",
                      caretColor: "var(--mantine-color-gray-9)",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                      fontSize: 14,
                      lineHeight: 1.55,
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </Popover.Target>
            <Popover.Dropdown p={0}>
              <ScrollArea h={220}>
                <Stack gap={0}>
                  {completionContext?.items.slice(0, 20).map((item, index) => (
                    <UnstyledButton
                      key={`${item.insertText}-${index}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyCompletion(item);
                      }}
                      style={{
                        padding: "8px 10px",
                        borderBottom: "1px solid var(--mantine-color-gray-2)",
                        background:
                          index === activeCompletionIndex
                            ? "var(--mantine-color-blue-0)"
                            : "transparent",
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <Code>{item.label}</Code>
                        <Text size="xs" c="dimmed">
                          {item.detail}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              </ScrollArea>
            </Popover.Dropdown>
          </Popover>
          {schemaLoading ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Loading SQL autocomplete metadata...
              </Text>
            </Group>
          ) : null}
          {schemaError ? (
            <Alert color="yellow" title="Autocomplete metadata">
              {schemaError}
            </Alert>
          ) : null}
          {beautifyError ? (
            <Alert color="yellow" title="Beautify SQL">
              {beautifyError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={handleBeautify}
              disabled={!query.trim() || executeMutation.isPending}
            >
              Beautify SQL
            </Button>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={handleExecute}
              loading={executeMutation.isPending}
              disabled={!query.trim()}
            >
              Execute
            </Button>
          </Group>
        </Stack>

        {result ? (
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Stack gap={2} style={{ flex: 1 }}>
                <Text size="sm" fw={600}>
                  Result
                </Text>
                <Text size="xs" c="dimmed">
                  {statementCount > 1 ? (
                    <>
                      Executed {statementCount} statements in {result.durationMs} ms. Showing details for all statements.
                    </>
                  ) : statementType === "read" ? (
                    result.truncated ? (
                      <>
                        Showing first {rows.length} of {result.rowCount} rows in {result.durationMs} ms.
                      </>
                    ) : (
                      <>
                        {result.rowCount} row{result.rowCount === 1 ? "" : "s"} returned in {result.durationMs} ms.
                      </>
                    )
                  ) : (
                    <>
                      {STATEMENT_LABELS[statementType]} affected {affectedCount} row
                      {affectedCount === 1 ? "" : "s"} in {result.durationMs} ms.
                    </>
                  )}
                </Text>
              </Stack>
              {statementCount > 1 ? (
                <Badge color="orange" variant="light">
                  BATCH
                </Badge>
              ) : (
                <Badge color={STATEMENT_BADGE_COLOR[statementType]} variant="light">
                  {STATEMENT_LABELS[statementType]}
                </Badge>
              )}
            </Group>
            {statementCount > 1 && batchResults.length > 0 ? (
              <Alert color="orange" radius="md" title="Batch execution summary" icon={<IconDatabase size={16} />}>
                <Text size="sm">
                  {batchResults
                    .map((entry) => `#${entry.index} ${STATEMENT_LABELS[entry.statementType]} (rows: ${entry.rowCount}, affected: ${entry.affectedCount})`)
                    .join(" | ")}
                </Text>
              </Alert>
            ) : null}
            <Divider />
            {statementCount > 1 && batchResults.length > 0 ? (
              <Stack gap="md">
                {batchResults.map((entry) => {
                  const entryColumns =
                    entry.columns.length > 0
                      ? entry.columns
                      : entry.rows.length > 0
                        ? Object.keys(entry.rows[0] ?? {})
                        : [];
                  return (
                    <Card key={`statement-result-${entry.index}`} withBorder radius="md" p="sm">
                      <Stack gap="sm">
                        <Group justify="space-between" align="center">
                          <Text size="sm" fw={600}>
                            Statement #{entry.index}
                          </Text>
                          <Badge color={STATEMENT_BADGE_COLOR[entry.statementType]} variant="light">
                            {STATEMENT_LABELS[entry.statementType]}
                          </Badge>
                        </Group>
                        <Code block>{entry.statement}</Code>
                        {entry.rows.length > 0 ? (
                          <ScrollArea h={220}>
                            <Table highlightOnHover stickyHeader striped>
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>
                                    <Code>#</Code>
                                  </Table.Th>
                                  {entryColumns.map((column) => (
                                    <Table.Th key={`${entry.index}-${column}`}>
                                      <Code fw={500}>{column}</Code>
                                    </Table.Th>
                                  ))}
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {entry.rows.map((row, rowIndex) => (
                                  <Table.Tr key={`statement-${entry.index}-row-${rowIndex}`}>
                                    <Table.Td>
                                      <Code>{rowIndex + 1}</Code>
                                    </Table.Td>
                                    {entryColumns.map((column) => {
                                      const value = row[column];
                                      const stringValue =
                                        value === null || value === undefined
                                          ? "NULL"
                                          : typeof value === "object"
                                            ? JSON.stringify(value)
                                            : String(value);
                                      return (
                                        <Table.Td key={`statement-${entry.index}-${column}-${rowIndex}`}>
                                          <Code>{stringValue}</Code>
                                        </Table.Td>
                                      );
                                    })}
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                        ) : (
                          <Alert color="blue" radius="md" title="Query executed" icon={<IconDatabase size={16} />}>
                            <Text size="sm">
                              {entry.statementType === "read"
                                ? "The query ran successfully but returned no rows."
                                : `The statement completed successfully and affected ${entry.affectedCount} row${
                                    entry.affectedCount === 1 ? "" : "s"
                                  }.`}
                            </Text>
                          </Alert>
                        )}
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            ) : hasResults ? (
              <ScrollArea h={320}>
                <Table highlightOnHover stickyHeader striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        <Code>#</Code>
                      </Table.Th>
                      {tableHead}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>{tableRows}</Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Alert color="blue" radius="md" title="Query executed" icon={<IconDatabase size={16} />}>
                <Text size="sm">
                  {statementType === "read"
                    ? "The query ran successfully but returned no rows."
                    : `The statement completed successfully and affected ${affectedCount} row${
                        affectedCount === 1 ? "" : "s"
                      }.`}
                </Text>
              </Alert>
            )}
          </Stack>
        ) : null}
      </Stack>

      <Modal
        opened={confirmationOpen}
        onClose={handleCancel}
        title="Confirm SQL execution"
        centered
        withinPortal
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">
              You are about to run {STATEMENT_LABELS[pendingType]} statement(s). This operation will modify data in the
              production database and cannot be undone.
            </Text>
          </Alert>
          <Stack gap={4}>
            <Text size="sm" c="dimmed">
              Statement preview
            </Text>
            <Code block>{pendingQuery}</Code>
          </Stack>
          <Group justify="flex-end">
            <Button variant="default" onClick={handleCancel}>
              Cancel
            </Button>
            <Button color="red" leftSection={<IconPlayerPlay size={16} />} onClick={handleConfirm}>
              Run statement
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
};

export default SqlHelperPanel;
