import React, { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Paper,
  Container,
  Box,
  Table,
  Text,
  Center,
  Loader,
  Button,
  Alert,
  Stack,
  Group,
  ScrollArea,
  Badge,
  Title,
  useMantineTheme,
} from '@mantine/core';
import { DatePicker } from '@mui/x-date-pickers';
import { Dayjs } from 'dayjs';
import { type Pay, type PayBreakdown, type PayComponentSummary } from '../types/pays/Pay';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchPays } from '../actions/payActions';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import { useMediaQuery } from '@mantine/hooks';

const formatCurrency = (value: number | undefined): string => {
  const numberPart = (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${numberPart} zł`;
};

const getComponentColor = (category: string) => {
  switch (category) {
    case 'base':
      return 'blue';
    case 'commission':
      return 'green';
    case 'incentive':
      return 'violet';
    case 'bonus':
      return 'grape';
    case 'review':
      return 'teal';
    case 'adjustment':
      return 'yellow';
    case 'deduction':
      return 'red';
    default:
      return 'gray';
  }
};

const normalizeTotal = (summary: Pay) => summary.totalPayout ?? summary.totalCommission;

const FULL_ACCESS_MODULE = 'staff-payouts-all';
const SELF_ACCESS_MODULE = 'staff-payouts-self';
const PAGE_SLUG = PAGE_SLUGS.pays;

const renderComponentList = (components?: PayComponentSummary[]) => {
  if (!components || components.length === 0) {
    return null;
  }
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Components
      </Text>
      <Stack gap={4}>
        {components.map((component) => (
          <Group key={component.componentId} justify="space-between" gap="xs">
            <Group gap={6}>
              <Badge color={getComponentColor(component.category)} variant="light">
                {component.category}
              </Badge>
              <Text size="sm">{component.name}</Text>
            </Group>
            <Text size="sm" fw={600}>
              {formatCurrency(component.amount)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
};

const renderBucketTotals = (bucketTotals?: Record<string, number>) => {
  if (!bucketTotals || Object.keys(bucketTotals).length === 0) {
    return null;
  }
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Bucket totals
      </Text>
      <Stack gap={4}>
        {Object.entries(bucketTotals).map(([bucket, amount]) => (
          <Group key={bucket} justify="space-between">
            <Badge variant="outline" color={getComponentColor(bucket)}>
              {bucket}
            </Badge>
            <Text size="sm">{formatCurrency(amount)}</Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
};

const renderBreakdownTable = (items: PayBreakdown[]) => (
  <Table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead>
      <tr>
        <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Date</th>
        <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Customers</th>
        <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Guides</th>
        <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Commission</th>
      </tr>
    </thead>
    <tbody>
      {items.map((entry) => (
        <tr key={`${entry.date}-${entry.guidesCount}`}>
          <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>{entry.date}</td>
          <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.customers}</td>
          <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.guidesCount}</td>
          <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{formatCurrency(entry.commission)}</td>
        </tr>
      ))}
    </tbody>
  </Table>
);

const Pays: React.FC = () => {
  const dispatch = useAppDispatch();
  const payState = useAppSelector((state) => state.pays)[0];
  const { data: responseData, loading, error } = payState;

  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const fullAccess = useModuleAccess(FULL_ACCESS_MODULE);
  const selfAccess = useModuleAccess(SELF_ACCESS_MODULE);

  const summaries: Pay[] = useMemo(() => responseData?.[0]?.data ?? [], [responseData]);

  const permissionsReady = fullAccess.ready || selfAccess.ready;
  const permissionsLoading = fullAccess.loading || selfAccess.loading;
  const canViewFull = fullAccess.ready && fullAccess.canView;
  const canViewSelf = selfAccess.ready && selfAccess.canView;
  const usingSelfScope = !canViewFull && canViewSelf;

  const scopeParam = usingSelfScope ? 'self' : undefined;

  useEffect(() => {
    if (!permissionsReady || permissionsLoading) {
      return;
    }

    if (!(canViewFull || canViewSelf)) {
      return;
    }

    if (startDate && endDate) {
      const start = startDate.format('YYYY-MM-DD');
      const end = endDate.format('YYYY-MM-DD');
      void dispatch(fetchPays({ startDate: start, endDate: end, scope: scopeParam }));
    }
  }, [startDate, endDate, dispatch, permissionsReady, permissionsLoading, canViewFull, canViewSelf, scopeParam]);

  const toggleRow = (index: number) => {
    setExpandedRow((prev) => (prev === index ? null : index));
  };

  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.md})`);

  const renderMobileCards = () => (
    <Stack gap="md">
      {summaries.map((item, index) => {
        const expanded = expandedRow === index;
        const total = normalizeTotal(item);
        return (
          <Paper key={item.userId ?? index} shadow="sm" radius="lg" p="md" withBorder>
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>{item.firstName}</Title>
                  <Text size="sm" c="dimmed">
                    Total payout
                  </Text>
                  <Title order={5}>{formatCurrency(total)}</Title>
                </div>
                <Badge color="blue" variant="light">
                  {item.breakdown.length} {item.breakdown.length === 1 ? 'entry' : 'entries'}
                </Badge>
              </Group>

              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Commission
                  </Text>
                  <Text fw={600}>{formatCurrency(item.totalCommission)}</Text>
                </Group>
                {renderComponentList(item.componentTotals)}
                {renderBucketTotals(item.bucketTotals)}
              </Stack>

              {item.breakdown.length > 0 && (
                <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                  {expanded ? 'Hide breakdown' : 'Show breakdown'}
                </Button>
              )}

              {expanded && item.breakdown.length > 0 && (
                <Box pt="xs">{renderBreakdownTable(item.breakdown)}</Box>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );

  const renderDesktopTable = () => {
    const totalCommission = summaries.reduce((sum, item) => sum + item.totalCommission, 0);
    const totalPayout = summaries.reduce((sum, item) => sum + normalizeTotal(item), 0);
    return (
      <ScrollArea>
        <Table striped highlightOnHover withRowBorders style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Commission</th>
              <th style={{ padding: 12 }}>Total payout</th>
              <th style={{ padding: 12 }} />
            </tr>
          </thead>
          <tbody>
            {summaries.map((item, index) => (
              <Fragment key={item.userId ?? index}>
                <tr>
                  <td style={{ padding: 12 }}>{item.firstName}</td>
                  <td style={{ padding: 12 }}>{formatCurrency(item.totalCommission)}</td>
                  <td style={{ padding: 12 }}>{formatCurrency(normalizeTotal(item))}</td>
                  <td style={{ padding: 12, textAlign: 'right' }}>
                    {item.breakdown.length > 0 && (
                      <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                        {expandedRow === index ? 'Hide breakdown' : 'Show breakdown'}
                      </Button>
                    )}
                  </td>
                </tr>
                {expandedRow === index && (
                  <tr>
                    <td colSpan={4} style={{ backgroundColor: '#fafafa', padding: '12px 8px' }}>
                      <Stack gap="md">
                        {renderBucketTotals(item.bucketTotals)}
                        {renderComponentList(item.componentTotals)}
                        {item.breakdown.length > 0 && renderBreakdownTable(item.breakdown)}
                      </Stack>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr>
              <td style={{ padding: 12 }}>
                <strong>Total</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(totalCommission)}</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(totalPayout)}</strong>
              </td>
              <td />
            </tr>
          </tbody>
        </Table>
      </ScrollArea>
    );
  };

  let content: React.ReactNode;

  if (!permissionsReady || permissionsLoading) {
    content = (
      <Center style={{ height: '60vh' }}>
        <Loader variant="dots" />
      </Center>
    );
  } else if (!(canViewFull || canViewSelf)) {
    content = (
      <Container size={600} my={40}>
        <Alert color="yellow" title="No access">
          You do not have permission to view staff payment details.
        </Alert>
      </Container>
    );
  } else {
    content = (
      <Container fluid={!isDesktop} size={isDesktop ? 780 : undefined} my={isDesktop ? 40 : 16} px={isDesktop ? 'md' : 'sm'}>
        <Paper radius={isDesktop ? 12 : 'lg'} p={isDesktop ? 'xl' : 'md'} withBorder>
          <Stack gap="md">
            {usingSelfScope && (
              <Alert color="blue" title="Personal view">
                You are viewing your own payouts only.
              </Alert>
            )}

            <Stack gap={isDesktop ? 'lg' : 'sm'}>
              <Group
                justify={isDesktop ? 'space-between' : 'flex-start'}
                align={isDesktop ? 'center' : 'stretch'}
                gap={isDesktop ? 'lg' : 'sm'}
                wrap="wrap"
              >
                <DatePicker
                  label="Start Date"
                  format="YYYY-MM-DD"
                  value={startDate}
                  onChange={(newValue: Dayjs | null) => setStartDate(newValue)}
                  style={{ flex: isDesktop ? 1 : 'unset', width: isDesktop ? 'auto' : '100%' }}
                />
                <DatePicker
                  label="End Date"
                  format="YYYY-MM-DD"
                  value={endDate}
                  onChange={(newValue: Dayjs | null) => setEndDate(newValue)}
                  style={{ flex: isDesktop ? 1 : 'unset', width: isDesktop ? 'auto' : '100%' }}
                />
              </Group>

              {loading && (
                <Center>
                  <Loader size="lg" />
                </Center>
              )}

              {error && (
                <Text c="red" ta="center">
                  {error}
                </Text>
              )}

              {!loading && !error && summaries.length > 0 && (isDesktop ? renderDesktopTable() : renderMobileCards())}

              {!loading && !error && summaries.length === 0 && (
                <Text ta="center">No data available for the selected dates.</Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return <PageAccessGuard pageSlug={PAGE_SLUG}>{content}</PageAccessGuard>;
};

export default Pays;
