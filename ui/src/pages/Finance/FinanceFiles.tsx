import { useEffect } from "react";
import { Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import dayjs from "dayjs";
import { IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchFinanceFiles } from "../../actions/financeActions";
import { selectFinanceFiles } from "../../selectors/financeSelectors";

const FinanceFiles = () => {
  const dispatch = useAppDispatch();
  const files = useAppSelector(selectFinanceFiles);

  useEffect(() => {
    dispatch(fetchFinanceFiles());
  }, [dispatch]);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Files</Title>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={() => dispatch(fetchFinanceFiles())}
          loading={files.loading}
        >
          Refresh
        </Button>
      </Group>
      <Table striped highlightOnHover withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th ta="right">Size</Table.Th>
            <Table.Th>Uploaded</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {files.items.map((file) => (
            <Table.Tr key={file.id}>
              <Table.Td>{file.originalName}</Table.Td>
              <Table.Td>{file.mimeType}</Table.Td>
              <Table.Td ta="right">{(file.sizeBytes / 1024).toFixed(1)} KB</Table.Td>
              <Table.Td>{dayjs(file.uploadedAt).format("YYYY-MM-DD HH:mm")}</Table.Td>
              <Table.Td width={120}>
                <Button
                  component="a"
                  href={file.driveWebViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="light"
                  leftSection={<IconExternalLink size={16} />}
                >
                  View
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
          {files.items.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text size="sm" c="dimmed">
                  No files uploaded yet.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
};

export default FinanceFiles;



