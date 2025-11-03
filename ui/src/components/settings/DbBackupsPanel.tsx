import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  FileInput,
  Group,
  LoadingOverlay,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
  Code,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import dayjs from "dayjs";
import {
  downloadDbBackup,
  useCreateDbBackup,
  useDbBackups,
  useRestoreDbBackup,
  useUploadAndRestoreDbBackup,
  type DbBackup,
  type DbBackupCommandResult,
} from "../../api/dbBackups";
import {
  IconDatabasePlus,
  IconRefresh,
  IconUpload,
  IconDownload,
  IconRotateClockwise,
} from "@tabler/icons-react";

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** exponent;
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[exponent]}`;
};

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const maybeResponse = (error as { response?: { data?: unknown } }).response;
    if (maybeResponse?.data) {
      const { data } = maybeResponse;
      if (typeof data === "string") {
        return data;
      }
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (first && typeof first === "object" && "message" in first && typeof first.message === "string") {
          return first.message;
        }
      }
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred";
};

const DbBackupsPanel = () => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<DbBackupCommandResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<DbBackup | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadOpened, uploadHandlers] = useDisclosure(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useDbBackups();
  const createBackup = useCreateDbBackup();
  const restoreBackup = useRestoreDbBackup();
  const uploadBackup = useUploadAndRestoreDbBackup();

  const busy = createBackup.isPending || restoreBackup.isPending || uploadBackup.isPending;
  const refreshing = isFetching && !isLoading;

  const backups = useMemo(() => data ?? [], [data]);
  const hasBackups = backups.length > 0;

  const resetFeedback = () => {
    setFeedback(null);
    setShowDetails(false);
  };

  const handleRefresh = async () => {
    setErrorMessage(null);
    resetFeedback();
    await refetch();
  };

  const handleCreateBackup = async () => {
    try {
      setErrorMessage(null);
      const outcome = await createBackup.mutateAsync();
      setFeedback(outcome);
      setShowDetails(false);
    } catch (error) {
      setFeedback(null);
      setErrorMessage(extractErrorMessage(error));
    }
  };

  const confirmRestore = (backup: DbBackup) => {
    setRestoreTarget(backup);
  };

  const handleRestore = async () => {
    if (!restoreTarget) {
      return;
    }
    try {
      setErrorMessage(null);
      setRestoring(restoreTarget.filename);
      const outcome = await restoreBackup.mutateAsync({ filename: restoreTarget.filename });
      setFeedback(outcome);
      setShowDetails(false);
      setRestoreTarget(null);
    } catch (error) {
      setFeedback(null);
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setRestoring(null);
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      setErrorMessage(null);
      setDownloading(filename);
      const { blob, suggestedName } = await downloadDbBackup(filename);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = suggestedName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setDownloading(null);
    }
  };

  const openUploadModal = () => {
    setSelectedFile(null);
    uploadHandlers.open();
  };

  const closeUploadModal = () => {
    if (!uploadBackup.isPending) {
      uploadHandlers.close();
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setErrorMessage("Select a backup file to import.");
      return;
    }
    try {
      setErrorMessage(null);
      const outcome = await uploadBackup.mutateAsync(selectedFile);
      setFeedback(outcome);
      setShowDetails(false);
      uploadHandlers.close();
    } catch (error) {
      setFeedback(null);
      setErrorMessage(extractErrorMessage(error));
    }
  };

  const renderTableRows = () =>
    backups.map((backup) => {
      const created = dayjs(backup.createdAt).format("YYYY-MM-DD HH:mm");
      const modified = dayjs(backup.modifiedAt).format("YYYY-MM-DD HH:mm");

      return (
        <Table.Tr key={backup.filename}>
          <Table.Td>
            <Text fw={500}>{backup.filename}</Text>
          </Table.Td>
          <Table.Td>
            <Stack gap={2}>
              <Text size="sm">{created}</Text>
              {created !== modified ? (
                <Text size="xs" c="dimmed">
                  Updated {modified}
                </Text>
              ) : null}
            </Stack>
          </Table.Td>
          <Table.Td>
            <Text size="sm">{formatBytes(backup.sizeBytes)}</Text>
          </Table.Td>
          <Table.Td>
            <Group gap="xs" justify="flex-end">
              <Button
                size="xs"
                variant="default"
                leftSection={<IconDownload size={14} />}
                onClick={() => handleDownload(backup.filename)}
                disabled={busy || downloading === backup.filename}
                loading={downloading === backup.filename}
              >
                Download
              </Button>
              <Button
                size="xs"
                color="orange"
                variant="light"
                leftSection={<IconRotateClockwise size={14} />}
                onClick={() => confirmRestore(backup)}
                disabled={busy}
              >
                Restore
              </Button>
            </Group>
          </Table.Td>
        </Table.Tr>
      );
    });

  return (
    <>
      <Card withBorder radius="lg" padding="lg" shadow="sm">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={6}>
              <Title order={3}>Database Backups</Title>
              <Text size="sm" c="dimmed">
                Review existing PostgreSQL backups, download snapshots, restore previous states, or import a new backup.
              </Text>
            </Stack>
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={handleRefresh}
                disabled={busy}
                loading={refreshing}
              >
                Refresh
              </Button>
              <Button
                variant="light"
                color="grape"
                leftSection={<IconUpload size={16} />}
                onClick={openUploadModal}
                disabled={busy}
              >
                Import & Restore
              </Button>
              <Button
                variant="filled"
                color="blue"
                leftSection={<IconDatabasePlus size={16} />}
                onClick={handleCreateBackup}
                loading={createBackup.isPending}
                disabled={busy}
              >
                Create Backup
              </Button>
            </Group>
          </Group>

          {errorMessage ? (
            <Alert color="red" variant="light" radius="md" title="Request failed">
              {errorMessage}
            </Alert>
          ) : null}

          {feedback ? (
            <Card withBorder padding="md" radius="md" bg="gray.0">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text fw={600}>{feedback.message}</Text>
                  {feedback.storedFilename ? (
                    <Badge color="grape" variant="light">
                      Stored as {feedback.storedFilename}
                    </Badge>
                  ) : null}
                </Stack>
                <Button size="xs" variant="subtle" onClick={() => setShowDetails((prev) => !prev)}>
                  {showDetails ? "Hide details" : "Show details"}
                </Button>
              </Group>
              <Collapse in={showDetails}>
                <Stack gap="sm" mt="sm">
                  <Text size="xs" c="dimmed">
                    Command: <Code>{[feedback.result.command, ...feedback.result.args].join(" ")}</Code>
                  </Text>
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>
                      Stdout
                    </Text>
                    <ScrollArea h={160} type="always">
                      <Code block>{feedback.result.stdout.trim().length > 0 ? feedback.result.stdout : "(empty)"}</Code>
                    </ScrollArea>
                  </Stack>
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>
                      Stderr
                    </Text>
                    <ScrollArea h={160} type="always">
                      <Code block>{feedback.result.stderr.trim().length > 0 ? feedback.result.stderr : "(empty)"}</Code>
                    </ScrollArea>
                  </Stack>
                  <Badge color={feedback.result.exitCode === 0 ? "green" : "red"} variant="light" w="fit-content">
                    Exit code: {feedback.result.exitCode ?? "unknown"}
                  </Badge>
                </Stack>
              </Collapse>
            </Card>
          ) : null}

          <Box pos="relative">
            <LoadingOverlay visible={isLoading || refreshing} />
            {hasBackups ? (
              <Table striped highlightOnHover withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Filename</Table.Th>
                    <Table.Th>Created</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>{renderTableRows()}</Table.Tbody>
              </Table>
            ) : (
              <Card radius="md" withBorder padding="xl">
                <Stack gap="xs" align="center">
                  <Text fw={600}>No backups found</Text>
                  <Text size="sm" c="dimmed" ta="center">
                    Generate a new snapshot to populate this list or import an existing backup.
                  </Text>
                </Stack>
              </Card>
            )}
          </Box>
        </Stack>
      </Card>

      <Modal
        opened={restoreTarget != null}
        onClose={() => setRestoreTarget(null)}
        title="Restore database"
        centered
        closeOnClickOutside={!restoreBackup.isPending}
        closeOnEscape={!restoreBackup.isPending}
      >
        <Stack gap="md">
          <Text size="sm">
            This will drop and recreate objects before loading{" "}
            <Text component="span" fw={600}>
              {restoreTarget?.filename}
            </Text>
            . The operation cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRestoreTarget(null)} disabled={restoreBackup.isPending}>
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={handleRestore}
              loading={restoring === restoreTarget?.filename && restoreBackup.isPending}
            >
              Restore
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={uploadOpened}
        onClose={closeUploadModal}
        title="Import backup & restore"
        centered
        closeOnClickOutside={!uploadBackup.isPending}
        closeOnEscape={!uploadBackup.isPending}
      >
        <Stack gap="md">
          <Text size="sm">
            Select a <Code>.backup</Code> file to upload. The system will restore it immediately and archive a copy on
            the server.
          </Text>
          <FileInput
            label="Backup file"
            placeholder="Choose a .backup file"
            accept=".backup"
            value={selectedFile}
            onChange={setSelectedFile}
            disabled={uploadBackup.isPending}
            clearable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeUploadModal} disabled={uploadBackup.isPending}>
              Cancel
            </Button>
            <Button color="grape" onClick={handleUpload} loading={uploadBackup.isPending}>
              Upload & Restore
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export default DbBackupsPanel;
