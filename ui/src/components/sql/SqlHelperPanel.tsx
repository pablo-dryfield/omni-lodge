import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconDatabase, IconPlayerPlay } from "@tabler/icons-react";
import type { AxiosError } from "axios";
import { useExecuteSql, type SqlStatementType } from "../../api/sqlHelper";

const DEFAULT_QUERY = "SELECT NOW();";

const STATEMENT_LABELS: Record<SqlStatementType, string> = {
  read: "READ",
  update: "UPDATE",
  delete: "DELETE",
};

const STATEMENT_BADGE_COLOR: Record<SqlStatementType, string> = {
  read: "blue",
  update: "orange",
  delete: "red",
};

const sanitizeQuery = (value: string) => value.trim().replace(/;+$/u, "").trim();

const determineStatementType = (raw: string): SqlStatementType => {
  const value = sanitizeQuery(raw);
  const firstToken = value.split(/\s+/u)[0]?.toLowerCase() ?? "";
  if (["update"].includes(firstToken)) {
    return "update";
  }
  if (["delete"].includes(firstToken)) {
    return "delete";
  }
  return "read";
};

const isAxiosError = (value: unknown): value is AxiosError<{ message?: string }> =>
  typeof value === "object" && value !== null && "isAxiosError" in value;

const SqlHelperPanel = () => {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<SqlStatementType>("read");
  const executeMutation = useExecuteSql();

  const result = executeMutation.data;
  const columns = useMemo(() => (result ? result.columns ?? [] : []), [result]);
  const rows = useMemo(() => (result ? result.rows ?? [] : []), [result]);
  const statementType = result?.statementType ?? "read";
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

  const handleExecute = () => {
    const trimmed = sanitizeQuery(query);
    if (!trimmed) {
      return;
    }
    const type = determineStatementType(trimmed);
    if (type === "update" || type === "delete") {
      setPendingQuery(trimmed);
      setPendingType(type);
      setConfirmationOpen(true);
      return;
    }
    executeMutation.mutate({ query: trimmed });
  };

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
            Run read-only <Code>SELECT</Code> queries against the production database. Updates or multi-statement queries
            are blocked for safety.
          </Text>
        </Stack>

        {errorMessage ? (
          <Alert color="red" title="Query failed" icon={<IconAlertTriangle size={16} />}>
            {errorMessage}
          </Alert>
        ) : null}

        <Stack gap="xs">
          <Textarea
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            minRows={6}
            autosize
            placeholder="SELECT * FROM users LIMIT 20;"
            label="SQL query"
            description="Only SELECT, WITH, SHOW, or EXPLAIN statements are allowed."
            styles={{ input: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" } }}
          />
          <Group justify="flex-end">
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
                  {statementType === "read" ? (
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
              <Badge color={STATEMENT_BADGE_COLOR[statementType]} variant="light">
                {STATEMENT_LABELS[statementType]}
              </Badge>
            </Group>
            <Divider />
            {hasResults ? (
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
              You are about to run a {STATEMENT_LABELS[pendingType]} statement. This operation will modify data in the
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
