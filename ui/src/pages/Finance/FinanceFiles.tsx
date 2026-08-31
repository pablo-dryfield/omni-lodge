import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Group,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconExternalLink,
  IconFile,
  IconFileInvoice,
  IconFolders,
  IconPhoto,
  IconRefresh,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchFinanceFiles } from "../../actions/financeActions";
import { selectFinanceFiles } from "../../selectors/financeSelectors";
import {
  FinanceEmptyState,
  FinanceErrorState,
  FinanceLoadingState,
  FinancePageHeader,
  FinancePanel,
  FinanceRecordCard,
  FinanceToolbar,
  financePageClass,
} from "../../components/finance/FinanceUi";
import { formatFinanceDate } from "../../components/finance/financeFormatters";
import type { FinanceFile } from "../../types/finance";

type FileKind = "pdf" | "image" | "document" | "other";

const getFileKind = (file: FinanceFile): FileKind => {
  const mimeType = file.mimeType.toLowerCase();
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.includes("document") || mimeType.includes("sheet") || mimeType.startsWith("text/")) {
    return "document";
  }
  return "other";
};

const getFileIcon = (file: FinanceFile) => {
  const kind = getFileKind(file);
  if (kind === "pdf") {
    return <IconFileInvoice size={17} />;
  }
  if (kind === "image") {
    return <IconPhoto size={17} />;
  }
  return <IconFile size={17} />;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const FinanceFiles = () => {
  const dispatch = useAppDispatch();
  const files = useAppSelector(selectFinanceFiles);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<FileKind | null>(null);

  useEffect(() => {
    void dispatch(fetchFinanceFiles());
  }, [dispatch]);

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.items.filter((file) => {
      if (kindFilter && getFileKind(file) !== kindFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [file.originalName, file.mimeType, String(file.id)]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [files.items, kindFilter, search]);

  const renderViewButton = (file: FinanceFile, compact = false) => (
    <Button
      component="a"
      href={file.driveWebViewLink}
      target="_blank"
      rel="noopener noreferrer"
      variant="light"
      size={compact ? "xs" : "sm"}
      leftSection={<IconExternalLink size={15} />}
      aria-label={`Open ${file.originalName} in a new tab`}
    >
      View file
    </Button>
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        title="Finance files"
        description="Find invoices, receipts, and supporting documents attached to finance records."
        icon={<IconFolders size={24} />}
        actions={
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void dispatch(fetchFinanceFiles())}
            loading={files.loading}
          >
            Refresh files
          </Button>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by file name, type, or ID"
      >
        <Select
          placeholder="All file types"
          aria-label="Filter finance files by type"
          data={[
            { value: "pdf", label: "PDF files" },
            { value: "image", label: "Images" },
            { value: "document", label: "Documents" },
            { value: "other", label: "Other files" },
          ]}
          value={kindFilter}
          onChange={(value) => setKindFilter((value as FileKind | null) ?? null)}
          clearable
          style={{ flex: "1 1 190px", maxWidth: isMobile ? undefined : 230 }}
        />
      </FinanceToolbar>

      <FinancePanel
        title="Document library"
        description={`${visibleFiles.length} of ${files.items.length} files shown`}
        noPadding
      >
        {files.error ? (
          <FinanceErrorState
            message={files.error}
            onRetry={() => void dispatch(fetchFinanceFiles())}
          />
        ) : files.loading && files.items.length === 0 ? (
          <FinanceLoadingState label="Loading finance files" />
        ) : visibleFiles.length === 0 ? (
          <FinanceEmptyState
            icon={<IconFolders size={25} />}
            title={files.items.length === 0 ? "No files uploaded yet" : "No matching files"}
            description={
              files.items.length === 0
                ? "Invoices and receipts uploaded from finance workflows will be collected here."
                : "Try another search or clear the file type filter."
            }
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {visibleFiles.map((file) => (
              <FinanceRecordCard
                key={file.id}
                leading={
                  <ThemeIcon variant="light" color="blue" radius="md">
                    {getFileIcon(file)}
                  </ThemeIcon>
                }
                title={file.originalName}
                subtitle={`File #${file.id}`}
                fields={[
                  { label: "Uploaded", value: formatFinanceDate(file.uploadedAt, true) },
                  { label: "Size", value: formatFileSize(file.sizeBytes) },
                  { label: "Type", value: file.mimeType },
                ]}
                actions={renderViewButton(file, true)}
              />
            ))}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>File</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th ta="right">Size</Table.Th>
                  <Table.Th>Uploaded</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleFiles.map((file) => (
                  <Table.Tr key={file.id}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <ThemeIcon variant="light" color="blue" radius="md">
                          {getFileIcon(file)}
                        </ThemeIcon>
                        <Stack gap={1} style={{ minWidth: 0 }}>
                          <Text fw={700} lineClamp={1}>{file.originalName}</Text>
                          <Text size="xs" c="dimmed">File #{file.id}</Text>
                        </Stack>
                      </Group>
                    </Table.Td>
                    <Table.Td>{file.mimeType}</Table.Td>
                    <Table.Td ta="right">{formatFileSize(file.sizeBytes)}</Table.Td>
                    <Table.Td>{formatFinanceDate(file.uploadedAt, true)}</Table.Td>
                    <Table.Td ta="right">{renderViewButton(file)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </FinancePanel>
    </Stack>
  );
};

export default FinanceFiles;
