import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconChevronDown } from "@tabler/icons-react";
import { useSearchConsolePerformance } from "../../api/searchConsole";

export const ReportCoverage = ({ report, heuristic = false, note = true }: { report: ReturnType<typeof useSearchConsolePerformance>; heuristic?: boolean; note?: boolean }) => (
  <Stack gap="xs">
    {report.isError ? <Alert color="red" icon={<IconAlertCircle size={16} />} title="Report unavailable">Refresh this report. No conclusions can be drawn from missing data.</Alert> : null}
    {report.data ? <>
      <Group justify="space-between" wrap="wrap">
        <Text size="xs" c="dimmed">
          {report.data.dimensions.join(" + ")}: {report.data.rows.length} detail rows loaded. {report.hasNextPage ? "More rows available." : "End of returned rows."}
          {" "}Detail aggregation: {report.data.detailAggregation}. Finalized data, Pacific dates.
        </Text>
        {report.hasNextPage ? <Button size="xs" variant="subtle" leftSection={<IconChevronDown size={14} />} loading={report.isFetchingNextPage} onClick={() => report.fetchNextPage()}>Load more rows</Button> : null}
      </Group>
      {note ? <Text size="xs" c="dimmed">Google omits anonymized queries and limits detail rows. These rows are not complete property totals.{heuristic ? " Suggestions are heuristics for the loaded rows, not proof of missing content or indexing problems." : ""}</Text> : null}
    </> : null}
  </Stack>
);
