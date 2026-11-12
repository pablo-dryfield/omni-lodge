import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconChevronDown } from "@tabler/icons-react";
import { useSearchConsolePerformance, type SearchConsolePerformanceResult } from "../../api/searchConsole";

export const ReportDateCoverage = ({coverage}: {coverage?: SearchConsolePerformanceResult["dateCoverage"]}) => (
  coverage?.startsBeforeHistoryBoundary || coverage?.endsInFuture ?
    <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Date range may be incomplete">
      {coverage.startsBeforeHistoryBoundary ? `This range starts before Google's approximate 16-month history boundary (${coverage.historyBoundaryDate}). Older data may be unavailable, so returned metrics may cover only part of the requested range. ` : ""}
      {coverage.endsInFuture ? "This range includes future dates, which cannot contain observed data. " : ""}
      Choose comparable dates within the available history or use a previously retained export.
    </Alert> : null
);

export const ReportCoverage = ({ report, heuristic = false, note = true }: { report: ReturnType<typeof useSearchConsolePerformance>; heuristic?: boolean; note?: boolean }) => (
  <Stack gap="xs">
    {report.isError ? <Alert color="red" icon={<IconAlertCircle size={16} />} title="Report unavailable">Refresh this report. No conclusions can be drawn from missing data.</Alert> : null}
    {report.data ? <>
      <ReportDateCoverage coverage={report.data.dateCoverage} />
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
