import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Card,
  SimpleGrid,
  Select,
  ActionIcon,
  Collapse,
  Modal,
  NumberInput,
  Textarea,
  TextInput,
  Switch,
  Checkbox,
  Accordion,
  Tooltip,
  Image,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import {
  type Pay,
  type PayComponentSummary,
  type PlatformGuestTierBreakdown,
  type LockedComponentSummary,
  type PayReimbursementEntry,
  type PayRecordedEntry,
  type PayPayoutReceiptDetail,
  type PayPayoutReceiptHistoryEntry,
  type PayPayoutReceiptHistoryResponse,
} from '../types/pays/Pay';
import type { CompensationComponent } from '../types/compensation/CompensationComponent';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchPays } from '../actions/payActions';
import {
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceVendors,
} from '../actions/financeActions';
import { fetchCompensationComponents } from '../actions/compensationComponentActions';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import { useMediaQuery } from '@mantine/hooks';
import axiosInstance from '../utils/axiosInstance';
import { updateReviewMonthlyApproval } from '../api/reviewCounters';
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceVendors,
} from '../selectors/financeSelectors';
import type { FinanceVendor, FinanceCategory } from '../types/finance';
import type { ServerResponse } from '../types/general/ServerResponse';
import { IconChevronLeft, IconChevronRight, IconHistory, IconReceipt, IconTrash } from '@tabler/icons-react';
import {
  buildPayReceiptHistoryLookupParams,
  canOpenPayReceipt,
  getPayReceiptHistoryEvent,
  getPayReceiptHistoryStatusMeta,
  getPayReceiptStatusMeta,
} from './paysReceiptUtils';
import TaskCompletionDailyBreakdown from '../components/pays/TaskCompletionDailyBreakdown';
import FinanceInfoButton from '../components/finance/FinanceInfoButton';

const EARLIEST_DATA_DATE = dayjs('2020-01-01');
const DEFAULT_CURRENCY = 'PLN';
const URL_DATE_FORMAT = 'YYYY-MM-DD';
const URL_PRESET_PARAM = 'preset';
const URL_START_DATE_PARAM = 'startDate';
const URL_END_DATE_PARAM = 'endDate';

type DatePreset = 'this_month' | 'last_month' | 'custom';

type IncentiveBadgeDetail = {
  letter: string;
  name: string;
  amount: number | null;
};

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];

const isDatePreset = (value: string | null): value is DatePreset =>
  value === 'this_month' || value === 'last_month' || value === 'custom';

const parseUrlDate = (value: string | null): Dayjs | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
};

const formatCurrency = (value: number | undefined, currencyCode?: string): string => {
  const numberPart = (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (currencyCode && currencyCode.trim().length > 0) {
    return `${currencyCode.trim().toUpperCase()} ${numberPart}`;
  }
  return `${numberPart} zł`;
};

const formatRangeLabel = (start: string, end: string) =>
  `${dayjs(start).format('MMM D, YYYY')} - ${dayjs(end).format('MMM D, YYYY')}`;

const formatDateTimeLabel = (value: string | null | undefined) => {
  if (!value) {
    return 'Not recorded';
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MMM D, YYYY HH:mm') : value;
};

type PayStaffIdentity = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  userId?: number | null;
};

const normalizeStaffNamePart = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/\s+/g, ' ');

export const formatPayStaffName = (
  staff: PayStaffIdentity | null | undefined,
  fallback = 'Staff member',
): string => {
  const explicitFullName = normalizeStaffNamePart(staff?.fullName);
  if (explicitFullName) {
    return explicitFullName;
  }

  const composedName = [staff?.firstName, staff?.lastName]
    .map(normalizeStaffNamePart)
    .filter(Boolean)
    .join(' ');
  if (composedName) {
    return composedName;
  }

  const userId = Number(staff?.userId);
  if (Number.isInteger(userId) && userId > 0) {
    return `Staff #${userId}`;
  }

  return normalizeStaffNamePart(fallback) || 'Staff member';
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

const resolveGrossCompensationTotal = (summary: Pay) =>
  summary.grossCompensationTotal
  ?? roundLineAmount(
    normalizeTotal(summary)
      + (summary.volunteerFundAllocationTotal ?? 0)
      + (summary.excludedSettlementTotal ?? 0),
  );

const humanizeErrorMessage = (rawMessage?: string | null): { title: string; description: string; details?: string } => {
  const defaultDescription = 'Please adjust the selected period or try again in a moment.';
  if (!rawMessage) {
    return {
      title: 'Unable to load payouts',
      description: defaultDescription,
    };
  }
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes('forbidden') || normalized.includes('unauthorized') || normalized.includes('401') || normalized.includes('403')) {
    return {
      title: 'Access restricted',
      description: 'You do not have permission to view payouts for this range. Switch to the self scope or contact an administrator.',
      details: rawMessage,
    };
  }
  if (normalized.includes('network') || normalized.includes('timeout')) {
    return {
      title: 'Network error',
      description: 'We could not reach the server. Check your connection and try again.',
      details: rawMessage,
    };
  }
  if (normalized.includes('not found')) {
    return {
      title: 'No data available',
      description: 'We could not find payouts for the selected dates.',
      details: rawMessage,
    };
  }
  return {
    title: 'Unable to load payouts',
    description: defaultDescription,
    details: rawMessage,
  };
};

const calculatePresetRange = (preset: DatePreset, reference: Dayjs = dayjs()): { start: Dayjs; end: Dayjs } => {
  const today = reference.endOf('day');
  const clampStart = (value: Dayjs) => (value.isBefore(EARLIEST_DATA_DATE) ? EARLIEST_DATA_DATE.startOf('day') : value);

  switch (preset) {
    case 'last_month': {
      const start = today.subtract(1, 'month').startOf('month');
      return { start: clampStart(start), end: start.endOf('month') };
    }
    case 'this_month':
    default:
      return { start: clampStart(today.startOf('month')), end: today.endOf('month') };
  }
};

const FULL_ACCESS_MODULE = 'staff-payouts-all';
const SELF_ACCESS_MODULE = 'staff-payouts-self';
const PAGE_SLUG = PAGE_SLUGS.pays;

const KPI_CARD_STYLE: React.CSSProperties = {
  minHeight: 104,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
};

const PAY_KPI_HELP = {
  lastMonthBalance:
    'Unpaid personal staff balance carried into the selected period from the previous payout ledger.',
  grossCompensation:
    'Compensation earned in the selected period before it is routed between personal staff pay, Volunteer Funds, or exclusions.',
  payToStaff:
    'Compensation from the selected period that is payable personally to staff. Volunteer Fund allocations are shown separately.',
  volunteerFund:
    'Compensation routed to the internal Volunteer Fund instead of being paid personally to staff.',
  alreadyPaid:
    'Personal staff payments already recorded against the selected period. Volunteer Fund allocations are tracked separately.',
  outstanding:
    'Personal amount still owed: the carried balance plus current pay to staff, less recorded staff payments.',
} as const;

const PAY_TABLE_HEADER_HELP: Record<string, string> = {
  Name: 'The staff member whose compensation, balances, routing, and payment actions are shown in this row.',
  'Last Months Owed': 'The unpaid personal balance carried into this period from the staff member\'s previous payout ledger.',
  'Gross compensation': 'Everything earned in this period before routing amounts to personal staff pay, Volunteer Funds, or exclusions.',
  'Pay to staff': 'The current-period amount routed for personal payment to this staff member.',
  'Volunteer Fund': 'The current-period amount routed to an internal Volunteer Fund, including what is allocated and still to allocate.',
  Paid: 'Personal payments already recorded for this staff member and payout period.',
  Outstanding: 'The personal balance still owed after carried balances, current pay, and recorded payments are combined.',
  Actions: 'Available payout, receipt-history, and detail actions for this staff member. Access depends on your permissions.',
};

const renderPayInfoLabel = (
  label: string,
  description: string,
  options: { dimmed?: boolean; size?: 'xs' | 'sm' } = {},
) => (
  <Group
    gap={5}
    justify="center"
    wrap="nowrap"
    style={{ minWidth: 0, maxWidth: '100%' }}
  >
    <Text
      component="span"
      size={options.size ?? 'sm'}
      c={options.dimmed ? 'dimmed' : undefined}
      ta="center"
      style={{ minWidth: 0, lineHeight: 1.2 }}
    >
      {label}
    </Text>
    <FinanceInfoButton label={label} description={description} />
  </Group>
);
const BREAKDOWN_ROW_STYLE: React.CSSProperties = {
  padding: '8px 0',
  borderBottom: '1px solid var(--mantine-color-gray-2)',
};
const BREAKDOWN_ROW_CENTER_STYLE: React.CSSProperties = {
  width: '100%',
  alignItems: 'center',
  textAlign: 'center',
};
const BREAKDOWN_ROW_HEADER_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '116px minmax(0, 1fr)',
  columnGap: 8,
  alignItems: 'center',
  width: 'min(100%, 310px)',
  margin: '0 auto',
};
const BREAKDOWN_ROW_BADGE_STYLE: React.CSSProperties = {
  justifySelf: 'end',
  width: 108,
  display: 'flex',
  justifyContent: 'center',
};
const BREAKDOWN_ROW_TITLE_STYLE: React.CSSProperties = {
  minWidth: 0,
  justifySelf: 'start',
  textAlign: 'left',
};
const DESKTOP_FIXED_TABLE_HEADER_TOP = 69;

type DetailAccordionSectionProps = {
  title: string;
  description?: string;
  rightSection?: React.ReactNode;
  children: React.ReactNode;
};

const DetailAccordionSection: React.FC<DetailAccordionSectionProps> = ({
  title,
  description,
  rightSection,
  children,
}) => (
  <Accordion variant="contained" radius="md">
    <Accordion.Item value="content">
      <Accordion.Control>
        <Box style={{ position: 'relative', minHeight: description ? 36 : 20 }}>
          <Stack gap={0} align="center" style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} ta="center">
              {title}
            </Text>
            {description && (
              <Text size="xs" c="dimmed" ta="center">
                {description}
              </Text>
            )}
          </Stack>
          {rightSection && (
            <Box
              style={{
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              {rightSection}
            </Box>
          )}
        </Box>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="xs">{children}</Stack>
      </Accordion.Panel>
    </Accordion.Item>
  </Accordion>
);

type ComponentListItemProps = {
  component: PayComponentSummary;
  breakdown: PlatformGuestTierBreakdown[];
  showPlatformTotals: boolean;
  platformGuestTotals?: { totalGuests: number; totalBooked: number; totalAttended: number };
  salaryRecipientUserId?: number | null;
};

const ComponentListItem: React.FC<ComponentListItemProps> = ({
  component,
  breakdown,
  showPlatformTotals,
  platformGuestTotals,
  salaryRecipientUserId,
}) => {
  const [showBaseDays, setShowBaseDays] = useState(false);
  const [showPlatformDetails, setShowPlatformDetails] = useState(false);
  const explicitBaseDays = Array.isArray(component.baseDays) ? component.baseDays.filter(Boolean) : [];
  const computedBaseDayCount =
    explicitBaseDays.length > 0
      ? explicitBaseDays.length
      : typeof component.baseDaysCount === 'number' && component.baseDaysCount > 0
      ? component.baseDaysCount
      : null;
  const formattedBaseDays =
    computedBaseDayCount !== null
      ? Number.isInteger(computedBaseDayCount)
        ? computedBaseDayCount.toString()
        : computedBaseDayCount.toFixed(2)
      : null;
  const hasBaseDayList = explicitBaseDays.length > 0;
  const platformGuestCount =
    showPlatformTotals && platformGuestTotals && platformGuestTotals.totalGuests > 0
      ? platformGuestTotals.totalGuests
      : breakdown.length > 0
      ? breakdown[breakdown.length - 1].cumulativeGuests
      : null;
  const hasPlatformDetails = platformGuestCount !== null && (showPlatformTotals || breakdown.length > 0);

  return (
    <Box style={BREAKDOWN_ROW_STYLE}>
      <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
        <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
            <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
              <Badge color={getComponentColor(component.category)} variant="light" style={BREAKDOWN_ROW_BADGE_STYLE}>
                {component.category}
              </Badge>
              <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>
                {component.name}
              </Text>
            </Box>
            {computedBaseDayCount !== null && (
              <Group gap={4} align="center" justify="center" wrap="nowrap">
                <Text size="xs" c="dimmed" ta="center">
                  {formattedBaseDays} {computedBaseDayCount === 1 ? 'day' : 'days'} counted
                </Text>
                {hasBaseDayList && (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="blue"
                    onClick={() => setShowBaseDays((prev) => !prev)}
                    aria-label={showBaseDays ? 'Hide counted dates' : 'Show counted dates'}
                  >
                    {showBaseDays ? '\u25B2' : '\u25BC'}
                  </ActionIcon>
                )}
              </Group>
            )}
            {hasPlatformDetails && (
              <Group gap={4} align="center" justify="center" wrap="nowrap">
                <Text size="xs" c="dimmed" ta="center">
                  {platformGuestCount} {platformGuestCount === 1 ? 'guest' : 'guests'}
                </Text>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="blue"
                  onClick={() => setShowPlatformDetails((prev) => !prev)}
                  aria-label={showPlatformDetails ? 'Hide guest incentive details' : 'Show guest incentive details'}
                >
                  {showPlatformDetails ? '\u25B2' : '\u25BC'}
                </ActionIcon>
              </Group>
            )}
          </Stack>
          <Text size="sm" fw={700} ta="center">
            {formatCurrency(component.amount)}
          </Text>
          <TaskCompletionDailyBreakdown
            rows={component.taskCompletionDailyBreakdown}
            formatAmount={(amount) => formatCurrency(amount)}
            salaryRecipientUserId={salaryRecipientUserId}
          />

      {hasBaseDayList && (
        <Collapse in={showBaseDays}>
          <Stack gap={2} pl="md">
            {explicitBaseDays.map((day, index) => {
              const parsed = dayjs(day);
              const formatted = parsed.isValid() ? parsed.format('MMM D, YYYY') : day;
              return (
                <Text key={`${component.componentId}-day-${index}`} size="xs" c="dimmed">
                  {formatted}
                </Text>
              );
            })}
          </Stack>
        </Collapse>
      )}

      {hasPlatformDetails && (
        <Collapse in={showPlatformDetails}>
      {showPlatformTotals && platformGuestTotals && platformGuestTotals.totalGuests > 0 && (
        <Text size="xs" c="dimmed">
          Total guests: {platformGuestTotals.totalGuests} (Booked {platformGuestTotals.totalBooked}, Attended{' '}
          {platformGuestTotals.totalAttended})
        </Text>
      )}

      {breakdown.length > 0 && (
        <Stack gap={2} pl="md">
          {breakdown.map((tier, index) => (
            <Group key={`${component.componentId}-${index}`} justify="space-between">
              <Text size="xs" c="dimmed">
                {tier.cumulativeGuests - tier.units + 1}-{tier.cumulativeGuests} guests @ {tier.rate.toFixed(2)} zł
              </Text>
              <Text size="xs" fw={600}>
                {formatCurrency(tier.amount)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
        </Collapse>
      )}
      </Stack>
    </Box>
  );
};

const normalizePaymentBucketKey = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');

const getPaymentBucketSortRank = (bucket: string) => {
  const normalized = normalizePaymentBucketKey(bucket);
  if (normalized === 'base' || normalized === 'salary' || normalized === 'base_salary') {
    return 10;
  }
  if (normalized === 'commission' || normalized === 'commissions') {
    return 20;
  }
  if (normalized === 'affiliate_commission' || normalized === 'affiliate_commissions') {
    return 25;
  }
  if (normalized === 'incentive' || normalized === 'incentives') {
    return 30;
  }
  if (normalized === 'reimbursement' || normalized === 'reimbursements') {
    return 40;
  }
  return 100;
};

const hasPositivePaymentBucket = (staff: Pay) =>
  Object.entries(staff.bucketTotals ?? {}).some(([bucket, amount]) => {
    const normalized = normalizePaymentBucketKey(bucket);
    return normalized !== 'affiliate_commission' && normalized !== 'affiliate_commissions' && amount > 0;
  }) ||
  (staff.affiliateSales?.commissionOutstandingTotal ?? 0) > 0;

const renderProductCommissionChips = (staff?: Pay) => {
  const rows =
    staff?.productTotals
      ?.filter((product) => product.totalCommission > 0)
      .map((product) => ({
        key: `${product.productId ?? 'legacy'}-${product.productName}`,
        label: product.productName || 'Product commission',
        amount: product.totalCommission,
      })) ?? [];

  if (rows.length === 0) {
    return null;
  }

  return (
    <Stack gap={0}>
      {rows.map((row) => (
        <Box key={row.key} style={BREAKDOWN_ROW_STYLE}>
          <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
            <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
              <Badge color="green" variant="light" style={BREAKDOWN_ROW_BADGE_STYLE}>
                Commission
              </Badge>
              <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>
                {row.label}
              </Text>
            </Box>
            <Text size="sm" fw={700} ta="center">
              {formatCurrency(row.amount)}
            </Text>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};

const renderReimbursementBreakdownChip = (staff?: Pay) => {
  const amount = (staff?.reimbursements?.awaitingAmount ?? 0) + (staff?.reimbursements?.reimbursedAmount ?? 0);
  if (amount <= 0) {
    return null;
  }

  return (
    <Box style={BREAKDOWN_ROW_STYLE}>
      <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
        <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
          <Badge color="orange" variant="light" style={BREAKDOWN_ROW_BADGE_STYLE}>
            Reimbursement
          </Badge>
          <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>Reimbursements</Text>
        </Box>
        <Text size="sm" fw={700} ta="center">
          {formatCurrency(amount)}
        </Text>
      </Stack>
    </Box>
  );
};

const renderAffiliateCommissionBreakdownChip = (staff?: Pay) => {
  const amount = roundLineAmount(staff?.affiliateSales?.commissionOutstandingTotal ?? 0);
  if (amount <= 0) {
    return null;
  }

  return (
    <Box style={BREAKDOWN_ROW_STYLE}>
      <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
        <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
          <Badge color="green" variant="light" style={BREAKDOWN_ROW_BADGE_STYLE}>
            Commission
          </Badge>
          <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>
            Promotion Sales
          </Text>
        </Box>
        <Text size="sm" fw={700} ta="center">
          {formatCurrency(amount)}
        </Text>
      </Stack>
    </Box>
  );
};

const renderComponentList = (
  components?: PayComponentSummary[],
  platformGuestBreakdowns?: Record<string, PlatformGuestTierBreakdown[]>,
  platformGuestTotals?: { totalGuests: number; totalBooked: number; totalAttended: number },
  lockedComponents?: LockedComponentSummary[],
  staff?: Pay,
  options?: { onApproveBaseOverride?: (staff: Pay) => void; pendingUserIds?: Set<number> },
) => {
  const paidComponents = components ?? [];
  const lockedList = lockedComponents ?? [];
  const productCommissionChips = renderProductCommissionChips(staff);
  const affiliateCommissionChip = renderAffiliateCommissionBreakdownChip(staff);
  const reimbursementChip = renderReimbursementBreakdownChip(staff);
  if (
    paidComponents.length === 0 &&
    lockedList.length === 0 &&
    !productCommissionChips &&
    !affiliateCommissionChip &&
    !reimbursementChip
  ) {
    return null;
  }

  const lastBaseIndex = paidComponents.reduce(
    (lastIndex, component, index) => (component.category?.toLowerCase() === 'base' ? index : lastIndex),
    -1,
  );
  const lastIncentiveIndex = paidComponents.reduce(
    (lastIndex, component, index) => (component.category?.toLowerCase() === 'incentive' ? index : lastIndex),
    -1,
  );

  return (
    <DetailAccordionSection title="Breakdown">
      {(paidComponents.length > 0 || productCommissionChips || affiliateCommissionChip || reimbursementChip) && (
        <Stack gap={4}>
          {lastBaseIndex < 0 && productCommissionChips}
          {lastBaseIndex < 0 && affiliateCommissionChip}
          {paidComponents.map((component, componentIndex) => {
            const breakdown = platformGuestBreakdowns?.[String(component.componentId)] ?? [];
            const showPlatformTotals =
              component.name?.toLowerCase().includes('platform') &&
              platformGuestTotals &&
              platformGuestTotals.totalGuests > 0;
            return (
              <React.Fragment key={component.componentId}>
                <ComponentListItem
                  component={component}
                  breakdown={breakdown}
                  showPlatformTotals={Boolean(showPlatformTotals)}
                  platformGuestTotals={platformGuestTotals}
                  salaryRecipientUserId={staff?.userId}
                />
                {componentIndex === lastBaseIndex && productCommissionChips}
                {componentIndex === lastBaseIndex && affiliateCommissionChip}
                {componentIndex === lastIncentiveIndex && reimbursementChip}
              </React.Fragment>
            );
          })}
          {lastIncentiveIndex < 0 && reimbursementChip}
        </Stack>
      )}
      {lockedList.length > 0 && (
        <Stack gap={4} pt="xs">
          {lockedList.map((entry, index) => {
            const requirement = entry.requirement;
            const reviewRequirement = requirement?.type === 'review_target' ? requirement : null;
            const baseRequirement = requirement?.type === 'base_override' ? requirement : null;
            const performanceRequirement =
              requirement?.type === 'performance_tier' ? requirement : null;
            const isBaseOverride = Boolean(baseRequirement);
            const staffHasCanonicalRange = staff?.rangeIsCanonical !== false;
            const canApproveBaseOverride =
              isBaseOverride &&
              staff &&
              staff.userId &&
              staffHasCanonicalRange &&
              options?.onApproveBaseOverride;
            const pendingBaseOverride =
              canApproveBaseOverride && options?.pendingUserIds?.has(staff!.userId!);
            const requiresMonthlyRangeHint = isBaseOverride && !staffHasCanonicalRange;

            let requirementDetails: React.ReactNode = null;
            if (reviewRequirement) {
              const { minReviews, actualReviews } = reviewRequirement;
              requirementDetails = (
                <Text component="span" size="xs" c="dimmed" ta="center">
                  Needs {minReviews} reviews, current {actualReviews}
                </Text>
              );
            } else if (baseRequirement) {
              requirementDetails = (
                <Text component="span" size="xs" c="dimmed" ta="center">
                  Quota {baseRequirement.allowedUnits} days, worked {baseRequirement.workedUnits} days; extra{' '}
                  {baseRequirement.extraUnits}
                </Text>
              );
            } else if (performanceRequirement) {
              requirementDetails = (
                <Text component="span" size="xs" c="dimmed" ta="center">
                  Completed {performanceRequirement.progressPercent.toFixed(2)}%, multiplier{' '}
                  {performanceRequirement.multiplier.toFixed(2)}x
                  {performanceRequirement.matchedTierLabel
                    ? `, tier ${performanceRequirement.matchedTierLabel}`
                    : ''}
                </Text>
              );
            }

            return (
              <Box key={`${entry.componentId}-${index}`} style={BREAKDOWN_ROW_STYLE}>
                <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
                  <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
                      <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
                        <Badge color="red" variant="light" style={BREAKDOWN_ROW_BADGE_STYLE}>
                          {entry.category}
                        </Badge>
                        <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>
                          {entry.name}
                        </Text>
                      </Box>
                      {requirementDetails}
                    </Stack>
                    <Stack gap={0} align="center">
                      <Text size="sm" fw={700} c="red.6" ta="center">
                        {formatCurrency(entry.amount)}
                      </Text>
                      <Text size="xs" c="dimmed" ta="center">
                        Not included
                      </Text>
                    </Stack>
                {baseRequirement && baseRequirement.extraDays && baseRequirement.extraDays.length > 0 && (
                  <Text size="xs" c="dimmed" ta="center">
                    Extra days:{' '}
                    {baseRequirement.extraDays
                      .map((day: string) => dayjs(day).format('MMM D'))
                      .join(', ')}
                  </Text>
                )}
                {requiresMonthlyRangeHint && (
                  <Text size="xs" c="dimmed" ta="center">
                    Switch to a full monthly range to approve these extra days.
                  </Text>
                )}
                {canApproveBaseOverride && (
                  <Group justify="center">
                    <Button
                      size="xs"
                      variant="subtle"
                      loading={Boolean(pendingBaseOverride)}
                      onClick={() => staff && options?.onApproveBaseOverride?.(staff)}
                    >
                      Approve extra base days
                    </Button>
                  </Group>
                )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </DetailAccordionSection>
  );
};

type EntryPaymentLine = {
  id: string;
  label: string;
  labelEditable?: boolean;
  amount: number;
  categoryId: string;
  categoryLabel?: string | null;
  accountId?: string | null;
  accountLabel?: string | null;
  componentId?: number;
  sourceKey?: string;
  settlementIntent?: string;
  affiliatePayout?: {
    affiliateUserId: number;
    bookingIds: number[];
  };
  description: string;
  include: boolean;
};

type EntryFundAllocationLine = {
  id: string;
  label: string;
  componentId?: number;
  sourceKey: string;
  amount: number;
  fundId: number;
  fundName: string;
  settlementIntent: string;
  description: string;
  include: boolean;
};

type EntryModalState = {
  open: boolean;
  staff: Pay | null;
  amount: number;
  currency: string;
  date: Date;
  accountId: string;
  categoryId: string;
  counterpartyId: string;
  description: string;
  rangeStart: string;
  rangeEnd: string;
  lines: EntryPaymentLine[];
  fundAllocations: EntryFundAllocationLine[];
  includeReimbursements: boolean;
  reimbursementEntries: PayReimbursementEntry[];
  reimbursementsAwaitingAmount: number;
  reimbursementCategoryId: string;
};

type PaidEntriesModalState = {
  open: boolean;
  staff: Pay | null;
  selectedIds: number[];
};

const extractRequestErrorMessage = (error: unknown, fallback: string): string => {
  const responseData = (error as { response?: { data?: unknown } })?.response?.data;
  const firstEntry = Array.isArray(responseData) ? responseData[0] : responseData;
  if (firstEntry && typeof firstEntry === 'object' && 'message' in firstEntry) {
    const message = (firstEntry as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

type StaffPayoutBatchResponse = {
  duplicated: boolean;
  batchKey: string;
  fundAllocationCount?: number;
  receipts?: Array<{
    id: number;
    actionId: number | null;
    status: 'pending' | 'completed' | 'cancelled';
    payoutBatchKey: string;
  }>;
};

type ReceiptEvidenceModalState = {
  open: boolean;
  receiptId: number | null;
  detail: PayPayoutReceiptDetail | null;
  loading: boolean;
  error: string | null;
  photoUrl: string | null;
  signatureUrl: string | null;
  history: PayPayoutReceiptHistoryEntry[];
  historyLoading: boolean;
  historyError: string | null;
  historyHasMore: boolean;
};

type ReceiptHistoryBrowserModalState = {
  open: boolean;
  staff: Pay | null;
  receipts: PayPayoutReceiptHistoryEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
};

type OpeningBalanceDetailRow = {
  staff: Pay;
  openingBalance: number;
};

type FixedDesktopHeaderState = {
  visible: boolean;
  left: number;
  width: number;
  columnWidths: number[];
};

const createEmptyEntryModalState = (): EntryModalState => ({
  open: false,
  staff: null,
  amount: 0,
  currency: DEFAULT_CURRENCY,
  date: new Date(),
  accountId: '',
  categoryId: '',
  counterpartyId: '',
  description: '',
  rangeStart: '',
  rangeEnd: '',
  lines: [],
  fundAllocations: [],
  includeReimbursements: false,
  reimbursementEntries: [],
  reimbursementsAwaitingAmount: 0,
  reimbursementCategoryId: '',
});

const createEmptyPaidEntriesModalState = (): PaidEntriesModalState => ({
  open: false,
  staff: null,
  selectedIds: [],
});

const createEmptyReceiptEvidenceModalState = (): ReceiptEvidenceModalState => ({
  open: false,
  receiptId: null,
  detail: null,
  loading: false,
  error: null,
  photoUrl: null,
  signatureUrl: null,
  history: [],
  historyLoading: false,
  historyError: null,
  historyHasMore: false,
});

const createEmptyReceiptHistoryBrowserModalState = (): ReceiptHistoryBrowserModalState => ({
  open: false,
  staff: null,
  receipts: [],
  loading: false,
  error: null,
  hasMore: false,
});

const PAYMENT_BUCKET_METADATA: Record<
  string,
  {
    label: string;
    categoryHint?: string;
  }
> = {
  commission: { label: 'Commission', categoryHint: 'Commission' },
  commissions: { label: 'Commission', categoryHint: 'Commission' },
  base: { label: 'Base Salary', categoryHint: 'Base Salary' },
  salary: { label: 'Base Salary', categoryHint: 'Base Salary' },
  incentive: { label: 'Incentive', categoryHint: 'Incentives' },
  incentives: { label: 'Incentive', categoryHint: 'Incentives' },
  review: { label: 'Reviews', categoryHint: 'Reviews' },
  reviews: { label: 'Reviews', categoryHint: 'Reviews' },
  bonus: { label: 'Bonus', categoryHint: 'Bonuses' },
  bonuses: { label: 'Bonus', categoryHint: 'Bonuses' },
  reimbursement: { label: 'Reimbursements', categoryHint: 'Reimbursements' },
  reimbursements: { label: 'Reimbursements', categoryHint: 'Reimbursements' },
  affiliate_commission: { label: 'Affiliate Commission', categoryHint: 'Commission' },
  affiliate_commissions: { label: 'Affiliate Commission', categoryHint: 'Commission' },
};

const createLineId = () => `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const roundLineAmount = (value: number) => Math.round((value ?? 0) * 100) / 100;

const computeSelectedLineTotal = (lines: EntryPaymentLine[]) =>
  lines
    .filter((line) => line.include && line.amount > 0)
    .reduce((sum, line) => sum + line.amount, 0);

const findCategoryIdByName = (
  lookup: Map<string, FinanceCategory>,
  name: string | undefined,
  fallback: string,
) => {
  if (!name) {
    return fallback;
  }
  const record = lookup.get(name.toLowerCase());
  if (record) {
    return String(record.id);
  }
  return fallback;
};

const normalizeRecordedLineLabel = (value: string | null | undefined) => {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized === 'affiliate commission' ? 'promotion sales' : normalized;
};

export const buildDefaultPaymentLines = (
  staff: Pay,
  categoryLookup: Map<string, FinanceCategory>,
  fallbackCategoryId: string,
  componentDefinitions: Map<number, CompensationComponent>,
): EntryPaymentLine[] => {
  const settlementSources = staff.settlementSources ?? [];
  const settlementSourceByIdentity = new Map(
    settlementSources.map((source) => [
      `${source.sourceKey}:${source.componentId ?? 0}`,
      source,
    ] as const),
  );
  const componentDestination = new Map(
    settlementSources
      .filter((source) => source.componentId != null)
      .map((source) => [source.componentId as number, source.destination] as const),
  );
  const systemDestination = new Map(
    settlementSources
      .filter((source) => source.componentId == null)
      .map((source) => [source.sourceKey, source.destination] as const),
  );
  const missingRouteDestination = (staff.staffType ?? '').trim().toLowerCase() === 'volunteer'
    ? 'volunteer_fund'
    : 'staff_vendor';
  const componentPaysStaff = (componentId: number) =>
    (componentDestination.get(componentId) ?? missingRouteDestination) === 'staff_vendor';
  const systemPaysStaff = (sourceKey: string) =>
    (systemDestination.get(sourceKey) ?? missingRouteDestination) === 'staff_vendor';
  const GUIDE_COMMISSION_CANDIDATE_KEYS = [
    'guideCommission',
    'guide_commission',
    'guideCommissionRates',
    'guide_commission_rates',
    'productCommission',
    'product_commission',
    'productCommissionRates',
    'product_commission_rates',
    'commissionRates',
    'commission_rates',
  ] as const;

  const normalizeProductKey = (productId: number | null): string =>
    productId === null ? '__null__' : String(productId);

  const parseProductId = (value: unknown): number | null | undefined => {
    if (value === null) {
      return null;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'null' || normalized === 'none' || normalized === 'legacy') {
        return null;
      }
      const numeric = Number(normalized);
      if (Number.isFinite(numeric)) {
        return Math.trunc(numeric);
      }
      return undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    return undefined;
  };

  const collectProductIds = (value: unknown): Array<number | null> => {
    if (value === undefined) {
      return [];
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => parseProductId(entry))
        .filter((entry): entry is number | null => entry !== undefined);
    }
    const parsed = parseProductId(value);
    return parsed === undefined ? [] : [parsed];
  };

  const extractCommissionConfigCandidate = (
    config: Record<string, unknown> | undefined,
  ): Record<string, unknown> | null => {
    if (!config || typeof config !== 'object') {
      return null;
    }
    for (const key of GUIDE_COMMISSION_CANDIDATE_KEYS) {
      const candidate = config[key];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate as Record<string, unknown>;
      }
    }
    if (
      'products' in config ||
      'productRates' in config ||
      'product_rates' in config ||
      'productIds' in config ||
      'product_ids' in config ||
      'productId' in config ||
      'product_id' in config
    ) {
      return config;
    }
    return null;
  };

  const getCommissionProductKeys = (component: CompensationComponent): Set<string> => {
    const keys = new Set<string>();
    if (component.category !== 'commission') {
      return keys;
    }
    const candidate = extractCommissionConfigCandidate(component.config);
    if (!candidate) {
      return keys;
    }

    const products =
      candidate.products ??
      candidate.productRates ??
      candidate.product_rates ??
      candidate.entries ??
      candidate.items;
    if (Array.isArray(products)) {
      products.forEach((raw) => {
        if (!raw || typeof raw !== 'object') {
          return;
        }
        const record = raw as Record<string, unknown>;
        const ids = collectProductIds(
          record.productIds ??
            record.product_ids ??
            record.products ??
            record.productList ??
            record.product_list ??
            record.productId ??
            record.product_id ??
            record.id ??
            record.counterProductId ??
            record.counter_product_id,
        );
        ids.forEach((id) => keys.add(normalizeProductKey(id)));
      });
    }

    const directIds = collectProductIds(
      candidate.productIds ??
        candidate.product_ids ??
        candidate.products ??
        candidate.productList ??
        candidate.product_list ??
        candidate.productId ??
        candidate.product_id ??
        candidate.id ??
        candidate.counterProductId ??
        candidate.counter_product_id,
    );
    directIds.forEach((id) => keys.add(normalizeProductKey(id)));
    return keys;
  };

  const lockedComponentIds = new Set((staff.lockedComponents ?? []).map((entry) => entry.componentId));

  const bucketBalances = new Map<
    string,
    {
      label: string;
      amount: number;
    }
  >();
  Object.entries(staff.bucketTotals ?? {}).forEach(([bucket, amount]) => {
    const normalizedBucket = bucket.toLowerCase();
    if (
      normalizedBucket === 'reimbursement' ||
      normalizedBucket === 'reimbursements' ||
      normalizedBucket === 'affiliate_commission' ||
      normalizedBucket === 'affiliate_commissions'
    ) {
      return;
    }
    if (amount > 0) {
      bucketBalances.set(normalizedBucket, {
        label: bucket,
        amount,
      });
    }
  });

  (staff.lockedComponents ?? []).forEach((locked) => {
    if (!locked.amount || locked.amount <= 0) {
      return;
    }
    const bucketKey = locked.bucketCategory ?? locked.category;
    if (!bucketKey) {
      return;
    }
    const normalized = bucketKey.toLowerCase();
    if (bucketBalances.has(normalized)) {
      const entry = bucketBalances.get(normalized)!;
      entry.amount = Math.max(entry.amount - locked.amount, 0);
      bucketBalances.set(normalized, entry);
    }
  });

  const lines: EntryPaymentLine[] = [];
  const paidByComponentId = new Map<number, number>();
  const paidByLabel = new Map<string, number>();

  (staff.paidEntries ?? []).forEach((entry) => {
    const amount = roundLineAmount(entry.amount ?? 0);
    if (amount <= 0) {
      return;
    }
    if (entry.componentId && entry.componentId > 0) {
      paidByComponentId.set(entry.componentId, roundLineAmount((paidByComponentId.get(entry.componentId) ?? 0) + amount));
      return;
    }
    const labelKey = normalizeRecordedLineLabel(entry.label);
    if (labelKey) {
      paidByLabel.set(labelKey, roundLineAmount((paidByLabel.get(labelKey) ?? 0) + amount));
    }
  });

  const consumePaidAmount = (line: Pick<EntryPaymentLine, 'label' | 'componentId'>, amount: number) => {
    let consumed = 0;
    const consumeFromMap = <T,>(map: Map<T, number>, key: T, requested: number) => {
      const available = map.get(key) ?? 0;
      if (available <= 0 || requested <= 0) {
        return 0;
      }
      const used = Math.min(available, requested);
      const remaining = roundLineAmount(available - used);
      if (remaining > 0) {
        map.set(key, remaining);
      } else {
        map.delete(key);
      }
      return used;
    };

    if (line.componentId && line.componentId > 0) {
      consumed += consumeFromMap(paidByComponentId, line.componentId, amount);
    }

    if (consumed < amount) {
      const labelKey = normalizeRecordedLineLabel(line.label);
      if (labelKey) {
        consumed += consumeFromMap(paidByLabel, labelKey, amount - consumed);
      }
    }

    return roundLineAmount(consumed);
  };

  const pushRemainingLine = (
    line: Omit<EntryPaymentLine, 'id'>,
    options?: { reconcileRecordedPayments?: boolean },
  ) => {
    const grossAmount = roundLineAmount(line.amount);
    if (grossAmount <= 0) {
      return 0;
    }
    const paidAmount = options?.reconcileRecordedPayments === false ? 0 : consumePaidAmount(line, grossAmount);
    const remainingAmount = roundLineAmount(Math.max(grossAmount - paidAmount, 0));
    if (remainingAmount <= 0) {
      return 0;
    }
    const canonicalSourceKey = line.componentId ? 'compensation_component' : line.sourceKey;
    const settlementSource = canonicalSourceKey
      ? settlementSourceByIdentity.get(`${canonicalSourceKey}:${line.componentId ?? 0}`)
      : null;
    lines.push({
      id: createLineId(),
      ...line,
      amount: remainingAmount,
      settlementIntent: settlementSource?.destination === 'staff_vendor'
        ? settlementSource.settlementIntent ?? undefined
        : undefined,
    });
    return remainingAmount;
  };

  const componentAggregates = new Map<
    number,
    {
      summary: PayComponentSummary;
      total: number;
    }
  >();

  (staff.componentTotals ?? []).forEach((summary) => {
    if (lockedComponentIds.has(summary.componentId)) {
      return;
    }
    if (!componentPaysStaff(summary.componentId)) {
      return;
    }
    if (summary.amount == null || summary.amount <= 0) {
      return;
    }
    const existing = componentAggregates.get(summary.componentId);
    if (existing) {
      existing.total += summary.amount;
    } else {
      componentAggregates.set(summary.componentId, {
        summary,
        total: summary.amount,
      });
    }
  });

  const decrementBucket = (bucketKey: string, amount: number) => {
    if (!amount) {
      return;
    }
    const normalized = bucketKey.toLowerCase();
    const entry = bucketBalances.get(normalized);
    if (entry) {
      entry.amount = Math.max(entry.amount - amount, 0);
      bucketBalances.set(normalized, entry);
    }
  };

  const findProductCommissionComponentId = (
    entries: Array<{ componentId: number; amount: number }>,
    productId: number | null,
  ): number | null => {
    for (const entry of entries) {
      if (!entry.componentId || !entry.amount) {
        continue;
      }
      const definitionCategory = componentDefinitions.get(entry.componentId)?.category?.toLowerCase() ?? '';
      const aggregateCategory = componentAggregates.get(entry.componentId)?.summary.category?.toLowerCase() ?? '';
      if (definitionCategory === 'commission' || aggregateCategory === 'commission') {
        return entry.componentId;
      }
    }

    const productKey = normalizeProductKey(productId);
    const matches: number[] = [];
    componentDefinitions.forEach((component) => {
      if (component.category !== 'commission' || component.isActive === false) {
        return;
      }
      const configuredKeys = getCommissionProductKeys(component);
      if (configuredKeys.has(productKey)) {
        matches.push(component.id);
      }
    });
    if (matches.length > 0) {
      return matches[matches.length - 1];
    }

    return null;
  };

  const spendComponentAmount = (
    componentId: number,
    amount: number,
    options?: { productName?: string },
  ) => {
    if (!amount || amount <= 0 || !componentPaysStaff(componentId)) {
      return;
    }
    const aggregate = componentAggregates.get(componentId);
    const summary = aggregate?.summary;
    const meta = componentDefinitions.get(componentId);
    const categorySource = summary?.category || meta?.category || '';
    const normalizedCategory = categorySource.toLowerCase();
    const componentName = (summary?.name || meta?.name || '').trim();
    const normalizedName = componentName.toLowerCase();
    const defaultCategoryId = meta?.defaultFinanceCategoryId
      ? String(meta.defaultFinanceCategoryId)
      : findCategoryIdByName(
          categoryLookup,
          categorySource || meta?.category || componentName || '',
          fallbackCategoryId,
        );
    const defaultAccountId = meta?.defaultFinanceAccountId ? String(meta.defaultFinanceAccountId) : '';
    const baseName = componentName || `Component #${componentId}`;
    const label = options?.productName ? `${options.productName} - ${baseName}` : baseName;
    const roundedAmount = roundLineAmount(amount);

    pushRemainingLine({
      label,
      componentId,
      sourceKey: 'compensation_component',
      amount: roundedAmount,
      categoryId: defaultCategoryId,
      accountId: defaultAccountId,
      description: `Auto payout - ${baseName}`,
      include: true,
    });

    if (aggregate) {
      aggregate.total = Math.max(0, aggregate.total - roundedAmount);
      if (aggregate.total <= 0) {
        componentAggregates.delete(componentId);
      }
    }

    if (normalizedName && bucketBalances.has(normalizedName)) {
      decrementBucket(normalizedName, roundedAmount);
    } else if (normalizedCategory && bucketBalances.has(normalizedCategory)) {
      decrementBucket(normalizedCategory, roundedAmount);
    }
  };

  (staff.productTotals ?? []).forEach((product) => {
    const productName = product.productName || 'Product payout';
    const productComponentTotals = product.componentTotals ?? [];
    productComponentTotals.forEach((entry) => {
      if (!entry.componentId || !entry.amount) {
        return;
      }
      if (lockedComponentIds.has(entry.componentId)) {
        return;
      }
      spendComponentAmount(entry.componentId, entry.amount, { productName });
    });

    const commissionAmount = product.totalCommission ?? 0;
    if (commissionAmount > 0 && systemPaysStaff('guide_commission')) {
      const roundedCommission = roundLineAmount(commissionAmount);
      const productCommissionComponentId = findProductCommissionComponentId(
        productComponentTotals,
        product.productId ?? null,
      );
      if (productCommissionComponentId && componentPaysStaff(productCommissionComponentId)) {
        spendComponentAmount(productCommissionComponentId, roundedCommission, { productName });
        return;
      }

      pushRemainingLine({
        label: `${productName} - Commission`,
        sourceKey: 'guide_commission',
        amount: roundedCommission,
        categoryId: findCategoryIdByName(categoryLookup, 'commission', fallbackCategoryId),
        accountId: '',
        description: 'Auto payout - Commission',
        include: true,
      });
      decrementBucket('commission', roundedCommission);
    }
  });

  componentAggregates.forEach(({ summary, total }) => {
    if (!total || total <= 0) {
      return;
    }
    spendComponentAmount(summary.componentId, total);
  });

  bucketBalances.forEach((entry, key) => {
    if (entry.amount <= 0) {
      return;
    }
    const metadata = PAYMENT_BUCKET_METADATA[key];
    const fallbackCategory = findCategoryIdByName(categoryLookup, metadata?.categoryHint, fallbackCategoryId);
    pushRemainingLine({
      label: metadata?.label ?? entry.label,
      amount: roundLineAmount(entry.amount),
      categoryId: fallbackCategory,
      accountId: '',
      description: `${metadata?.label ?? entry.label} payout`,
      include: true,
    });
  });

  const outstandingAffiliateBookings =
    staff.affiliateSales?.bookings.filter((booking) => !booking.isCommissionPaid && booking.affiliateCommissionAmount > 0) ?? [];
  const affiliateCommissionAmount = roundLineAmount(
    outstandingAffiliateBookings.reduce((sum, booking) => sum + booking.affiliateCommissionAmount, 0),
  );
  if (
    staff.userId
    && affiliateCommissionAmount > 0
    && outstandingAffiliateBookings.length > 0
    && systemPaysStaff('promotion_sales')
  ) {
    pushRemainingLine(
      {
        label: 'Promotion Sales',
        sourceKey: 'promotion_sales',
        amount: affiliateCommissionAmount,
        categoryId: findCategoryIdByName(categoryLookup, 'commission', fallbackCategoryId),
        accountId: '',
        description: `Promotion sales payout for ${formatPayStaffName(staff)}`,
        affiliatePayout: {
          affiliateUserId: staff.userId,
          bookingIds: outstandingAffiliateBookings.map((booking) => booking.id),
        },
        include: true,
      },
      // Affiliate payout state already identifies exactly which bookings remain unpaid.
      // Generic label reconciliation would let an older Promotion Sales payment consume
      // commission from these newly outstanding booking IDs a second time.
      { reconcileRecordedPayments: false },
    );
  }

  // Component rows are positive finance transactions, while deductions are
  // represented in the server's net payable. Trim the proposed rows to that
  // authoritative current-period outstanding so a negative component cannot
  // make the modal pay more than the report says is due.
  // Reimbursements use their own server-validated transaction flow below.
  // Keep them out of the ordinary compensation-line cap and carry-forward
  // calculation or the same awaiting reimbursement appears once as a payout
  // line and again as a reimbursement.
  const currentReimbursementOutstanding = roundLineAmount(
    Math.max(staff.reimbursements?.awaitingAmount ?? 0, 0),
  );
  const currentPersonalOutstanding =
    staff.payouts?.payableOutstanding
    ?? staff.personalPayableTotal
    ?? staff.totalPayout
    ?? staff.totalCommission
    ?? 0;
  let remainingCurrentOutstanding = roundLineAmount(
    Math.max(currentPersonalOutstanding - currentReimbursementOutstanding, 0),
  );
  const remainingByIntent = new Map(
    settlementSources
      .filter((source) => source.destination === 'staff_vendor' && Boolean(source.settlementIntent))
      .map((source) => [source.settlementIntent as string, roundLineAmount(source.outstandingAmount)] as const),
  );
  const cappedLines = lines.flatMap((line) => {
    if (remainingCurrentOutstanding <= 0) {
      return [];
    }
    const intentRemaining = line.settlementIntent
      ? remainingByIntent.get(line.settlementIntent) ?? 0
      : Number.POSITIVE_INFINITY;
    const amount = roundLineAmount(Math.min(line.amount, remainingCurrentOutstanding, intentRemaining));
    remainingCurrentOutstanding = roundLineAmount(Math.max(remainingCurrentOutstanding - amount, 0));
    if (line.settlementIntent) {
      remainingByIntent.set(
        line.settlementIntent,
        roundLineAmount(Math.max(intentRemaining - amount, 0)),
      );
    }
    return amount > 0 ? [{ ...line, amount }] : [];
  });
  lines.splice(0, lines.length, ...cappedLines);

  // Prior finalized personal liabilities stay personal even after a staff
  // member is labelled Volunteer. Include that carry-forward in addition to
  // current review/promotion lines instead of only using it as an empty-state
  // fallback.
  const selectedCurrentTotal = computeSelectedLineTotal(lines);
  const fullOutstanding = roundLineAmount(
    Math.max(
      (staff.closingBalance ?? staff.payouts?.payableOutstanding ?? selectedCurrentTotal)
        - currentReimbursementOutstanding,
      0,
    ),
  );
  const carryForwardAmount = roundLineAmount(Math.max(fullOutstanding - selectedCurrentTotal, 0));
  if (carryForwardAmount > 0) {
    lines.push({
      id: createLineId(),
      label: 'Previous personal balance',
      sourceKey: 'carry_forward_personal',
      amount: carryForwardAmount,
      categoryId: fallbackCategoryId,
      accountId: '',
      description: `Previous personal balance for ${formatPayStaffName(staff)}`,
      include: true,
    });
  }

  return lines;
};

export const buildDefaultFundAllocationLines = (staff: Pay): EntryFundAllocationLine[] =>
  (staff.settlementSources ?? [])
    .filter(
      (source) =>
        source.destination === 'volunteer_fund'
        && source.fundId != null
        && Boolean(source.settlementIntent)
        && source.outstandingAmount > 0,
    )
    .map((source) => ({
      id: createLineId(),
      label: source.label,
      componentId: source.componentId ?? undefined,
      sourceKey: source.sourceKey,
      amount: roundLineAmount(source.outstandingAmount),
      fundId: source.fundId as number,
      fundName: source.fundName ?? `Volunteer Fund #${source.fundId}`,
      settlementIntent: source.settlementIntent as string,
      description: `Allocate ${source.label} to ${source.fundName ?? 'Volunteer Fund'}`,
      include: true,
    }));

type VolunteerRoutingPresentation = {
  statusLabel: string;
  color: string;
  description: string;
};

const isVolunteerStaff = (staff: Pay | null | undefined): boolean =>
  (staff?.staffType ?? '').trim().toLowerCase() === 'volunteer';

const getVolunteerRoutingPresentation = (
  staff: Pay | null | undefined,
): VolunteerRoutingPresentation | null => {
  if (!staff || !isVolunteerStaff(staff)) {
    return null;
  }
  const activeSources = (staff.settlementSources ?? []).filter(
    (source) => Math.abs(source.amount) > 0.005
      || source.outstandingAmount > 0.005
      || source.allocatedAmount > 0.005,
  );
  const personalLabels = Array.from(new Set(
    activeSources
      .filter((source) => source.destination === 'staff_vendor')
      .map((source) => source.label),
  ));
  const fundLabels = Array.from(new Set(
    activeSources
      .filter((source) => source.destination === 'volunteer_fund')
      .map((source) => source.label),
  ));
  const periodLabel = staff.range?.startDate && staff.range?.endDate
    ? formatRangeLabel(staff.range.startDate, staff.range.endDate)
    : 'the selected period';
  const suffix = 'Completed or recorded settlements are preserved; an unpaid period may refresh to the latest eligible routing.';

  if (personalLabels.length > 0 && fundLabels.length > 0) {
    return {
      statusLabel: 'Split: staff + fund',
      color: 'blue',
      description: `${periodLabel} pays ${personalLabels.join(', ')} to staff and allocates ${fundLabels.join(', ')} to the Volunteer Fund. ${suffix}`,
    };
  }
  if (fundLabels.length > 0) {
    return {
      statusLabel: 'Volunteer Fund route',
      color: 'violet',
      description: `${periodLabel} allocates ${fundLabels.join(', ')} to the Volunteer Fund. ${suffix}`,
    };
  }
  if (personalLabels.length > 0) {
    return {
      statusLabel: 'Period routes to staff',
      color: 'orange',
      description: `${periodLabel} currently routes ${personalLabels.join(', ')} as personal staff pay. This can represent an older-policy period or an explicit personal exception. ${suffix}`,
    };
  }
  if ((staff.openingBalance ?? 0) > 0) {
    return {
      statusLabel: 'Previous personal balance',
      color: 'orange',
      description: `${periodLabel} includes a personal balance saved before this period. A later Volunteer policy does not move that historical liability into the fund.`,
    };
  }
  return {
    statusLabel: 'Routing unavailable',
    color: 'red',
    description: `No source-routing breakdown is available for ${periodLabel}. Refresh the report before processing compensation.`,
  };
};

const renderVolunteerRoutingBadges = (staff: Pay) => {
  const routing = getVolunteerRoutingPresentation(staff);
  if (!routing) {
    return null;
  }
  return (
    <Group gap={4} justify="center">
      <Badge size="xs" variant="light" color="violet">Volunteer</Badge>
      <Tooltip label={routing.description} multiline w={360}>
        <Badge size="xs" variant="light" color={routing.color}>{routing.statusLabel}</Badge>
      </Tooltip>
    </Group>
  );
};

const renderStaffRoutingLabel = (staff: Pay) => {
  const routingBadges = renderVolunteerRoutingBadges(staff);
  return (
    <Stack gap={4} align="center">
      <Text fw={600}>{formatPayStaffName(staff)}</Text>
      {routingBadges}
    </Stack>
  );
};

const renderVolunteerRoutingNotice = (staff: Pay | null | undefined) => {
  const routing = getVolunteerRoutingPresentation(staff);
  if (!routing) {
    return null;
  }
  return (
    <Alert color={routing.color} title={`Volunteer profile - ${routing.statusLabel}`}>
      {routing.description}
    </Alert>
  );
};


const renderBucketTotals = (
  bucketTotals?: Record<string, number>,
  lockedComponents?: LockedComponentSummary[],
  staff?: Pay,
) => {
  const displayBucketTotals = { ...(bucketTotals ?? {}) };
  const promotionSalesAmount = roundLineAmount(staff?.affiliateSales?.commissionOutstandingTotal ?? 0);
  const hasCommissionBucket = Object.keys(displayBucketTotals).some((bucket) => {
    const normalized = normalizePaymentBucketKey(bucket);
    return normalized === 'commission' || normalized === 'commissions';
  });
  if (promotionSalesAmount > 0 && !hasCommissionBucket) {
    displayBucketTotals.commission = 0;
  }

  if (Object.keys(displayBucketTotals).length === 0) {
    return null;
  }

  const lockedAmountsByBucket = new Map<string, number>();
  lockedComponents?.forEach((entry) => {
    if (!entry.amount || entry.amount <= 0) {
      return;
    }
    const bucket = entry.bucketCategory ?? entry.category;
    if (!bucket) {
      return;
    }
    const normalized = normalizePaymentBucketKey(bucket);
    lockedAmountsByBucket.set(normalized, (lockedAmountsByBucket.get(normalized) ?? 0) + entry.amount);
  });

  const entries = Object.entries(displayBucketTotals)
    .filter(([bucket]) => {
      const normalized = normalizePaymentBucketKey(bucket);
      return normalized !== 'affiliate_commission' && normalized !== 'affiliate_commissions';
    })
    .map(([bucket, amount]) => {
      const lockedAmount = lockedAmountsByBucket.get(normalizePaymentBucketKey(bucket)) ?? 0;
      const normalized = normalizePaymentBucketKey(bucket);
      const adjustedAmount =
        normalized === 'commission' || normalized === 'commissions'
          ? amount + promotionSalesAmount
          : amount;
      return [bucket, Math.max(adjustedAmount - lockedAmount, 0)] as const;
    })
    .filter(([, amount]) => amount > 0)
    .sort(([leftBucket], [rightBucket]) => {
      const rankDifference = getPaymentBucketSortRank(leftBucket) - getPaymentBucketSortRank(rightBucket);
      if (rankDifference !== 0) {
        return rankDifference;
      }
      return leftBucket.localeCompare(rightBucket);
    });
  if (entries.length === 0) {
    return null;
  }
  const lockedMap = new Map<string, LockedComponentSummary[]>();
  return (
    <DetailAccordionSection title="Payments">
      <Stack gap={4}>
        {entries.map(([bucket, amount]) => {
          const lockedList = lockedMap.get(bucket) ?? [];
          const normalizedBucket = normalizePaymentBucketKey(bucket);
          const bucketMeta = PAYMENT_BUCKET_METADATA[normalizedBucket] ?? PAYMENT_BUCKET_METADATA[bucket.toLowerCase()];
          const bucketLabel = bucketMeta?.label ?? bucket;
          const lockedLabel =
            lockedList.length > 0
              ? Array.from(
                  new Set(
                    lockedList
                      .map((entry) => {
                        const requirement = entry.requirement;
                        if (requirement?.type !== 'review_target') {
                          return null;
                        }
                        const current = requirement.actualReviews ?? 0;
                        return `(needs ${requirement.minReviews} reviews, current ${current})`;
                      })
                      .filter((value): value is string => Boolean(value)),
                  ),
                ).join(' • ')
              : null;
          return (
            <Box key={bucket} style={BREAKDOWN_ROW_STYLE}>
              <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
                <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
                <Badge
                  variant={lockedList.length > 0 ? 'light' : 'outline'}
                  color={lockedList.length > 0 ? 'red' : getComponentColor(bucket)}
                  style={BREAKDOWN_ROW_BADGE_STYLE}
                >
                  {bucketLabel}
                </Badge>
                <Box style={BREAKDOWN_ROW_TITLE_STYLE}>
                  <Text size={lockedLabel ? 'xs' : 'sm'} c={lockedLabel ? 'dimmed' : undefined} fw={lockedLabel ? undefined : 500}>
                    {lockedLabel ?? bucketLabel}
                  </Text>
                </Box>
                </Box>
                <Text size="sm" fw={700} ta="center">
                  {formatCurrency(amount)}
                </Text>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </DetailAccordionSection>
  );
};

const getReimbursementStatusMeta = (status: string | undefined) => {
  switch (status) {
    case 'awaiting_reimbursement':
      return { label: 'Awaiting reimbursement', color: 'orange' as const };
    case 'reimbursed':
      return { label: 'Reimbursed', color: 'teal' as const };
    case 'approved':
      return { label: 'Approved', color: 'blue' as const };
    case 'planned':
      return { label: 'Planned', color: 'gray' as const };
    case 'paid':
      return { label: 'Paid', color: 'green' as const };
    case 'void':
      return { label: 'Void', color: 'red' as const };
    default:
      return { label: status ?? 'Unknown', color: 'gray' as const };
  }
};

const ReimbursementEntriesTable = ({
  entries,
  maxHeight,
  compact = false,
}: {
  entries: PayReimbursementEntry[];
  maxHeight?: number;
  compact?: boolean;
}) => {
  if (entries.length === 0) {
    return null;
  }
  if (compact) {
    return (
      <Stack gap="xs">
        {entries.map((entry) => {
          const statusMeta = getReimbursementStatusMeta(entry.status);
          const showOriginalAmount =
            entry.originalCurrency &&
            entry.originalCurrency !== '' &&
            (entry.originalCurrency.toUpperCase() !== DEFAULT_CURRENCY ||
              Math.abs(entry.originalAmount - entry.amount) > 0.005);

          return (
            <Paper key={entry.transactionId} withBorder radius="md" p="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Stack gap={6} align="center" ta="center">
                <Group gap={6} justify="center" wrap="wrap">
                  <Text size="sm" fw={600}>
                    {dayjs(entry.date).format('MMM D, YYYY')}
                  </Text>
                  <Badge color={statusMeta.color} variant={statusMeta.color === 'gray' ? 'outline' : 'light'}>
                    {statusMeta.label}
                  </Badge>
                </Group>
                <Stack gap={0} align="center">
                  <Text size="sm" fw={600}>
                    {entry.vendorName ?? 'No vendor'}
                  </Text>
                  <Text size="sm" c={entry.description ? undefined : 'dimmed'}>
                    {entry.description ?? 'No description'}
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="sm" fw={700}>
                    {formatCurrency(entry.amount)}
                  </Text>
                  {showOriginalAmount && (
                    <Text size="xs" c="dimmed">
                      {entry.originalCurrency.toUpperCase()}{' '}
                      {entry.originalAmount.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  )}
                </Stack>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    );
  }
  const table = (
    <Table striped highlightOnHover withColumnBorders>
        <thead>
          <tr>
            <th>Date</th>
            <th>Vendor</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const statusMeta = getReimbursementStatusMeta(entry.status);
            return (
              <tr key={entry.transactionId}>
                <td>{dayjs(entry.date).format('MMM D, YYYY')}</td>
                <td>{entry.vendorName ?? '—'}</td>
                <td>{entry.description ?? '—'}</td>
                <td>
                  <Stack gap={0}>
                    <Text size="sm" fw={600}>
                      {formatCurrency(entry.amount)}
                    </Text>
                    {entry.originalCurrency &&
                      entry.originalCurrency !== '' &&
                      (entry.originalCurrency.toUpperCase() !== DEFAULT_CURRENCY ||
                        Math.abs(entry.originalAmount - entry.amount) > 0.005) && (
                      <Text size="xs" c="dimmed">
                        {entry.originalCurrency.toUpperCase()}{' '}
                        {entry.originalAmount.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    )}
                  </Stack>
                </td>
                <td>
                  <Badge color={statusMeta.color} variant={statusMeta.color === 'gray' ? 'outline' : 'light'}>
                    {statusMeta.label}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
    </Table>
  );
  if (maxHeight && maxHeight > 0) {
    return (
      <ScrollArea mah={maxHeight} offsetScrollbars>
        {table}
      </ScrollArea>
    );
  }
  return table;
};

const PaidEntriesTable = ({
  entries,
  selectedIds,
  onToggle,
  onOpenReceipt,
  compact = false,
}: {
  entries: PayRecordedEntry[];
  selectedIds: number[];
  onToggle: (entryId: number, checked: boolean) => void;
  onOpenReceipt?: (receiptId: number) => void;
  compact?: boolean;
}) => {
  if (compact) {
    return (
      <Stack gap="xs">
        {entries.map((entry) => {
          const selected = selectedIds.includes(entry.id);
          const receipt = entry.receipt;
          const receiptStatus = getPayReceiptStatusMeta(receipt);
          return (
            <Paper
              key={entry.id}
              withBorder
              radius="md"
              p="sm"
              style={{ backgroundColor: selected ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)' }}
            >
              <Stack gap={8} align="center" ta="center">
                <Group justify="space-between" w="100%" wrap="nowrap">
                  <Checkbox
                    checked={selected}
                    disabled={!entry.canDelete}
                    onChange={(event) => onToggle(entry.id, event.currentTarget.checked)}
                    aria-label={`Select ${entry.label}`}
                  />
                  <Badge color={entry.canDelete ? (selected ? 'blue' : 'gray') : 'gray'} variant={selected ? 'light' : 'outline'}>
                    {entry.canDelete ? (selected ? 'Selected' : 'Available') : 'Locked'}
                  </Badge>
                </Group>
                <Stack gap={2} align="center">
                  <Text size="sm" fw={700}>
                    {entry.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {dayjs(entry.date).format('MMM D, YYYY')}
                    {entry.financeTransactionId ? ` | Finance TX #${entry.financeTransactionId}` : ''}
                  </Text>
                </Stack>
                <Text size="lg" fw={700}>
                  {formatCurrency(entry.amount, entry.currency)}
                </Text>
                <Text size="sm" c={entry.note ? undefined : 'dimmed'}>
                  {entry.note || 'No note'}
                </Text>
                <Stack gap={6} align="center">
                  <Badge color={receiptStatus.color} variant="light">
                    {receiptStatus.label}
                  </Badge>
                  {canOpenPayReceipt(receipt) && onOpenReceipt ? (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconReceipt size={15} />}
                      onClick={() => onOpenReceipt(receipt.id)}
                    >
                      View receipt
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    );
  }

  return (
    <Table striped highlightOnHover withColumnBorders>
      <thead>
        <tr>
          <th style={{ width: 56, textAlign: 'center' }}>Select</th>
          <th>Date</th>
          <th>Component</th>
          <th>Amount</th>
          <th>Note</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const receipt = entry.receipt;
          const receiptStatus = getPayReceiptStatusMeta(receipt);
          return (
          <tr key={entry.id}>
            <td style={{ textAlign: 'center' }}>
              <Checkbox
                checked={selectedIds.includes(entry.id)}
                disabled={!entry.canDelete}
                onChange={(event) => onToggle(entry.id, event.currentTarget.checked)}
              />
            </td>
            <td>{dayjs(entry.date).format('MMM D, YYYY')}</td>
            <td>
              <Stack gap={0}>
                <Text size="sm" fw={600}>
                  {entry.label}
                </Text>
                {entry.financeTransactionId ? (
                  <Text size="xs" c="dimmed">
                    Finance TX #{entry.financeTransactionId}
                  </Text>
                ) : null}
              </Stack>
            </td>
            <td>{formatCurrency(entry.amount, entry.currency)}</td>
            <td>
              <Text size="sm" c={entry.note ? undefined : 'dimmed'}>
                {entry.note || 'No note'}
              </Text>
            </td>
            <td>
              <Stack gap={4} align="flex-start">
                <Badge color={receiptStatus.color} variant="light">
                  {receiptStatus.label}
                </Badge>
                {canOpenPayReceipt(receipt) && onOpenReceipt ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconReceipt size={15} />}
                    onClick={() => onOpenReceipt(receipt.id)}
                  >
                    View receipt
                  </Button>
                ) : null}
              </Stack>
            </td>
          </tr>
          );
        })}
      </tbody>
    </Table>
  );
};

const renderReimbursements = (staff: Pay) => {
  const reimbursements = staff.reimbursements;
  if (!reimbursements || reimbursements.entries.length === 0) {
    return null;
  }
  const tableHeight =
    reimbursements.entries.length > 6 ? Math.min(360, reimbursements.entries.length * 52 + 60) : undefined;

  return (
    <DetailAccordionSection
      title="Reimbursements"
    >
      <Group gap="xs" justify="center">
        <Badge variant="light" color={reimbursements.awaitingAmount > 0 ? 'orange' : 'gray'}>
          Awaiting {formatCurrency(reimbursements.awaitingAmount)}
        </Badge>
        <Badge variant="light" color={reimbursements.reimbursedAmount > 0 ? 'teal' : 'gray'}>
          Reimbursed {formatCurrency(reimbursements.reimbursedAmount)}
        </Badge>
      </Group>
      <ReimbursementEntriesTable entries={reimbursements.entries} maxHeight={tableHeight} compact />
    </DetailAccordionSection>
  );
};

const renderAffiliateSalesBreakdownCards = (staff: Pay) => {
  const affiliateSales = staff.affiliateSales;
  if (!affiliateSales || affiliateSales.bookingCount === 0 || affiliateSales.bookings.length === 0) {
    return null;
  }

  const currency = affiliateSales.currency ?? staff.payouts?.currency ?? DEFAULT_CURRENCY;
  const rows = affiliateSales.bookings.filter((booking) => booking.affiliateCommissionAmount > 0);
  if (rows.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs">
      {rows.map((booking) => {
        const bookingCurrency = booking.currency ?? currency;
        const saleDate = booking.sourceReceivedAt ?? booking.experienceDate;
        return (
          <Paper
            key={booking.id}
            withBorder
            radius="md"
            p="sm"
            style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}
          >
            <Stack gap={8} align="center" ta="center">
              <Stack gap={2} align="center">
                <Text size="sm" fw={700}>
                  {saleDate && dayjs(saleDate).isValid() ? dayjs(saleDate).format('MMM D, YYYY') : 'No date'}
                </Text>
                <Text size="sm">{booking.productName ?? 'Promotion sale'}</Text>
              </Stack>
              <Group gap="lg" justify="center" wrap="wrap">
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Customers
                  </Text>
                  <Text size="sm" fw={600}>
                    {booking.partySizeTotal}
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Rate
                  </Text>
                  <Text size="sm" fw={600}>
                    {booking.affiliateCommissionPerPerson != null
                      ? formatCurrency(booking.affiliateCommissionPerPerson, bookingCurrency)
                      : '-'}
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Commission
                  </Text>
                  <Text size="sm" fw={700}>
                    {formatCurrency(booking.affiliateCommissionAmount, bookingCurrency)}
                  </Text>
                </Stack>
              </Group>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
};

const renderAffiliateSalesPayoutCard = (staff: Pay) => {
  const affiliateSales = staff.affiliateSales;
  if (
    !affiliateSales ||
    affiliateSales.bookings.length === 0 ||
    affiliateSales.commissionTotal <= 0 ||
    !affiliateSales.bookings.some((booking) => booking.affiliateCommissionAmount > 0)
  ) {
    return null;
  }

  const currency = affiliateSales.currency ?? staff.payouts?.currency ?? DEFAULT_CURRENCY;
  const detailsHeight =
    affiliateSales.bookings.length > 6 ? Math.min(420, affiliateSales.bookings.length * 120 + 60) : undefined;
  const detailCards = renderAffiliateSalesBreakdownCards(staff);
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md" align="center">
        <Stack gap={4} align="center" ta="center">
          <Text fw={700} size="lg">
            Promotion Sales
          </Text>
          <Text fw={700} size="xl">
            {formatCurrency(affiliateSales.commissionTotal, currency)}
          </Text>
          <Text size="xs" c="dimmed">
            Total payout
          </Text>
        </Stack>
        <Group gap="xl" justify="center" wrap="wrap">
          <Stack gap={0} align="center">
            <Text size="xs" c="dimmed">
              Commission share
            </Text>
            <Text size="sm" fw={600}>
              {formatCurrency(affiliateSales.commissionTotal, currency)}
            </Text>
          </Stack>
          <Stack gap={0} align="center">
            <Text size="xs" c="dimmed">
              Customers
            </Text>
            <Text size="sm" fw={600}>
              {affiliateSales.peopleCount}
            </Text>
          </Stack>
        </Group>
        {detailCards && (
          <Stack gap="xs" pt="xs" style={{ width: '100%' }}>
            <Text size="xs" c="dimmed" ta="center">
              Details
            </Text>
            {detailsHeight ? (
              <ScrollArea mah={detailsHeight} offsetScrollbars>
                {detailCards}
              </ScrollArea>
            ) : (
              detailCards
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
};

const normalizeIncentiveLetter = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed[0].toUpperCase() : null;
};

const addIncentiveBadgeDetail = (
  details: IncentiveBadgeDetail[],
  next: IncentiveBadgeDetail,
): IncentiveBadgeDetail[] => {
  const existing = details.find((detail) => detail.letter === next.letter && detail.name === next.name);
  if (!existing) {
    return [...details, next];
  }
  if (next.amount !== null) {
    existing.amount = (existing.amount ?? 0) + next.amount;
  }
  return details;
};

const buildIncentiveLookup = (summary: Pay): Map<number, IncentiveBadgeDetail[]> => {
  const map = new Map<number, IncentiveBadgeDetail[]>();
  const details = summary.counterIncentiveDetails ?? {};
  Object.entries(details).forEach(([counterIdKey, incentiveDetails]) => {
    const counterId = Number(counterIdKey);
    if (!Number.isFinite(counterId) || counterId <= 0 || !Array.isArray(incentiveDetails)) {
      return;
    }
    const normalized = incentiveDetails.reduce<IncentiveBadgeDetail[]>((acc, detail) => {
      const letter = normalizeIncentiveLetter(detail.letter || detail.name);
      if (!letter) {
        return acc;
      }
      const amount = Number(detail.amount);
      return addIncentiveBadgeDetail(acc, {
        letter,
        name: detail.name?.trim() || 'Incentive',
        amount: Number.isFinite(amount) ? amount : 0,
      });
    }, []);
    if (normalized.length > 0) {
      map.set(counterId, normalized);
    }
  });

  const markers = summary.counterIncentiveMarkers ?? {};
  Object.entries(markers).forEach(([counterIdKey, letters]) => {
    const counterId = Number(counterIdKey);
    if (!Number.isFinite(counterId) || counterId <= 0 || !Array.isArray(letters)) {
      return;
    }
    const normalized = Array.from(
      new Set(
        letters
          .map((letter) => (typeof letter === 'string' && letter.trim().length > 0 ? letter.trim()[0].toUpperCase() : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalized.length > 0) {
      const existing = map.get(counterId) ?? [];
      const merged = normalized.reduce<IncentiveBadgeDetail[]>(
        (acc, letter) =>
          acc.some((detail) => detail.letter === letter)
            ? acc
            : [...acc, { letter, name: letter, amount: null }],
        existing,
      );
      map.set(counterId, merged);
    }
  });
  return map;
};

const renderIncentiveBadges = (
  counterId: number | null | undefined,
  incentiveLookup?: Map<number, IncentiveBadgeDetail[]>,
) => {
  if (counterId === undefined || counterId === null) {
    return null;
  }
  const details = incentiveLookup?.get(counterId);
  if (!details || details.length === 0) {
    return null;
  }

  return (
    <span style={{ marginLeft: 6, display: 'inline-flex', gap: 4 }}>
      {details.map((detail) => (
        <Tooltip
          key={`${counterId}-${detail.letter}-${detail.name}`}
          label={
            detail.amount === null
              ? detail.name
              : `${detail.name} - ${formatCurrency(detail.amount)}`
          }
          withArrow
          events={{ hover: true, focus: true, touch: true }}
        >
          <span
            tabIndex={0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              borderRadius: '50%',
              backgroundColor: '#edf2ff',
              color: '#3b5bdb',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'help',
            }}
          >
            {detail.letter}
          </span>
        </Tooltip>
      ))}
    </span>
  );
};

const hasPlatformGuestDetails = (summary: Pay): boolean =>
  Object.values(summary.platformGuestBreakdowns ?? {}).some(
    (tiers) => Array.isArray(tiers) && tiers.length > 0,
  );

const getCounterIncentiveAmount = (summary: Pay, counterId?: number | null) => {
  if (!counterId || counterId <= 0) {
    return 0;
  }
  const key = String(counterId);
  return summary.counterIncentiveTotals?.[key] ?? 0;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const renderBreakdownTable = (
  summary: Pay,
  items: Pay['breakdown'],
  incentiveLookup?: Map<number, IncentiveBadgeDetail[]>,
) => {
  const hasProduct = items.some((entry) => Boolean(entry.productName));
  const filteredItems = items.filter((entry) => {
    const incentiveAmount = getCounterIncentiveAmount(summary, entry.counterId);
    return incentiveAmount !== 0 || entry.commission !== 0;
  });
  if (filteredItems.length === 0) {
    return null;
  }
  return (
    <Table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Date</th>
          {hasProduct && <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Product</th>}
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Customers</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Guides</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Incentives</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Commission</th>
        </tr>
      </thead>
      <tbody>
        {filteredItems.map((entry, index) => (
          <tr key={`${entry.date}-${index}`}>
            <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>
              {entry.date}
              {renderIncentiveBadges(entry.counterId, incentiveLookup)}
            </td>
            {hasProduct && (
              <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>{entry.productName ?? '—'}</td>
            )}
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.customers}</td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.guidesCount}</td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>
              {formatCurrency(getCounterIncentiveAmount(summary, entry.counterId))}
            </td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>
              {formatCurrency(entry.commission)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const renderProductBreakdownTable = (
  summary: Pay,
  product: NonNullable<Pay['productTotals']>[number],
  incentiveLookup?: Map<number, IncentiveBadgeDetail[]>,
) => {
  const productCounterIds = new Set(product.counterIds ?? []);
  const items = summary.breakdown.filter((entry) => {
    if (productCounterIds.size > 0 && entry.counterId != null) {
      return productCounterIds.has(entry.counterId);
    }
    return (entry.productId ?? null) === (product.productId ?? null);
  });
  const filteredItems = items.filter((entry) => {
    const incentiveAmount = getCounterIncentiveAmount(summary, entry.counterId);
    return incentiveAmount !== 0 || entry.commission !== 0;
  });
  if (filteredItems.length === 0) {
    return null;
  }

  return (
    <Table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Date</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Customers</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Guides</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Incentives</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Commission</th>
        </tr>
      </thead>
      <tbody>
        {filteredItems.map((entry, index) => (
          <tr key={`${product.productId ?? 'legacy'}-${entry.counterId ?? index}-${entry.date}`}>
            <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>
              {entry.date}
              {renderIncentiveBadges(entry.counterId, incentiveLookup)}
            </td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.customers}</td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.guidesCount}</td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>
              {formatCurrency(getCounterIncentiveAmount(summary, entry.counterId))}
            </td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>
              {formatCurrency(entry.commission)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const renderProductBreakdownCards = (
  summary: Pay,
  product: NonNullable<Pay['productTotals']>[number],
  incentiveLookup?: Map<number, IncentiveBadgeDetail[]>,
) => {
  const productCounterIds = new Set(product.counterIds ?? []);
  const items = summary.breakdown.filter((entry) => {
    if (productCounterIds.size > 0 && entry.counterId != null) {
      return productCounterIds.has(entry.counterId);
    }
    return (entry.productId ?? null) === (product.productId ?? null);
  });
  const filteredItems = items.filter((entry) => {
    const incentiveAmount = getCounterIncentiveAmount(summary, entry.counterId);
    return incentiveAmount !== 0 || entry.commission !== 0;
  });
  if (filteredItems.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs">
      {filteredItems.map((entry, index) => {
        const incentiveAmount = getCounterIncentiveAmount(summary, entry.counterId);
        return (
          <Paper
            key={`${product.productId ?? 'legacy'}-${entry.counterId ?? index}-${entry.date}-card`}
            withBorder
            radius="md"
            p="sm"
            style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}
          >
            <Stack gap={8} align="center" ta="center">
              <Group gap={6} justify="center" wrap="wrap">
                <Text size="sm" fw={700}>
                  {dayjs(entry.date).isValid() ? dayjs(entry.date).format('MMM D, YYYY') : entry.date}
                </Text>
                {renderIncentiveBadges(entry.counterId, incentiveLookup)}
              </Group>
              <Group gap="lg" justify="center" wrap="wrap">
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Customers
                  </Text>
                  <Text size="sm" fw={600}>
                    {entry.customers}
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Guides
                  </Text>
                  <Text size="sm" fw={600}>
                    {entry.guidesCount}
                  </Text>
                </Stack>
              </Group>
              <Group gap="lg" justify="center" wrap="wrap">
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Incentives
                  </Text>
                  <Text size="sm" fw={700}>
                    {formatCurrency(incentiveAmount)}
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed">
                    Commission
                  </Text>
                  <Text size="sm" fw={700}>
                    {formatCurrency(entry.commission)}
                  </Text>
                </Stack>
              </Group>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
};

const renderProductTotals = (
  productTotals?: Pay['productTotals'],
  componentSummaries?: PayComponentSummary[],
  lockedComponents?: LockedComponentSummary[],
  staff?: Pay,
) => {
  const affiliateSalesCard = staff ? renderAffiliateSalesPayoutCard(staff) : null;
  if ((!productTotals || productTotals.length === 0) && !affiliateSalesCard) {
    return null;
  }

  const componentLookup = new Map<number, PayComponentSummary>();
  componentSummaries?.forEach((component) => {
    componentLookup.set(component.componentId, component);
  });
  const incentiveLookup = staff ? buildIncentiveLookup(staff) : undefined;

  return (
    <DetailAccordionSection title="Payout Details">
      <Stack gap="sm">
        {(productTotals ?? []).map((product, index) => {
          const componentBreakdown = product.componentTotals ?? [];
          const incentiveTotal = componentBreakdown.reduce((sum, component) => sum + component.amount, 0);
          const payoutTotal = product.totalCommission + incentiveTotal;
          const lockedForProduct =
            lockedComponents?.filter((entry) =>
              componentBreakdown.some((component) => component.componentId === entry.componentId),
            ) ?? [];
          const hasUnlockedComponent = componentBreakdown.some(
            (component) => !lockedForProduct.some((entry) => entry.componentId === component.componentId),
          );
          const detailTable = staff ? renderProductBreakdownTable(staff, product, incentiveLookup) : null;
          const detailCards = staff ? renderProductBreakdownCards(staff, product, incentiveLookup) : null;
          const detailTableHeight =
            staff && product.counterIds.length > 6 ? Math.min(360, product.counterIds.length * 42 + 60) : undefined;
          if (payoutTotal === 0) {
            return null;
          }
          return (
            <Card key={`${product.productId ?? 'legacy'}-${index}`} withBorder padding="md" radius="md">
              <Stack gap="md" align="center">
                <Stack gap={4} align="center" ta="center">
                  <Text fw={700} size="lg">
                    {product.productName}
                  </Text>
                  <Text fw={700} size="xl">
                    {formatCurrency(payoutTotal)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Total payout
                  </Text>
                </Stack>
                <Group gap="xl" justify="center" wrap="wrap">
                  <Stack gap={0} align="center">
                    <Text size="xs" c="dimmed">
                      Commission share
                    </Text>
                    <Text size="sm" fw={600}>
                      {formatCurrency(product.totalCommission)}
                    </Text>
                  </Stack>
                  <Stack gap={0} align="center">
                    <Text size="xs" c="dimmed">
                      Incentives share
                    </Text>
                    <Text size="sm" fw={600}>
                      {formatCurrency(incentiveTotal)}
                    </Text>
                  </Stack>
                </Group>
                {(componentBreakdown.length > 0 || (lockedComponents && lockedComponents.length > 0)) && (
                  <Stack gap="xs" style={{ width: '100%' }}>
                    {componentBreakdown.length > 0 && (
                      <>
                        {hasUnlockedComponent && (
                          <Text size="xs" c="dimmed" ta="center">
                            Incentives
                          </Text>
                        )}
                        {componentBreakdown.map((component) => {
                          const meta = componentLookup.get(component.componentId);
                          const isLocked = lockedComponents?.some((entry) => entry.componentId === component.componentId);
                          if (isLocked) {
                            return null;
                          }
                          return (
                            <Box key={`${product.productId ?? 'legacy'}-${component.componentId}`} style={BREAKDOWN_ROW_STYLE}>
                              <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
                              <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
                                {meta && (
                                  <Badge variant="light" color={getComponentColor(meta.category)} style={BREAKDOWN_ROW_BADGE_STYLE}>
                                    {meta.category}
                                  </Badge>
                                )}
                                <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>
                                  {meta?.name ?? `Component #${component.componentId}`}
                                </Text>
                              </Box>
                              <Text size="sm" fw={700} ta="center">
                                {formatCurrency(component.amount)}
                              </Text>
                              </Stack>
                            </Box>
                          );
                        })}
                      </>
                    )}
                    {lockedForProduct.length > 0 && (
                      <Stack gap={4} pt="xs">
                        <Text size="xs" c="dimmed" fw={600} ta="center">
                          Locked incentives
                        </Text>
                        {lockedForProduct.map((entry, lockedIdx) => {
                          const requirement = entry.requirement;
                          const reviewRequirement = requirement?.type === 'review_target' ? requirement : null;
                          const performanceRequirement =
                            requirement?.type === 'performance_tier' ? requirement : null;
                          return (
                          <Box key={`${entry.componentId}-locked-${lockedIdx}`} style={BREAKDOWN_ROW_STYLE}>
                            <Stack gap={4} style={BREAKDOWN_ROW_CENTER_STYLE}>
                              <Box style={BREAKDOWN_ROW_HEADER_STYLE}>
                                <Badge variant="light" color="red" style={BREAKDOWN_ROW_BADGE_STYLE}>
                                  {entry.category}
                                </Badge>
                                <Text size="sm" fw={500} style={BREAKDOWN_ROW_TITLE_STYLE}>
                                  {entry.name}
                                </Text>
                              </Box>
                              {reviewRequirement && (
                                <Text size="xs" c="dimmed" ta="center">
                                  Needs {reviewRequirement.minReviews} reviews, current {reviewRequirement.actualReviews}
                                </Text>
                              )}
                              {performanceRequirement && (
                                <Text size="xs" c="dimmed" ta="center">
                                  Completed {performanceRequirement.progressPercent.toFixed(2)}%, multiplier{' '}
                                  {performanceRequirement.multiplier.toFixed(2)}x
                                </Text>
                              )}
                              <Stack gap={0} align="center">
                                <Text size="sm" fw={700} c="red.6" ta="center">
                                  {formatCurrency(entry.amount)}
                                </Text>
                                <Text size="xs" c="dimmed" ta="center">
                                  Not included
                                </Text>
                              </Stack>
                            </Stack>
                          </Box>
                        )})}
                      </Stack>
                    )}
                  </Stack>
                )}
                {(detailCards || detailTable) && (
                  <Stack gap="xs" pt="xs" style={{ width: '100%' }}>
                    <Text size="xs" c="dimmed" ta="center">
                      Details
                    </Text>
                    {detailCards ?? (detailTableHeight ? (
                      <ScrollArea mah={detailTableHeight} offsetScrollbars>
                        {detailTable}
                      </ScrollArea>
                    ) : (
                      detailTable
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>
          );
        })}
        {affiliateSalesCard}
      </Stack>
    </DetailAccordionSection>
  );
};

const Pays: React.FC = () => {
  const dispatch = useAppDispatch();
  const payState = useAppSelector((state) => state.pays)[0];
  const roleSlug = useAppSelector((state) => state.session.roleSlug ?? null);
  const { data: responseData, loading, error } = payState;
  const compensationComponentState = useAppSelector((state) => state.compensationComponents)[0];
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const fullAccess = useModuleAccess(FULL_ACCESS_MODULE);
  const selfAccess = useModuleAccess(SELF_ACCESS_MODULE);
  const canManageReceiptEvidence = ['admin', 'administrator', 'manager', 'owner'].includes(
    String(roleSlug ?? '').trim().toLowerCase(),
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryLookup = useMemo(() => {
    const map = new Map<string, FinanceCategory>();
    categories.data.forEach((category) => {
      map.set(category.name.toLowerCase(), category);
    });
    return map;
  }, [categories.data]);

  const today = dayjs();
  const initialUrlStart = parseUrlDate(searchParams.get(URL_START_DATE_PARAM));
  const initialUrlEnd = parseUrlDate(searchParams.get(URL_END_DATE_PARAM));
  const initialUrlPreset = searchParams.get(URL_PRESET_PARAM);
  const initialDatePreset: DatePreset = isDatePreset(initialUrlPreset)
    ? initialUrlPreset
    : initialUrlStart && initialUrlEnd
    ? 'custom'
    : 'this_month';
  const initialRange =
    initialDatePreset === 'custom' && initialUrlStart && initialUrlEnd
      ? { start: initialUrlStart.startOf('day'), end: initialUrlEnd.endOf('day') }
      : calculatePresetRange(initialDatePreset, today);
  const [datePreset, setDatePreset] = useState<DatePreset>(initialDatePreset);
  const [startDate, setStartDate] = useState<Dayjs | null>(initialRange.start);
  const [endDate, setEndDate] = useState<Dayjs | null>(initialRange.end);
  const [customRangeValue, setCustomRangeValue] = useState<[Date | null, Date | null]>([
    initialRange.start.toDate(),
    initialRange.end.toDate(),
  ]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selfDetailsOpen, setSelfDetailsOpen] = useState(false);
  const [entryModal, setEntryModal] = useState<EntryModalState>(createEmptyEntryModalState());
  const [paidEntriesModal, setPaidEntriesModal] = useState<PaidEntriesModalState>(createEmptyPaidEntriesModalState());
  const [receiptEvidenceModal, setReceiptEvidenceModal] = useState<ReceiptEvidenceModalState>(
    createEmptyReceiptEvidenceModalState(),
  );
  const [receiptHistoryBrowserModal, setReceiptHistoryBrowserModal] =
    useState<ReceiptHistoryBrowserModalState>(createEmptyReceiptHistoryBrowserModalState());
  const [openingBalanceDetailsOpen, setOpeningBalanceDetailsOpen] = useState(false);
  const [ledgerRecalculating, setLedgerRecalculating] = useState(false);
  const [ledgerRecalculationMessage, setLedgerRecalculationMessage] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);
  const [entryMessage, setEntryMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [paidEntriesSubmitting, setPaidEntriesSubmitting] = useState(false);
  const [paidEntriesMessage, setPaidEntriesMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [actionAlert, setActionAlert] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [baseOverridePending, setBaseOverridePending] = useState<Set<number>>(new Set());
  const desktopTableContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopTableHeaderRef = useRef<HTMLTableSectionElement | null>(null);
  const receiptEvidenceRequestRef = useRef(0);
  const receiptHistoryBrowserRequestRef = useRef(0);
  const receiptEvidenceUrlsRef = useRef<{ photoUrl: string | null; signatureUrl: string | null }>({
    photoUrl: null,
    signatureUrl: null,
  });
  const [fixedDesktopHeader, setFixedDesktopHeader] = useState<FixedDesktopHeaderState>({
    visible: false,
    left: 0,
    width: 0,
    columnWidths: [],
  });
  const friendlyError = error ? humanizeErrorMessage(error) : null;
  const currencyLabel = (entryModal.currency || DEFAULT_CURRENCY).toUpperCase();

  useEffect(() => {
    if (datePreset === 'custom') {
      const [start, end] = customRangeValue;
      if (start && end) {
        setStartDate(dayjs(start).startOf('day'));
        setEndDate(dayjs(end).endOf('day'));
      }
      return;
    }
    const range = calculatePresetRange(datePreset);
    setStartDate(range.start);
    setEndDate(range.end);
  }, [datePreset, customRangeValue]);

  useEffect(() => {
    if (!startDate || !endDate) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    const startParam = startDate.format(URL_DATE_FORMAT);
    const endParam = endDate.format(URL_DATE_FORMAT);
    const currentPreset = nextParams.get(URL_PRESET_PARAM);
    const currentStart = nextParams.get(URL_START_DATE_PARAM);
    const currentEnd = nextParams.get(URL_END_DATE_PARAM);

    if (currentPreset === datePreset && currentStart === startParam && currentEnd === endParam) {
      return;
    }

    nextParams.set(URL_PRESET_PARAM, datePreset);
    nextParams.set(URL_START_DATE_PARAM, startParam);
    nextParams.set(URL_END_DATE_PARAM, endParam);
    setSearchParams(nextParams, { replace: true });
  }, [datePreset, endDate, searchParams, setSearchParams, startDate]);

  useEffect(() => {
    if (!accounts.loading && accounts.data.length === 0) {
      void dispatch(fetchFinanceAccounts());
    }
  }, [dispatch, accounts.data.length, accounts.loading]);

  useEffect(() => {
    if (!categories.loading && categories.data.length === 0) {
      void dispatch(fetchFinanceCategories());
    }
  }, [dispatch, categories.data.length, categories.loading]);

  const financeVendorsById = useMemo(() => {
    const map = new Map<number, FinanceVendor>();
    vendors.data.forEach((vendor) => {
      if (typeof vendor.id === 'number') {
        map.set(vendor.id, vendor);
      }
    });
    return map;
  }, [vendors.data]);

  const accountOptions = useMemo(
    () =>
      accounts.data
        .filter(
          (account) =>
            (account.type === 'cash' || account.type === 'bank')
            && (account.isActive ?? true)
            && account.currency.toUpperCase() === (entryModal.currency || DEFAULT_CURRENCY).toUpperCase(),
        )
        .map((account) => ({
          value: String(account.id),
          label: `${account.name} (${account.currency})`,
        })),
    [accounts.data, entryModal.currency],
  );

  const expenseCategoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.kind === 'expense')
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categories.data],
  );

  const componentDefinitions = useMemo<CompensationComponent[]>(() => {
    const payload =
      (compensationComponentState.data as ServerResponse<CompensationComponent> | undefined) ?? [];
    const records = payload[0]?.data ?? [];
    return [...records] as CompensationComponent[];
  }, [compensationComponentState.data]);

  const compensationComponentLookup = useMemo(() => {
    const map = new Map<number, CompensationComponent>();
    componentDefinitions.forEach((component) => {
      map.set(component.id, component);
    });
    return map;
  }, [componentDefinitions]);

  const accountList = accounts.data;

  const financeAccountsById = useMemo(() => {
    const map = new Map<number, (typeof accountList)[number]>();
    accountList.forEach((account) => {
      map.set(account.id, account);
    });
    return map;
  }, [accountList]);

  useEffect(() => {
    if (!vendors.loading && vendors.data.length === 0) {
      void dispatch(fetchFinanceVendors());
    }
  }, [dispatch, vendors.data.length, vendors.loading]);

const resolveStaffCounterpartyDefaults = useCallback(
  (staff: Pay) => {
    let counterpartyId = '';
    let categoryId = '';
    const vendorId = staff.financeVendorId;
      if (vendorId) {
        counterpartyId = String(vendorId);
        const defaultCategoryId = financeVendorsById.get(vendorId)?.defaultCategoryId;
        if (defaultCategoryId) {
          categoryId = String(defaultCategoryId);
        }
      }
      return { counterpartyId, categoryId };
  },
  [financeVendorsById],
);

  const summaries: Pay[] = useMemo(
    () =>
      (responseData?.[0]?.data ?? []).filter((summary) => {
        const currentPayout = normalizeTotal(summary);
        const openingBalance = summary.openingBalance ?? 0;
        const outstanding = summary.closingBalance ?? summary.payouts?.payableOutstanding ?? 0;
        const grossActivity = summary.grossCompensationTotal ?? 0;
        const fundActivity = summary.volunteerFundAllocationTotal ?? 0;
        const fundOutstanding = summary.volunteerFundOutstandingTotal ?? 0;
        return currentPayout > 0
          || openingBalance !== 0
          || outstanding !== 0
          || grossActivity !== 0
          || fundActivity > 0
          || fundOutstanding > 0;
      }),
    [responseData],
  );
  const openingBalanceDetailRows: OpeningBalanceDetailRow[] = useMemo(
    () =>
      summaries
        .map((staff) => ({
          staff,
          openingBalance: staff.openingBalance ?? 0,
        }))
        .filter((row) => row.openingBalance !== 0),
    [summaries],
  );

  const isCanonicalRange = useMemo(() => {
    if (summaries.length > 0) {
      return summaries.every((summary) => summary.rangeIsCanonical !== false);
    }
    if (startDate && endDate) {
      return (
        startDate.isSame(startDate.startOf('month'), 'day') &&
        endDate.isSame(startDate.endOf('month'), 'day') &&
        startDate.isSame(endDate, 'month') &&
        startDate.year() === endDate.year()
      );
    }
    return true;
  }, [summaries, startDate, endDate]);

  const permissionsReady = fullAccess.ready || selfAccess.ready;
  const permissionsLoading = fullAccess.loading || selfAccess.loading;
  const canViewFull = fullAccess.ready && fullAccess.canView;
  const canViewSelf = selfAccess.ready && selfAccess.canView;
  const usingSelfScope = !canViewFull && canViewSelf;
  const scopeParam = usingSelfScope ? 'self' : undefined;

  useEffect(() => {
    if (!canViewFull) {
      return;
    }
    if (!compensationComponentState.loading && componentDefinitions.length === 0) {
      void dispatch(fetchCompensationComponents());
    }
  }, [canViewFull, componentDefinitions.length, compensationComponentState.loading, dispatch]);

  const canRecordPayments = isCanonicalRange;
  const canRecordStaffPayments = canRecordPayments && canViewFull && canManageReceiptEvidence;

  const refetchPaysForRange = useCallback(
    async (rangeStartOverride?: string, rangeEndOverride?: string) => {
      const refetchStart = rangeStartOverride ?? startDate?.format('YYYY-MM-DD');
      const refetchEnd = rangeEndOverride ?? endDate?.format('YYYY-MM-DD');
      if (!refetchStart || !refetchEnd) {
        return;
      }
      await dispatch(
        fetchPays({
          startDate: refetchStart,
          endDate: refetchEnd,
          scope: scopeParam,
        }),
      );
    },
    [dispatch, endDate, scopeParam, startDate],
  );

  const handleRecalculateLedger = useCallback(async () => {
    if (!startDate || !endDate || ledgerRecalculating) {
      return;
    }
    if (!window.confirm('Recalculate all monthly staff ledgers through the previous month? Recorded payments will not be changed.')) {
      return;
    }
    setLedgerRecalculating(true);
    setLedgerRecalculationMessage(null);
    try {
      const firstLedgerMonth = dayjs('2025-10-01').startOf('month');
      const lastPreviousMonth = startDate.subtract(1, 'month').startOf('month');
      let month = firstLedgerMonth;
      let recalculatedMonths = 0;
      while (!month.isAfter(lastPreviousMonth, 'month')) {
        await axiosInstance.get('/reports/getCommissionByDateRange', {
          params: {
            startDate: month.format('YYYY-MM-DD'),
            endDate: month.endOf('month').format('YYYY-MM-DD'),
          },
          withCredentials: true,
        });
        recalculatedMonths += 1;
        month = month.add(1, 'month');
      }
      await refetchPaysForRange(startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD'));
      setLedgerRecalculationMessage({
        type: 'success',
        text: `Recalculated ${recalculatedMonths} previous month${recalculatedMonths === 1 ? '' : 's'} and refreshed the current balance.`,
      });
    } catch (recalculationError) {
      setLedgerRecalculationMessage({
        type: 'error',
        text: recalculationError instanceof Error ? recalculationError.message : 'Unable to recalculate the ledger.',
      });
    } finally {
      setLedgerRecalculating(false);
    }
  }, [endDate, ledgerRecalculating, refetchPaysForRange, startDate]);

  const updateBaseOverridePending = useCallback((userId: number, active: boolean) => {
    setBaseOverridePending((prev) => {
      const next = new Set(prev);
      if (active) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  }, []);

  const handleApproveBaseOverride = useCallback(
    async (staff: Pay) => {
      if (!staff.userId) {
        setActionAlert({ type: 'error', text: 'Unable to approve base override without a staff member.' });
        return;
      }
      if (staff.rangeIsCanonical === false) {
        setActionAlert({
          type: 'error',
          text: 'Switch to a full monthly range before approving extra base days.',
        });
        return;
      }
      const resolvedStart =
        staff.range?.startDate ?? startDate?.startOf('month').format('YYYY-MM-DD') ?? null;
      if (!resolvedStart) {
        setActionAlert({ type: 'error', text: 'Unable to determine the approval period.' });
        return;
      }
      const periodStart = dayjs(resolvedStart).startOf('month').format('YYYY-MM-DD');
      updateBaseOverridePending(staff.userId, true);
      setActionAlert(null);
      try {
        await updateReviewMonthlyApproval(staff.userId, {
          periodStart,
          baseOverrideApproved: true,
        });
        const refetchStart = startDate?.format('YYYY-MM-DD') ?? staff.range?.startDate ?? periodStart;
        const refetchEnd = endDate?.format('YYYY-MM-DD') ?? staff.range?.endDate ?? periodStart;
        await refetchPaysForRange(refetchStart, refetchEnd);
        setActionAlert({
          type: 'success',
          text: `Approved extra base days for ${formatPayStaffName(staff)}.`,
        });
      } catch (approvalError) {
        const message =
          approvalError instanceof Error
            ? approvalError.message
            : 'Failed to approve extra base days.';
        setActionAlert({ type: 'error', text: message });
      } finally {
        updateBaseOverridePending(staff.userId, false);
      }
    },
    [endDate, refetchPaysForRange, startDate, updateBaseOverridePending],
  );


  const updateLines = useCallback((updater: (lines: EntryPaymentLine[]) => EntryPaymentLine[]) => {
    setEntryModal((prev) => {
      const nextLines = updater(prev.lines);
      return {
        ...prev,
        lines: nextLines,
        amount: computeSelectedLineTotal(nextLines),
      };
    });
  }, []);

  const handleLineChange = useCallback(
    (lineId: string, changes: Partial<EntryPaymentLine>) => {
      updateLines((lines) =>
        lines.map((line) => (line.id === lineId ? { ...line, ...changes } : line)),
      );
    },
    [updateLines],
  );

  const handleAddManualLine = useCallback(() => {
    setEntryModal((prev) => {
      const newLine: EntryPaymentLine = {
        id: createLineId(),
        label: 'Manual line',
        labelEditable: true,
        amount: 0,
        categoryId: prev.categoryId,
        accountId: prev.accountId,
        description: '',
        include: true,
      };
      const nextLines = [...prev.lines, newLine];
      return {
        ...prev,
        lines: nextLines,
        amount: computeSelectedLineTotal(nextLines),
      };
    });
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setEntryModal((prev) => {
      if (prev.lines.length <= 1) {
        const resetLine: EntryPaymentLine = {
          ...(prev.lines[0] ?? {
            id: createLineId(),
            label: 'Manual line',
            labelEditable: true,
            amount: 0,
            categoryId: prev.categoryId,
            accountId: prev.accountId,
            description: '',
            include: true,
          }),
          amount: 0,
          include: true,
        };
        return {
          ...prev,
          lines: [resetLine],
          amount: 0,
        };
      }
      const nextLines = prev.lines.filter((line) => line.id !== lineId);
      return {
        ...prev,
        lines: nextLines,
        amount: computeSelectedLineTotal(nextLines),
      };
    });
  }, []);

  const openEntryModal = useCallback(
    (staff: Pay) => {
      if (!canRecordPayments) {
        setEntryMessage({
          type: 'error',
          text: 'Switch to a full-month range before recording payouts.',
        });
        return;
      }
      if (staff.settlementReconciliationRequired) {
        setEntryMessage({
          type: 'error',
          text:
            staff.settlementReconciliationMessage
            ?? 'This closed period must be reconciled before more compensation can be processed.',
        });
        return;
      }
      if (!canViewFull) {
        setEntryMessage({
          type: 'error',
          text: 'You do not have permission to record payouts for this view.',
        });
        return;
      }
      const defaults = resolveStaffCounterpartyDefaults(staff);
      const currency = staff.payouts?.currency ?? DEFAULT_CURRENCY;
      const rangeStartValue =
        staff.range?.startDate ?? startDate?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD');
      const rangeEndValue =
        staff.range?.endDate ?? endDate?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD');

      const defaultLines = buildDefaultPaymentLines(
        staff,
        categoryLookup,
        defaults.categoryId,
        compensationComponentLookup,
      ).map((line) => {
        if (!line.accountId) {
          return line;
        }
        const defaultAccount = financeAccountsById.get(Number(line.accountId));
        return defaultAccount
          && defaultAccount.isActive
          && defaultAccount.currency.toUpperCase() === currency.toUpperCase()
            ? line
            : { ...line, accountId: '' };
      });
      const defaultFundAllocations = buildDefaultFundAllocationLines(staff);
      const selectedTotal = computeSelectedLineTotal(defaultLines);
      const uniqueAccounts = new Set(
        defaultLines.map((line) => line.accountId).filter((value): value is string => Boolean(value)),
      );
      const defaultLineAccount = uniqueAccounts.size === 1 ? uniqueAccounts.values().next().value ?? '' : '';
      const reimbursementSummary = staff.reimbursements ?? {
        awaitingAmount: 0,
        reimbursedAmount: 0,
        entries: [],
      };
      const reimbursementCategoryId = findCategoryIdByName(categoryLookup, 'reimbursements', defaults.categoryId);
      setEntryModal({
        open: true,
        staff,
        amount: selectedTotal,
        currency,
        date: new Date(),
        accountId: defaultLineAccount || '',
        categoryId: defaults.categoryId,
        counterpartyId: defaults.counterpartyId,
        description: `Staff payout for ${formatPayStaffName(staff)} (${formatRangeLabel(rangeStartValue, rangeEndValue)})`,
        rangeStart: rangeStartValue,
        rangeEnd: rangeEndValue,
        lines: defaultLines,
        fundAllocations: defaultFundAllocations,
        includeReimbursements: reimbursementSummary.awaitingAmount > 0,
        reimbursementEntries: reimbursementSummary.entries ?? [],
        reimbursementsAwaitingAmount: reimbursementSummary.awaitingAmount ?? 0,
        reimbursementCategoryId,
      });
      setEntryMessage(null);
    },
    [
      canRecordPayments,
      canViewFull,
      categoryLookup,
      compensationComponentLookup,
      endDate,
      financeAccountsById,
      resolveStaffCounterpartyDefaults,
      startDate,
    ],
  );

  const openPaidEntriesModal = useCallback(
    (staff: Pay) => {
      if (!canRecordPayments) {
        setPaidEntriesMessage({
          type: 'error',
          text: 'Switch to a full-month range before adjusting recorded payouts.',
        });
        return;
      }
      if (!canViewFull) {
        setPaidEntriesMessage({
          type: 'error',
          text: 'You do not have permission to adjust recorded payouts for this view.',
        });
        return;
      }
      const availableEntries = (staff.paidEntries ?? []).filter((entry) => entry.canDelete);
      setPaidEntriesModal({
        open: true,
        staff,
        selectedIds: availableEntries.map((entry) => entry.id),
      });
      setPaidEntriesMessage(null);
    },
    [canRecordPayments, canViewFull],
  );

  const closePaidEntriesModal = useCallback(() => {
    setPaidEntriesModal(createEmptyPaidEntriesModalState());
    setPaidEntriesMessage(null);
  }, []);

  const closeReceiptHistoryBrowserModal = useCallback(() => {
    receiptHistoryBrowserRequestRef.current += 1;
    setReceiptHistoryBrowserModal(createEmptyReceiptHistoryBrowserModalState());
  }, []);

  const openStaffReceiptHistory = useCallback(
    async (staff: Pay) => {
      const requestId = receiptHistoryBrowserRequestRef.current + 1;
      receiptHistoryBrowserRequestRef.current = requestId;
      setReceiptHistoryBrowserModal({
        ...createEmptyReceiptHistoryBrowserModalState(),
        open: true,
        staff,
        loading: true,
      });

      const staffUserId = staff.staffProfileId ?? staff.userId ?? null;
      if (!Number.isInteger(staffUserId) || Number(staffUserId) <= 0 || !startDate || !endDate) {
        setReceiptHistoryBrowserModal((current) => ({
          ...current,
          loading: false,
          error: 'Unable to identify this staff member or the selected payout period.',
        }));
        return;
      }

      try {
        const response = await axiosInstance.get<PayPayoutReceiptHistoryResponse>(
          '/reports/staffPayouts/receipts/history',
          {
            params: {
              staffUserId,
              startDate: startDate.format(URL_DATE_FORMAT),
              endDate: endDate.format(URL_DATE_FORMAT),
            },
            withCredentials: true,
          },
        );
        if (receiptHistoryBrowserRequestRef.current !== requestId) {
          return;
        }
        setReceiptHistoryBrowserModal({
          open: true,
          staff,
          receipts: response.data.receipts ?? [],
          loading: false,
          error: null,
          hasMore: response.data.hasMore ?? false,
        });
      } catch (historyError) {
        if (receiptHistoryBrowserRequestRef.current !== requestId) {
          return;
        }
        setReceiptHistoryBrowserModal((current) => ({
          ...current,
          loading: false,
          error: extractRequestErrorMessage(historyError, 'Unable to load receipt history.'),
        }));
      }
    },
    [endDate, startDate],
  );

  const closeReceiptEvidenceModal = useCallback(() => {
    receiptEvidenceRequestRef.current += 1;
    const currentUrls = receiptEvidenceUrlsRef.current;
    if (currentUrls.photoUrl) {
      URL.revokeObjectURL(currentUrls.photoUrl);
    }
    if (currentUrls.signatureUrl) {
      URL.revokeObjectURL(currentUrls.signatureUrl);
    }
    receiptEvidenceUrlsRef.current = { photoUrl: null, signatureUrl: null };
    setReceiptEvidenceModal(createEmptyReceiptEvidenceModalState());
    void refetchPaysForRange();
  }, [refetchPaysForRange]);

  useEffect(
    () => () => {
      receiptEvidenceRequestRef.current += 1;
      receiptHistoryBrowserRequestRef.current += 1;
      const currentUrls = receiptEvidenceUrlsRef.current;
      if (currentUrls.photoUrl) {
        URL.revokeObjectURL(currentUrls.photoUrl);
      }
      if (currentUrls.signatureUrl) {
        URL.revokeObjectURL(currentUrls.signatureUrl);
      }
      receiptEvidenceUrlsRef.current = { photoUrl: null, signatureUrl: null };
    },
    [],
  );

  const openReceiptEvidenceModal = useCallback(async (receiptId: number) => {
    const requestId = receiptEvidenceRequestRef.current + 1;
    receiptEvidenceRequestRef.current = requestId;
    const currentUrls = receiptEvidenceUrlsRef.current;
    if (currentUrls.photoUrl) {
      URL.revokeObjectURL(currentUrls.photoUrl);
    }
    if (currentUrls.signatureUrl) {
      URL.revokeObjectURL(currentUrls.signatureUrl);
    }
    receiptEvidenceUrlsRef.current = { photoUrl: null, signatureUrl: null };
    setReceiptEvidenceModal({
      ...createEmptyReceiptEvidenceModalState(),
      open: true,
      receiptId,
      loading: true,
      historyLoading: true,
    });

    let nextPhotoUrl: string | null = null;
    let nextSignatureUrl: string | null = null;
    try {
      const detailResponse = await axiosInstance.get<PayPayoutReceiptDetail>(
        `/reports/staffPayouts/receipts/${receiptId}`,
        { withCredentials: true },
      );
      const detail = detailResponse.data;
      const historyRequest = axiosInstance
        .get<PayPayoutReceiptHistoryResponse>('/reports/staffPayouts/receipts/history', {
          params: buildPayReceiptHistoryLookupParams(detail),
          withCredentials: true,
        })
        .then((response) => ({ response, error: null as string | null }))
        .catch((historyError: unknown) => ({
          response: null,
          error: extractRequestErrorMessage(historyError, 'Unable to load receipt history.'),
        }));
      const [photoResponse, signatureResponse, historyResult] = await Promise.all([
        detail.hasPhoto
          ? axiosInstance.get(`/reports/staffPayouts/receipts/${receiptId}/photo`, {
              responseType: 'blob',
              withCredentials: true,
            })
          : Promise.resolve(null),
        detail.hasSignature
          ? axiosInstance.get(`/reports/staffPayouts/receipts/${receiptId}/signature`, {
              responseType: 'blob',
              withCredentials: true,
            })
          : Promise.resolve(null),
        historyRequest,
      ]);
      nextPhotoUrl = photoResponse ? URL.createObjectURL(photoResponse.data) : null;
      nextSignatureUrl = signatureResponse ? URL.createObjectURL(signatureResponse.data) : null;

      if (receiptEvidenceRequestRef.current !== requestId) {
        if (nextPhotoUrl) {
          URL.revokeObjectURL(nextPhotoUrl);
        }
        if (nextSignatureUrl) {
          URL.revokeObjectURL(nextSignatureUrl);
        }
        return;
      }

      receiptEvidenceUrlsRef.current = {
        photoUrl: nextPhotoUrl,
        signatureUrl: nextSignatureUrl,
      };
      setReceiptEvidenceModal({
        open: true,
        receiptId,
        detail,
        loading: false,
        error: null,
        photoUrl: nextPhotoUrl,
        signatureUrl: nextSignatureUrl,
        history: historyResult.response?.data.receipts ?? [],
        historyLoading: false,
        historyError: historyResult.error,
        historyHasMore: historyResult.response?.data.hasMore ?? false,
      });
    } catch (receiptError) {
      if (nextPhotoUrl) {
        URL.revokeObjectURL(nextPhotoUrl);
      }
      if (nextSignatureUrl) {
        URL.revokeObjectURL(nextSignatureUrl);
      }
      if (receiptEvidenceRequestRef.current !== requestId) {
        return;
      }
      setReceiptEvidenceModal((current) => ({
        ...current,
        loading: false,
        historyLoading: false,
        error: extractRequestErrorMessage(receiptError, 'Unable to load this payout receipt.'),
      }));
    }
  }, []);

  const openReceiptFromHistoryBrowser = useCallback(
    (receiptId: number) => {
      closeReceiptHistoryBrowserModal();
      void openReceiptEvidenceModal(receiptId);
    },
    [closeReceiptHistoryBrowserModal, openReceiptEvidenceModal],
  );

  const handleTogglePaidEntry = useCallback((entryId: number, checked: boolean) => {
    setPaidEntriesModal((prev) => {
      const nextSelected = checked
        ? Array.from(new Set([...prev.selectedIds, entryId]))
        : prev.selectedIds.filter((id) => id !== entryId);
      return {
        ...prev,
        selectedIds: nextSelected,
      };
    });
  }, []);

  const renderRecordAction = (item: Pay, options?: { fullWidth?: boolean }) => {
    const outstanding = Math.max(item.closingBalance ?? item.payouts?.payableOutstanding ?? 0, 0);
    const fundOutstanding = item.volunteerFundOutstandingTotal ?? 0;
    const hasRecordedEntries = (item.paidEntries?.length ?? 0) > 0;
    const recordedReceipts = (item.paidEntries ?? [])
      .map((entry) => entry.receipt)
      .filter((receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt));
    const receiptForStatus =
      recordedReceipts.find((receipt) => receipt.status === 'pending') ??
      recordedReceipts.find((receipt) => receipt.status === 'completed') ??
      recordedReceipts[0] ??
      null;
    const receiptStatus = receiptForStatus ? getPayReceiptStatusMeta(receiptForStatus) : null;
    const fullWidth = options?.fullWidth ?? false;
    if (!canRecordPayments) {
      return (
        <Stack gap={6} align={fullWidth ? 'stretch' : 'flex-start'} style={fullWidth ? { width: '100%' } : undefined}>
          <Text size="xs" c="dimmed" ta={fullWidth ? 'center' : undefined}>
            View-only range
          </Text>
          {canManageReceiptEvidence ? (
            <Button
              variant="subtle"
              size="xs"
              fullWidth={fullWidth}
              leftSection={<IconHistory size={15} />}
              onClick={() => void openStaffReceiptHistory(item)}
            >
              Receipt history
            </Button>
          ) : null}
        </Stack>
      );
    }
    if (item.settlementReconciliationRequired) {
      return (
        <Stack gap={6} align={fullWidth ? 'stretch' : 'flex-start'} style={fullWidth ? { width: '100%' } : undefined}>
          <Badge color="red" variant="light" w="fit-content">
            Reconciliation required
          </Badge>
          <Text size="xs" c="red.8" maw={260}>
            {item.settlementReconciliationMessage
              ?? 'The saved liability and historical source breakdown no longer match.'}
          </Text>
          {canRecordStaffPayments && hasRecordedEntries ? (
            <Button variant="subtle" size="xs" color="red" fullWidth={fullWidth} onClick={() => openPaidEntriesModal(item)}>
              Manage paid
            </Button>
          ) : null}
          {canManageReceiptEvidence ? (
            <Button
              variant="subtle"
              size="xs"
              fullWidth={fullWidth}
              leftSection={<IconHistory size={15} />}
              onClick={() => void openStaffReceiptHistory(item)}
            >
              Receipt history
            </Button>
          ) : null}
        </Stack>
      );
    }
    if (outstanding > 0 || fundOutstanding > 0) {
      if (canRecordStaffPayments) {
        return (
          <Stack gap={6} align={fullWidth ? 'stretch' : 'flex-start'} style={fullWidth ? { width: '100%' } : undefined}>
            {receiptStatus ? (
              <Badge color={receiptStatus.color} variant="light" w="fit-content">
                {receiptStatus.label}
              </Badge>
            ) : null}
            <Button variant="light" size="xs" fullWidth={fullWidth} onClick={() => openEntryModal(item)}>
              Process compensation
            </Button>
            {hasRecordedEntries ? (
              <Button variant="subtle" size="xs" color="red" fullWidth={fullWidth} onClick={() => openPaidEntriesModal(item)}>
                Manage paid
              </Button>
            ) : null}
            {canManageReceiptEvidence ? (
              <Button
                variant="subtle"
                size="xs"
                fullWidth={fullWidth}
                leftSection={<IconHistory size={15} />}
                onClick={() => void openStaffReceiptHistory(item)}
              >
                Receipt history
              </Button>
            ) : null}
          </Stack>
        );
      }
      return (
        <></>
      );
    }
    return (
      <Stack gap={6} align={fullWidth ? 'center' : 'flex-start'} style={fullWidth ? { width: '100%' } : undefined}>
        <Badge color="green" variant="light" w="fit-content">
          Settled
        </Badge>
        {receiptStatus ? (
          <Badge color={receiptStatus.color} variant="light" w="fit-content">
            {receiptStatus.label}
          </Badge>
        ) : null}
        {canRecordStaffPayments && hasRecordedEntries ? (
          <Button variant="subtle" size="xs" color="red" fullWidth={fullWidth} onClick={() => openPaidEntriesModal(item)}>
            Manage paid
          </Button>
        ) : null}
        {canManageReceiptEvidence ? (
          <Button
            variant="subtle"
            size="xs"
            fullWidth={fullWidth}
            leftSection={<IconHistory size={15} />}
            onClick={() => void openStaffReceiptHistory(item)}
          >
            Receipt history
          </Button>
        ) : null}
      </Stack>
    );
  };

  const closeEntryModal = useCallback(() => {
    setEntryModal(createEmptyEntryModalState());
    setEntryMessage(null);
  }, []);

  const handleEntryAccountChange = useCallback(
    (value: string | null) => {
      setEntryModal((prev) => ({
        ...prev,
        accountId: value ?? '',
        lines: prev.lines.map((line) => (
          !line.accountId || line.accountId === prev.accountId
            ? { ...line, accountId: value ?? '' }
            : line
        )),
      }));
    },
    [],
  );

  const handlePresetChange = (value: string | null) => {
    if (!value) {
      return;
    }
    setDatePreset(value as DatePreset);
  };

  const handleCustomRangeChange = (value: [Date | null, Date | null] | null) => {
    setCustomRangeValue(value ?? [null, null]);
  };

  const applyDateRange = useCallback(
    (rangeStart: Dayjs, rangeEnd: Dayjs) => {
      const normalizedStart = rangeStart.startOf('day');
      const normalizedEnd = rangeEnd.endOf('day');
      const thisMonthRange = calculatePresetRange('this_month', today);
      const lastMonthRange = calculatePresetRange('last_month', today);

      setStartDate(normalizedStart);
      setEndDate(normalizedEnd);
      setCustomRangeValue([normalizedStart.toDate(), normalizedEnd.toDate()]);

      if (
        normalizedStart.isSame(thisMonthRange.start, 'day') &&
        normalizedEnd.isSame(thisMonthRange.end, 'day')
      ) {
        setDatePreset('this_month');
        return;
      }

      if (
        normalizedStart.isSame(lastMonthRange.start, 'day') &&
        normalizedEnd.isSame(lastMonthRange.end, 'day')
      ) {
        setDatePreset('last_month');
        return;
      }

      setDatePreset('custom');
    },
    [today],
  );

  const handleShiftPeriod = useCallback(
    (direction: -1 | 1) => {
      if (!startDate || !endDate) {
        return;
      }

      const isFullMonth =
        startDate.isSame(startDate.startOf('month'), 'day') &&
        endDate.isSame(endDate.endOf('month'), 'day');
      const nextStart = isFullMonth
        ? startDate.add(direction, 'month').startOf('month')
        : startDate.add(direction * (endDate.diff(startDate, 'day') + 1), 'day').startOf('day');
      const nextEnd = isFullMonth
        ? nextStart.endOf('month')
        : endDate.add(direction * (endDate.diff(startDate, 'day') + 1), 'day').endOf('day');
      const clampedStart = nextStart.isBefore(EARLIEST_DATA_DATE) ? EARLIEST_DATA_DATE.startOf('day') : nextStart;

      const movesIntoFuture = isFullMonth
        ? clampedStart.isAfter(today.startOf('month'), 'day')
        : nextEnd.isAfter(today.endOf('day'), 'day');

      if (movesIntoFuture) {
        return;
      }

      applyDateRange(clampedStart, nextEnd);
    },
    [applyDateRange, endDate, startDate, today],
  );

  const totalOpening = useMemo(
    () => summaries.reduce((sum, item) => sum + (item.openingBalance ?? 0), 0),
    [summaries],
  );
  const totalPayToStaff = useMemo(
    () =>
      summaries.reduce(
        (sum, item) => sum + (item.dueAmount ?? item.totalPayout ?? normalizeTotal(item)),
        0,
      ),
    [summaries],
  );
  const totalGrossCompensation = useMemo(
    () => summaries.reduce((sum, item) => sum + resolveGrossCompensationTotal(item), 0),
    [summaries],
  );
  const totalVolunteerFund = useMemo(
    () => summaries.reduce((sum, item) => sum + (item.volunteerFundAllocationTotal ?? 0), 0),
    [summaries],
  );
  const totalPaid = useMemo(
    () =>
      summaries.reduce(
        (sum, item) => sum + (item.paidAmount ?? item.payouts?.payablePaid ?? 0),
        0,
      ),
    [summaries],
  );
  const totalClosing = useMemo(
    () =>
      summaries.reduce(
        (sum, item) => sum + (item.closingBalance ?? item.payouts?.payableOutstanding ?? 0),
        0,
      ),
    [summaries],
  );

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

  const handleEntrySubmit = async () => {
    if (entrySubmitting) {
      return;
    }
    setEntryMessage(null);
    if (!entryModal.staff) {
      setEntryMessage({ type: 'error', text: 'Select a staff entry before recording a payout.' });
      return;
    }
    if (!entryModal.rangeStart || !entryModal.rangeEnd) {
      setEntryMessage({ type: 'error', text: 'Select a payout period before recording a payment.' });
      return;
    }
    if (!entryModal.staff.staffProfileId) {
      setEntryMessage({
        type: 'error',
        text: 'This user does not have a staff profile available for settlement.',
      });
      return;
    }
    const selectedLines = entryModal.lines.filter((line) => line.include && line.amount > 0);
    const selectedFundAllocations = entryModal.fundAllocations.filter(
      (line) => line.include && line.amount > 0,
    );
    const missingCategory = selectedLines.some((line) => !line.categoryId);
    const missingAccount = selectedLines.some((line) => !(line.accountId || entryModal.accountId));
    const awaitingReimbursements =
      entryModal.includeReimbursements && entryModal.reimbursementsAwaitingAmount > 0
        ? entryModal.reimbursementEntries.filter((entry) => entry.status === 'awaiting_reimbursement')
        : [];
    const totalReimbursementAmount = awaitingReimbursements.reduce((sum, entry) => sum + entry.amount, 0);
    const reimbursementCategoryIdForTransaction =
      entryModal.reimbursementCategoryId || entryModal.categoryId || selectedLines[0]?.categoryId || '';
    if (
      (selectedLines.length === 0
        && selectedFundAllocations.length === 0
        && totalReimbursementAmount <= 0) ||
      missingCategory ||
      missingAccount ||
      ((selectedLines.length > 0 || totalReimbursementAmount > 0) && !entryModal.counterpartyId)
    ) {
      setEntryMessage({
        type: 'error',
        text: 'Select at least one staff payment or Volunteer Fund allocation. Staff payments also require an account, category, and vendor.',
      });
      return;
    }
    if (totalReimbursementAmount > 0 && !entryModal.accountId) {
      setEntryMessage({
        type: 'error',
        text: 'Select a payout account to reimburse staff expenses.',
      });
      return;
    }
    if (totalReimbursementAmount > 0 && !reimbursementCategoryIdForTransaction) {
      setEntryMessage({
        type: 'error',
        text: 'Assign a finance category before reimbursing staff expenses.',
      });
      return;
    }

    setEntrySubmitting(true);
    try {
      const payoutResponse = await axiosInstance.post<StaffPayoutBatchResponse>(
        '/reports/staffPayouts/batch',
        {
          staffProfileId: entryModal.staff.staffProfileId,
          direction: 'payable',
          counterpartyId: entryModal.counterpartyId ? Number(entryModal.counterpartyId) : null,
          rangeStart: entryModal.rangeStart,
          rangeEnd: entryModal.rangeEnd,
          date: dayjs(entryModal.date).format('YYYY-MM-DD'),
          lines: selectedLines.map((line) => {
            const resolvedAccountId = Number(line.accountId || entryModal.accountId);
            const accountRecord = financeAccountsById.get(resolvedAccountId);
            return {
              label: line.label,
              componentId: line.componentId ?? null,
              sourceKey: line.sourceKey ?? 'manual_adjustment',
              amount: line.amount,
              categoryId: Number(line.categoryId),
              accountId: resolvedAccountId,
              currency: accountRecord?.currency ?? entryModal.currency,
              description: line.description || entryModal.description || `${line.label} payout`,
              affiliatePayout: line.affiliatePayout ?? null,
              settlementIntent: line.settlementIntent ?? null,
            };
          }),
          fundAllocations: selectedFundAllocations.map((line) => ({
            label: line.label,
            componentId: line.componentId ?? null,
            sourceKey: line.sourceKey,
            amount: line.amount,
            fundId: line.fundId,
            settlementIntent: line.settlementIntent,
            description: line.description,
          })),
          reimbursement:
            totalReimbursementAmount > 0 && entryModal.accountId
              ? {
                  amount: totalReimbursementAmount,
                  accountId: Number(entryModal.accountId),
                  categoryId: Number(reimbursementCategoryIdForTransaction),
                  description: 'Staff reimbursements payout',
                  entries: awaitingReimbursements.map((entry) => ({
                    transactionId: entry.transactionId,
                    amount: entry.amount,
                  })),
                }
              : null,
        },
        { withCredentials: true },
      );

      closeEntryModal();
      const refetchStart = startDate ? startDate.format('YYYY-MM-DD') : entryModal.rangeStart;
      const refetchEnd = endDate ? endDate.format('YYYY-MM-DD') : entryModal.rangeEnd;
      await refetchPaysForRange(refetchStart, refetchEnd);
      const receiptCount = payoutResponse.data.receipts?.length ?? 0;
      const fundAllocationCount = payoutResponse.data.fundAllocationCount ?? 0;
      if (payoutResponse.data.duplicated) {
        setActionAlert({
          type: 'success',
          text: `This settlement for ${formatPayStaffName(entryModal.staff)} was already recorded. Nothing was duplicated.`,
        });
      } else if (receiptCount === 1) {
        setActionAlert({
          type: 'success',
          text: `Settlement recorded. Confirmation request sent to ${formatPayStaffName(entryModal.staff)}.${fundAllocationCount > 0 ? ` ${fundAllocationCount} Volunteer Fund allocation${fundAllocationCount === 1 ? '' : 's'} recorded.` : ''}`,
        });
      } else if (receiptCount > 1) {
        setActionAlert({
          type: 'success',
          text: `Settlement recorded. ${receiptCount} confirmation requests sent to ${formatPayStaffName(entryModal.staff)}, one per currency.${fundAllocationCount > 0 ? ` ${fundAllocationCount} Volunteer Fund allocations recorded.` : ''}`,
        });
      } else if (fundAllocationCount > 0) {
        setActionAlert({
          type: 'success',
          text: `${fundAllocationCount} Volunteer Fund allocation${fundAllocationCount === 1 ? '' : 's'} recorded for ${formatPayStaffName(entryModal.staff)}. No staff receipt was requested because no money was paid personally.`,
        });
      } else {
        setActionAlert({
          type: 'error',
          text: `Payout recorded for ${formatPayStaffName(entryModal.staff)}, but no confirmation request was created.`,
        });
      }
    } catch (submissionError) {
      const message = extractRequestErrorMessage(submissionError, 'Unable to record payout.');
      setEntryMessage({ type: 'error', text: message });
    } finally {
      setEntrySubmitting(false);
    }
  };

  const handleDeletePaidEntries = async () => {
    if (!paidEntriesModal.staff?.staffProfileId) {
      setPaidEntriesMessage({ type: 'error', text: 'Unable to determine the selected staff member.' });
      return;
    }
    const rangeStartValue =
      paidEntriesModal.staff.range?.startDate ?? startDate?.format('YYYY-MM-DD') ?? null;
    const rangeEndValue =
      paidEntriesModal.staff.range?.endDate ?? endDate?.format('YYYY-MM-DD') ?? null;
    if (!rangeStartValue || !rangeEndValue) {
      setPaidEntriesMessage({ type: 'error', text: 'Unable to determine the selected payout month.' });
      return;
    }
    if (paidEntriesModal.selectedIds.length === 0) {
      setPaidEntriesMessage({ type: 'error', text: 'Select at least one recorded component.' });
      return;
    }

    try {
      setPaidEntriesSubmitting(true);
      setPaidEntriesMessage(null);
      await axiosInstance.post(
        '/reports/staffPayouts/deleteEntries',
        {
          staffProfileId: paidEntriesModal.staff.staffProfileId,
          rangeStart: rangeStartValue,
          rangeEnd: rangeEndValue,
          entryIds: paidEntriesModal.selectedIds,
        },
        { withCredentials: true },
      );
      closePaidEntriesModal();
      await refetchPaysForRange(rangeStartValue, rangeEndValue);
      setActionAlert({
        type: 'success',
        text: `Removed ${paidEntriesModal.selectedIds.length} recorded payout component${
          paidEntriesModal.selectedIds.length === 1 ? '' : 's'
        } for ${formatPayStaffName(paidEntriesModal.staff)}.`,
      });
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : 'Unable to delete paid components.';
      setPaidEntriesMessage({ type: 'error', text: message });
    } finally {
      setPaidEntriesSubmitting(false);
    }
  };

  const toggleRow = (index: number) => {
    setExpandedRow((prev) => (prev === index ? null : index));
  };

  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.md})`);

  useEffect(() => {
    if (!isDesktop || expandedRow !== null) {
      setFixedDesktopHeader((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    let animationFrame: number | null = null;

    const updateFixedHeader = () => {
      if (animationFrame !== null) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        const container = desktopTableContainerRef.current;
        const header = desktopTableHeaderRef.current;

        if (!container || !header) {
          setFixedDesktopHeader((prev) => (prev.visible ? { ...prev, visible: false } : prev));
          return;
        }

        const containerRect = container.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const visible =
          containerRect.top < DESKTOP_FIXED_TABLE_HEADER_TOP &&
          containerRect.bottom > DESKTOP_FIXED_TABLE_HEADER_TOP + headerRect.height;
        const columnWidths = Array.from(header.querySelectorAll('th')).map((cell) =>
          Math.round(cell.getBoundingClientRect().width),
        );
        const nextState: FixedDesktopHeaderState = {
          visible,
          left: Math.round(containerRect.left),
          width: Math.round(containerRect.width),
          columnWidths,
        };

        setFixedDesktopHeader((prev) => {
          const sameColumns =
            prev.columnWidths.length === nextState.columnWidths.length &&
            prev.columnWidths.every((width, index) => width === nextState.columnWidths[index]);
          if (
            prev.visible === nextState.visible &&
            prev.left === nextState.left &&
            prev.width === nextState.width &&
            sameColumns
          ) {
            return prev;
          }
          return nextState;
        });
      });
    };

    updateFixedHeader();
    window.addEventListener('scroll', updateFixedHeader, true);
    window.addEventListener('resize', updateFixedHeader);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener('scroll', updateFixedHeader, true);
      window.removeEventListener('resize', updateFixedHeader);
    };
  }, [canViewFull, expandedRow, isDesktop, summaries.length]);

const renderSummaryBoard = () => {
  const kpiCardStyle: React.CSSProperties = {
    ...KPI_CARD_STYLE,
    flex: isDesktop ? '0 1 300px' : '1 1 100%',
    width: isDesktop ? 300 : '100%',
    maxWidth: isDesktop ? 320 : '100%',
  };

  return (
  <Stack gap="sm">
    <Group justify="center" align="stretch" gap="md" wrap="wrap">
      {totalOpening !== 0 && (
        <Card withBorder p="sm" style={kpiCardStyle}>
          <Stack gap={4} align="center" justify="center">
            {renderPayInfoLabel('Last Month Balance', PAY_KPI_HELP.lastMonthBalance, { dimmed: true })}
            <Title order={4} ta="center">
              {formatCurrency(totalOpening)}
            </Title>
            <Group justify="center">
              <Button
                size="xs"
                variant="subtle"
                disabled={openingBalanceDetailRows.length === 0}
                onClick={() => setOpeningBalanceDetailsOpen(true)}
              >
                Show Detail
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
      <Card withBorder p="sm" style={kpiCardStyle}>
        <Stack gap={4} align="center" justify="center">
          {renderPayInfoLabel('Gross compensation', PAY_KPI_HELP.grossCompensation, { dimmed: true })}
          <Title order={4} ta="center">
            {formatCurrency(totalGrossCompensation)}
          </Title>
        </Stack>
      </Card>
      <Card withBorder p="sm" style={kpiCardStyle}>
        <Stack gap={4} align="center" justify="center">
          {renderPayInfoLabel(
            usingSelfScope ? 'My pay to staff' : 'Pay to staff',
            PAY_KPI_HELP.payToStaff,
            { dimmed: true },
          )}
          <Title order={4} ta="center">
            {formatCurrency(totalPayToStaff)}
          </Title>
        </Stack>
      </Card>
      {totalVolunteerFund > 0 && (
        <Card withBorder p="sm" style={kpiCardStyle}>
          <Stack gap={4} align="center" justify="center">
            {renderPayInfoLabel('Volunteer Fund', PAY_KPI_HELP.volunteerFund, { dimmed: true })}
            <Title order={4} ta="center">
              {formatCurrency(totalVolunteerFund)}
            </Title>
          </Stack>
        </Card>
      )}
      <Card withBorder p="sm" style={kpiCardStyle}>
        <Stack gap={4} align="center" justify="center">
          {renderPayInfoLabel('Already Paid', PAY_KPI_HELP.alreadyPaid, { dimmed: true })}
          <Title order={4} ta="center">
            {formatCurrency(totalPaid, DEFAULT_CURRENCY)}
          </Title>
        </Stack>
      </Card>
      <Card withBorder p="sm" style={kpiCardStyle}>
        <Stack gap={4} align="center" justify="center">
          {renderPayInfoLabel('Outstanding', PAY_KPI_HELP.outstanding, { dimmed: true })}
          <Title order={4} ta="center">
            {formatCurrency(totalClosing)}
          </Title>
        </Stack>
      </Card>
    </Group>
  </Stack>
  );
};

const renderOpeningBalanceDetails = () => {
  const sourceRows = openingBalanceDetailRows.filter((row) => row.staff.openingBalanceSource);
  const missingSourceRows = openingBalanceDetailRows.filter((row) => !row.staff.openingBalanceSource);

  return (
    <Stack gap="lg">
      {canViewFull && (
        <Group justify="flex-end">
          <Button loading={ledgerRecalculating} onClick={() => void handleRecalculateLedger()}>
            Recalculate ledger
          </Button>
        </Group>
      )}
      {ledgerRecalculationMessage && (
        <Alert color={ledgerRecalculationMessage.type === 'success' ? 'green' : 'red'} variant="light">
          {ledgerRecalculationMessage.text}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Opening balance total
          </Text>
          <Text fw={700}>{formatCurrency(totalOpening)}</Text>
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Staff with carry-over
          </Text>
          <Text fw={700}>{openingBalanceDetailRows.length}</Text>
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Source table
          </Text>
          <Text fw={700}>staff_payout_ledgers</Text>
        </Card>
      </SimpleGrid>

      {sourceRows.length > 0 ? (
        <ScrollArea mah={420} offsetScrollbars>
          <Table striped withRowBorders style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ padding: 8 }}>Staff</th>
                <th style={{ padding: 8 }}>Opening balance</th>
                <th style={{ padding: 8 }}>From period</th>
                <th style={{ padding: 8 }}>Previous opening</th>
                <th style={{ padding: 8 }}>Previous activity</th>
                <th style={{ padding: 8 }}>Previous payments</th>
                <th style={{ padding: 8 }}>Previous closing</th>
                <th style={{ padding: 8 }}>Ledger</th>
                <th style={{ padding: 8 }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map(({ staff, openingBalance }) => {
                const source = staff.openingBalanceSource!;
                return (
                  <tr key={`${staff.userId ?? source.staffUserId}-${source.ledgerId}`}>
                    <td style={{ padding: 8 }}>{formatPayStaffName(staff)}</td>
                    <td style={{ padding: 8 }}>{formatCurrency(openingBalance, source.currency)}</td>
                    <td style={{ padding: 8 }}>{formatRangeLabel(source.rangeStart, source.rangeEnd)}</td>
                    <td style={{ padding: 8 }}>{formatCurrency(source.openingBalance, source.currency)}</td>
                    <td style={{ padding: 8 }}>{formatCurrency(source.dueAmount, source.currency)}</td>
                    <td style={{ padding: 8 }}>{formatCurrency(source.paidAmount, source.currency)}</td>
                    <td style={{ padding: 8 }}>{formatCurrency(source.closingBalance, source.currency)}</td>
                    <td style={{ padding: 8 }}>
                      <Stack gap={0}>
                        <Text size="sm">#{source.ledgerId}</Text>
                        <Text size="xs" c="dimmed">
                          {source.sourceTable}
                        </Text>
                      </Stack>
                    </td>
                    <td style={{ padding: 8 }}>
                      <Stack gap={0}>
                        <Text size="sm">{formatDateTimeLabel(source.updatedAt ?? source.createdAt)}</Text>
                        <Text size="xs" c="dimmed">
                          Created {formatDateTimeLabel(source.createdAt)}
                        </Text>
                      </Stack>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </ScrollArea>
      ) : (
        <Alert color="blue" variant="light">
          No previous ledger rows were found for the current opening balance.
        </Alert>
      )}

      {sourceRows.some((row) => (row.staff.openingBalanceSource?.history?.length ?? 0) > 0) && (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Ledger trail
          </Text>
          <Accordion variant="contained" radius="md">
            {sourceRows.map(({ staff, openingBalance }) => {
              const source = staff.openingBalanceSource;
              const history = source?.history ?? [];
              if (!source || history.length === 0) {
                return null;
              }

              return (
                <Accordion.Item key={`opening-history-${staff.userId ?? source.staffUserId}`} value={String(staff.userId ?? source.staffUserId)}>
                  <Accordion.Control>
                    <Group justify="space-between" gap="sm">
                      <Text size="sm" fw={600}>
                        {formatPayStaffName(staff)}
                      </Text>
                      <Text size="sm">{formatCurrency(openingBalance, source.currency)}</Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <ScrollArea offsetScrollbars>
                      <Table striped withRowBorders style={{ minWidth: 760 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: 8 }}>Period</th>
                            <th style={{ padding: 8 }}>Opening</th>
                            <th style={{ padding: 8 }}>Activity</th>
                            <th style={{ padding: 8 }}>Payments</th>
                            <th style={{ padding: 8 }}>Closing</th>
                            <th style={{ padding: 8 }}>Ledger</th>
                            <th style={{ padding: 8 }}>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((ledger) => (
                            <tr key={`${staff.userId ?? source.staffUserId}-${ledger.ledgerId}`}>
                              <td style={{ padding: 8 }}>{formatRangeLabel(ledger.rangeStart, ledger.rangeEnd)}</td>
                              <td style={{ padding: 8 }}>{formatCurrency(ledger.openingBalance, ledger.currency)}</td>
                              <td style={{ padding: 8 }}>{formatCurrency(ledger.dueAmount, ledger.currency)}</td>
                              <td style={{ padding: 8 }}>{formatCurrency(ledger.paidAmount, ledger.currency)}</td>
                              <td style={{ padding: 8 }}>{formatCurrency(ledger.closingBalance, ledger.currency)}</td>
                              <td style={{ padding: 8 }}>#{ledger.ledgerId}</td>
                              <td style={{ padding: 8 }}>{formatDateTimeLabel(ledger.updatedAt ?? ledger.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </ScrollArea>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        </Stack>
      )}

      {missingSourceRows.length > 0 && (
        <Alert color="yellow" variant="light">
          {missingSourceRows.length} staff opening balance row{missingSourceRows.length === 1 ? '' : 's'} did not include
          a previous ledger source.
        </Alert>
      )}
    </Stack>
  );
};

const getLedgerSnapshot = (staff: Pay) => ({
  opening: staff.openingBalance ?? 0,
  due: staff.dueAmount ?? Math.max(staff.totalPayout ?? staff.totalCommission ?? 0, 0),
  paid: staff.paidAmount ?? (staff.payouts?.payablePaid ?? 0),
  closing: staff.closingBalance ?? (staff.payouts?.payableOutstanding ?? 0),
});

const renderLedgerSnapshot = (staff: Pay) => {
  const currency = staff.payouts?.currency ?? DEFAULT_CURRENCY;
  const ledger = getLedgerSnapshot(staff);

  return (
    <Stack gap={2}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        {renderPayInfoLabel(
          'Last Months Owed',
          PAY_TABLE_HEADER_HELP['Last Months Owed'],
          { dimmed: true, size: 'xs' },
        )}
        <Text size="xs" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {formatCurrency(ledger.opening, currency)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Pay to staff
        </Text>
        <Text size="xs">{formatCurrency(ledger.due, currency)}</Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Already Paid
        </Text>
        <Text size="xs">{formatCurrency(ledger.paid, currency)}</Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Outstanding
        </Text>
        <Text size="xs">{formatCurrency(ledger.closing, currency)}</Text>
      </Group>
    </Stack>
  );
};

const renderVolunteerFundSnapshot = (
  staff: Pay,
  options: { showInfo?: boolean } = {},
) => {
  const total = staff.volunteerFundAllocationTotal ?? 0;
  if (total <= 0) {
    return null;
  }
  const currency = staff.payouts?.currency ?? DEFAULT_CURRENCY;
  const allocated = staff.volunteerFundAllocatedTotal ?? 0;
  const outstanding = staff.volunteerFundOutstandingTotal ?? 0;
  const overallocated = staff.volunteerFundOverallocatedTotal ?? 0;
  const hasRouteConflict = (staff.settlementSources ?? []).some((source) => source.routeChanged);
  const fundNames = Array.from(
    new Set(
      (staff.settlementSources ?? [])
        .filter((source) => source.destination === 'volunteer_fund' && source.fundName)
        .map((source) => source.fundName as string),
    ),
  );
  return (
    <Stack gap={2}>
      <Group justify="space-between" gap="xs">
        <Group gap={4} wrap="nowrap">
          <Text size="xs" fw={700} c="blue.8">Volunteer Fund</Text>
          {options.showInfo && (
            <FinanceInfoButton
              label="Volunteer Fund"
              description={PAY_TABLE_HEADER_HELP['Volunteer Fund']}
            />
          )}
        </Group>
        <Text size="xs" fw={700}>{formatCurrency(total, currency)}</Text>
      </Group>
      {fundNames.length > 0 && <Text size="xs" c="dimmed">{fundNames.join(', ')}</Text>}
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">Allocated</Text>
        <Text size="xs" c="teal.8">{formatCurrency(allocated, currency)}</Text>
      </Group>
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">To allocate</Text>
        <Text size="xs" c={outstanding > 0 ? 'orange.8' : 'teal.8'}>
          {formatCurrency(outstanding, currency)}
        </Text>
      </Group>
      {overallocated > 0 && (
        <Group justify="space-between" gap="xs">
          <Text size="xs" c="red.8" fw={700}>Overallocated</Text>
          <Text size="xs" c="red.8" fw={700}>{formatCurrency(overallocated, currency)}</Text>
        </Group>
      )}
      {hasRouteConflict && (
        <Text size="xs" c="red.8" fw={700}>
          Routing changed after allocation. Reverse the old fund entry before applying a successor route.
        </Text>
      )}
    </Stack>
  );
};

  const renderMobileCards = () => (
    <Stack gap="md">
      {summaries.map((item, index) => {
        const expanded = expandedRow === index;
        const total = normalizeTotal(item);
        const grossTotal = resolveGrossCompensationTotal(item);
        const volunteerFundTotal = item.volunteerFundAllocationTotal ?? 0;
        const hasDetails =
          hasPositivePaymentBucket(item) ||
          (item.productTotals && item.productTotals.length > 0) ||
          item.breakdown.length > 0 ||
          hasPlatformGuestDetails(item) ||
          (item.lockedComponents && item.lockedComponents.length > 0) ||
          Boolean(item.affiliateSales?.bookingCount);
        return (
          <Paper key={item.userId ?? index} shadow="sm" radius="lg" p="lg" withBorder>
            <Stack gap="md" align="stretch">
              <Stack gap={4} align="center" ta="center">
                <Title order={4}>{formatPayStaffName(item)}</Title>
                {renderVolunteerRoutingBadges(item)}
                <SimpleGrid cols={volunteerFundTotal > 0 ? 3 : 2} spacing="xs" w="100%">
                  <Stack gap={2} align="center">
                    {renderPayInfoLabel(
                      'Gross compensation',
                      PAY_TABLE_HEADER_HELP['Gross compensation'],
                      { dimmed: true, size: 'xs' },
                    )}
                    <Text size="sm" fw={700}>{formatCurrency(grossTotal)}</Text>
                  </Stack>
                  <Stack gap={2} align="center">
                    {renderPayInfoLabel(
                      'Pay to staff',
                      PAY_TABLE_HEADER_HELP['Pay to staff'],
                      { dimmed: true, size: 'xs' },
                    )}
                    <Text size="sm" fw={700}>{formatCurrency(total)}</Text>
                  </Stack>
                  {volunteerFundTotal > 0 && (
                    <Stack gap={2} align="center">
                      <Text size="xs" c="dimmed">Volunteer Fund</Text>
                      <Text size="sm" fw={700} c="blue.8">{formatCurrency(volunteerFundTotal)}</Text>
                    </Stack>
                  )}
                </SimpleGrid>
              </Stack>

              <SimpleGrid cols={2} spacing="xs">
                <Stack gap={2} align="center" ta="center">
                  {renderPayInfoLabel('Paid', PAY_TABLE_HEADER_HELP.Paid, { dimmed: true })}
                  <Text size="sm" fw={700}>
                    {formatCurrency(item.payouts?.payablePaid ?? 0, item.payouts?.currency ?? DEFAULT_CURRENCY)}
                  </Text>
                </Stack>
                <Stack gap={2} align="center" ta="center">
                  {renderPayInfoLabel(
                    'Outstanding',
                    PAY_TABLE_HEADER_HELP.Outstanding,
                    { dimmed: true },
                  )}
                  <Text size="sm" fw={700} c={Math.max(item.closingBalance ?? item.payouts?.payableOutstanding ?? 0, 0) > 0 ? undefined : 'teal'}>
                    {formatCurrency(Math.max(item.closingBalance ?? item.payouts?.payableOutstanding ?? 0, 0), item.payouts?.currency ?? DEFAULT_CURRENCY)}
                  </Text>
                </Stack>
              </SimpleGrid>

              {renderRecordAction(item, { fullWidth: true })}

              <Box
                style={{
                  padding: '10px 0',
                  borderTop: '1px solid var(--mantine-color-gray-2)',
                  borderBottom: '1px solid var(--mantine-color-gray-2)',
                }}
              >
                {renderLedgerSnapshot(item)}
              </Box>

              {(item.volunteerFundAllocationTotal ?? 0) > 0 && (
                <Box
                  p="sm"
                  bg="blue.0"
                  style={{ border: '1px solid var(--mantine-color-blue-4)', borderRadius: 'var(--mantine-radius-md)' }}
                >
                  {renderVolunteerFundSnapshot(item, { showInfo: true })}
                </Box>
              )}

              {hasDetails && (
                <Button variant="subtle" fullWidth onClick={() => toggleRow(index)}>
                  {expanded ? 'Hide details' : 'Show details'}
                </Button>
              )}

              {expanded && (
                <Stack gap="sm" pt="xs">
                  {renderBucketTotals(item.bucketTotals, item.lockedComponents, item)}
                  {renderComponentList(
                    item.componentTotals,
                    item.platformGuestBreakdowns,
                    item.platformGuestTotals,
                    item.lockedComponents,
                    item,
                    { onApproveBaseOverride: handleApproveBaseOverride, pendingUserIds: baseOverridePending },
                  )}
                  {renderProductTotals(item.productTotals, item.componentTotals, item.lockedComponents, item)}
                  {renderReimbursements(item)}
                </Stack>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );

  const renderSelfDetails = () => {
    const item = summaries[0];
    if (!item) {
      return null;
    }

    return (
      <Stack gap="md" align="stretch" style={{ width: '100%' }}>
        <Button fullWidth variant="light" onClick={() => setSelfDetailsOpen((open) => !open)}>
          {selfDetailsOpen ? 'Hide Details' : 'Show Details'}
        </Button>
        <Collapse in={selfDetailsOpen} style={{ width: '100%' }}>
          <Stack gap="md">
            {renderBucketTotals(item.bucketTotals, item.lockedComponents, item)}
            {renderComponentList(
              item.componentTotals,
              item.platformGuestBreakdowns,
              item.platformGuestTotals,
              item.lockedComponents,
              item,
            )}
            {renderProductTotals(item.productTotals, item.componentTotals, item.lockedComponents, item)}
            {renderReimbursements(item)}
          </Stack>
        </Collapse>
      </Stack>
    );
  };

  const renderDesktopTable = () => {
    const desktopTableCellStyle: React.CSSProperties = {
      padding: 12,
      textAlign: 'center',
      verticalAlign: 'middle',
      borderBottom: '1px solid var(--mantine-color-gray-3)',
    };
    const shouldStickDesktopHeader = expandedRow === null;
    const isFixedDesktopHeaderVisible = shouldStickDesktopHeader && fixedDesktopHeader.visible;
    const desktopHeaderCellStyle: React.CSSProperties = {
      ...desktopTableCellStyle,
      padding: '14px 12px',
      backgroundColor: 'var(--mantine-color-gray-0)',
      borderTop: '1px solid var(--mantine-color-gray-3)',
      borderBottom: '1px solid var(--mantine-color-gray-4)',
      visibility: isFixedDesktopHeaderVisible ? 'hidden' : 'visible',
    };
    const desktopActionsCellStyle: React.CSSProperties = {
      ...desktopTableCellStyle,
      width: 170,
    };
    const tableOpeningTotal = summaries.reduce((sum, item) => sum + (item.openingBalance ?? 0), 0);
    const showLastMonthsOwedColumn = Math.abs(roundLineAmount(tableOpeningTotal)) > 0;
    const tableGrossTotal = summaries.reduce(
      (sum, item) => sum + resolveGrossCompensationTotal(item),
      0,
    );
    const tablePayoutTotal = summaries.reduce((sum, item) => sum + normalizeTotal(item), 0);
    const tableFundTotal = summaries.reduce(
      (sum, item) => sum + (item.volunteerFundAllocationTotal ?? 0),
      0,
    );
    const tableFundOutstandingTotal = summaries.reduce(
      (sum, item) => sum + (item.volunteerFundOutstandingTotal ?? 0),
      0,
    );
    const showVolunteerFundColumn = tableFundTotal > 0;
    const tablePaidTotal = summaries.reduce(
      (sum, item) => sum + (item.payouts?.payablePaid ?? 0),
      0,
    );
    const tableOutstandingTotal = summaries.reduce(
      (sum, item) => sum + Math.max(item.closingBalance ?? item.payouts?.payableOutstanding ?? 0, 0),
      0,
    );
    const desktopHeaderLabels = [
      'Name',
      ...(showLastMonthsOwedColumn ? ['Last Months Owed'] : []),
      'Gross compensation',
      'Pay to staff',
      ...(showVolunteerFundColumn ? ['Volunteer Fund'] : []),
      'Paid',
      'Outstanding',
      'Actions',
    ];
    const fixedHeaderColumns =
      fixedDesktopHeader.columnWidths.length === desktopHeaderLabels.length
        ? fixedDesktopHeader.columnWidths.map((width) => `${width}px`).join(' ')
        : `repeat(${desktopHeaderLabels.length}, 1fr)`;
    return (
      <Box ref={desktopTableContainerRef} style={{ width: '100%' }}>
        {isFixedDesktopHeaderVisible && (
          <Box
            style={{
              position: 'fixed',
              top: DESKTOP_FIXED_TABLE_HEADER_TOP,
              left: fixedDesktopHeader.left,
              width: fixedDesktopHeader.width,
              display: 'grid',
              gridTemplateColumns: fixedHeaderColumns,
              zIndex: 100,
              backgroundColor: 'var(--mantine-color-gray-0)',
              borderTop: '1px solid var(--mantine-color-gray-3)',
              borderBottom: '1px solid var(--mantine-color-gray-4)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
              pointerEvents: 'auto',
            }}
          >
            {desktopHeaderLabels.map((label) => (
              <Box
                key={label}
                style={{
                  padding: '14px 12px',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                {renderPayInfoLabel(label, PAY_TABLE_HEADER_HELP[label])}
              </Box>
            ))}
          </Box>
        )}
        <Table
          striped
          highlightOnHover
          withRowBorders
          style={{ minWidth: 900, borderCollapse: 'separate', borderSpacing: 0 }}
        >
          <thead ref={desktopTableHeaderRef}>
            <tr>
              <th style={desktopHeaderCellStyle}>
                {renderPayInfoLabel('Name', PAY_TABLE_HEADER_HELP.Name)}
              </th>
              {showLastMonthsOwedColumn && (
                <th style={desktopHeaderCellStyle}>
                  {renderPayInfoLabel('Last Months Owed', PAY_TABLE_HEADER_HELP['Last Months Owed'])}
                </th>
              )}
              <th style={desktopHeaderCellStyle}>
                {renderPayInfoLabel('Gross compensation', PAY_TABLE_HEADER_HELP['Gross compensation'])}
              </th>
              <th style={desktopHeaderCellStyle}>
                {renderPayInfoLabel('Pay to staff', PAY_TABLE_HEADER_HELP['Pay to staff'])}
              </th>
              {showVolunteerFundColumn && (
                <th style={desktopHeaderCellStyle}>
                  {renderPayInfoLabel('Volunteer Fund', PAY_TABLE_HEADER_HELP['Volunteer Fund'])}
                </th>
              )}
              <th style={desktopHeaderCellStyle}>
                {renderPayInfoLabel('Paid', PAY_TABLE_HEADER_HELP.Paid)}
              </th>
              <th style={desktopHeaderCellStyle}>
                {renderPayInfoLabel('Outstanding', PAY_TABLE_HEADER_HELP.Outstanding)}
              </th>
              <th style={desktopHeaderCellStyle}>
                {renderPayInfoLabel('Actions', PAY_TABLE_HEADER_HELP.Actions)}
              </th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((item, index) => {
              const rowHasDetails =
                hasPositivePaymentBucket(item) ||
                (item.productTotals && item.productTotals.length > 0) ||
                item.breakdown.length > 0 ||
                hasPlatformGuestDetails(item) ||
                (item.lockedComponents && item.lockedComponents.length > 0) ||
                (item.componentTotals && item.componentTotals.length > 0) ||
                Boolean(item.affiliateSales?.bookingCount);
              const paidAmount = item.payouts?.payablePaid ?? 0;
              const outstandingAmount = Math.max(item.closingBalance ?? item.payouts?.payableOutstanding ?? 0, 0);
              const openingAmount = item.openingBalance ?? 0;
              const grossAmount = resolveGrossCompensationTotal(item);
              const payoutCurrency = item.payouts?.currency ?? DEFAULT_CURRENCY;
              return (
                <Fragment key={item.userId ?? index}>
                  <tr>
                    <td style={desktopTableCellStyle}>{renderStaffRoutingLabel(item)}</td>
                    {showLastMonthsOwedColumn && (
                      <td style={desktopTableCellStyle}>{formatCurrency(openingAmount, payoutCurrency)}</td>
                    )}
                    <td style={desktopTableCellStyle}>{formatCurrency(grossAmount, payoutCurrency)}</td>
                    <td style={desktopTableCellStyle}>{formatCurrency(normalizeTotal(item))}</td>
                    {showVolunteerFundColumn && (
                      <td style={desktopTableCellStyle}>{renderVolunteerFundSnapshot(item)}</td>
                    )}
                    <td style={desktopTableCellStyle}>{formatCurrency(paidAmount, payoutCurrency)}</td>
                    <td style={desktopTableCellStyle}>{formatCurrency(outstandingAmount, payoutCurrency)}</td>
                    <td style={desktopActionsCellStyle}>
                      <Stack gap={6} align="center">
                        {renderRecordAction(item)}
                        {rowHasDetails && (
                          <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                            {expandedRow === index ? 'Hide details' : 'Show details'}
                          </Button>
                        )}
                      </Stack>
                    </td>
                  </tr>
                  {expandedRow === index && (
                    <tr>
                      <td
                        colSpan={desktopHeaderLabels.length}
                        style={{
                          backgroundColor: '#fafafa',
                          padding: '12px 8px',
                          borderBottom: '1px solid var(--mantine-color-gray-3)',
                        }}
                      >
                        <Stack gap="md">
                          {renderBucketTotals(item.bucketTotals, item.lockedComponents, item)}
                          {renderComponentList(
                            item.componentTotals,
                            item.platformGuestBreakdowns,
                            item.platformGuestTotals,
                            item.lockedComponents,
                            item,
                            { onApproveBaseOverride: handleApproveBaseOverride, pendingUserIds: baseOverridePending },
                          )}
                          {renderProductTotals(item.productTotals, item.componentTotals, item.lockedComponents, item)}
                          {renderReimbursements(item)}
                        </Stack>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr>
              <td style={desktopTableCellStyle}>
                <strong>Total</strong>
              </td>
              {showLastMonthsOwedColumn && (
                <td style={desktopTableCellStyle}>
                  <strong>{formatCurrency(tableOpeningTotal, DEFAULT_CURRENCY)}</strong>
                </td>
              )}
              <td style={desktopTableCellStyle}>
                <strong>{formatCurrency(tableGrossTotal)}</strong>
              </td>
              <td style={desktopTableCellStyle}>
                <strong>{formatCurrency(tablePayoutTotal)}</strong>
              </td>
              {showVolunteerFundColumn && (
                <td style={desktopTableCellStyle}>
                  <Stack gap={2} align="center">
                    <strong>{formatCurrency(tableFundTotal)}</strong>
                    <Text size="xs" c={tableFundOutstandingTotal > 0 ? 'orange.8' : 'teal.8'}>
                      {formatCurrency(tableFundOutstandingTotal)} to allocate
                    </Text>
                  </Stack>
                </td>
              )}
              <td style={desktopTableCellStyle}>
                <strong>{formatCurrency(tablePaidTotal, DEFAULT_CURRENCY)}</strong>
              </td>
              <td style={desktopTableCellStyle}>
                <strong>{formatCurrency(tableOutstandingTotal, DEFAULT_CURRENCY)}</strong>
              </td>
              <td style={desktopTableCellStyle} />
            </tr>
          </tbody>
        </Table>
      </Box>
    );
  };

  const selectedRangeDayCount = startDate && endDate ? endDate.diff(startDate, 'day') + 1 : 0;
  const selectedRangeIsFullMonth =
    Boolean(startDate && endDate) &&
    startDate!.isSame(startDate!.startOf('month'), 'day') &&
    endDate!.isSame(endDate!.endOf('month'), 'day');
  const nextShiftStart =
    startDate && endDate
      ? selectedRangeIsFullMonth
        ? startDate.add(1, 'month').startOf('month')
        : startDate.add(selectedRangeDayCount, 'day').startOf('day')
      : null;
  const nextShiftEnd =
    startDate && endDate
      ? selectedRangeIsFullMonth
        ? startDate.add(1, 'month').endOf('month')
        : endDate.add(selectedRangeDayCount, 'day').endOf('day')
      : null;
  const canShiftPrevious = Boolean(startDate && startDate.startOf('day').isAfter(EARLIEST_DATA_DATE, 'day'));
  const canShiftNext = Boolean(
    nextShiftStart &&
      nextShiftEnd &&
      (selectedRangeIsFullMonth
        ? !nextShiftStart.isAfter(today.startOf('month'), 'day')
        : !nextShiftEnd.isAfter(today.endOf('day'), 'day')),
  );
  const selectedRangeLabel =
    startDate && endDate
      ? `${startDate.format('MMM D, YYYY')} - ${endDate.format('MMM D, YYYY')}`
      : 'Select a date range';

  let content: React.ReactNode;

  if (!permissionsReady || permissionsLoading) {
    content = (
      <Center style={{ height: '60vh' }}>
        <Loader variant="dots" />
      </Center>
    );
  } else if (!(canViewFull || canViewSelf)) {
    content = (
      <Container size={isDesktop ? 1080 : undefined} my={isDesktop ? 40 : 24} px={isDesktop ? 'xl' : 'sm'}>
        <Alert color="yellow" title="No access">
          You do not have permission to view staff payment details.
        </Alert>
      </Container>
    );
  } else {
    content = (
      <Container fluid my={isDesktop ? 40 : 16} px={isDesktop ? 24 : 0}>
        <Paper
          radius={isDesktop ? 12 : 0}
          p={isDesktop ? 'xl' : 0}
          withBorder={isDesktop}
          style={!isDesktop ? { backgroundColor: 'transparent' } : undefined}
        >
          <Stack gap="md">
            <Stack gap={isDesktop ? 'lg' : 'sm'}>
              <Box
                style={{
                  display: 'grid',
                  gridTemplateColumns: isDesktop ? 'minmax(220px, 320px) minmax(320px, 520px)' : '1fr',
                  gap: isDesktop ? 24 : 10,
                  alignItems: 'start',
                  justifyContent: 'center',
                  width: '100%',
                  margin: '0 auto',
                }}
              >
                <Box style={{ width: '100%' }}>
                  <Select
                    aria-label="Period"
                    data={DATE_PRESET_OPTIONS}
                    value={datePreset}
                    onChange={(value) => handlePresetChange(value)}
                    styles={{
                      input: { textAlign: 'center' },
                      option: { textAlign: 'center', justifyContent: 'center' },
                    }}
                  />
                </Box>
                <Stack gap={6} style={{ width: '100%' }}>
                  <Group gap={8} wrap="nowrap" align="center">
                    <ActionIcon
                      variant="light"
                      color="blue"
                      size="lg"
                      aria-label="Previous period"
                      disabled={!canShiftPrevious}
                      onClick={() => handleShiftPeriod(-1)}
                    >
                      <IconChevronLeft size={18} />
                    </ActionIcon>
                    {datePreset === 'custom' ? (
                      <DatePickerInput
                        aria-label="Custom range"
                        type="range"
                        value={customRangeValue}
                        onChange={handleCustomRangeChange}
                        valueFormat="MMM DD, YYYY"
                        allowSingleDateInRange
                        minDate={EARLIEST_DATA_DATE.toDate()}
                        maxDate={today.toDate()}
                        style={{ flex: 1 }}
                        styles={{ input: { textAlign: 'center' } }}
                      />
                    ) : (
                      <TextInput
                        aria-label="Selected date range"
                        value={selectedRangeLabel}
                        readOnly
                        style={{ flex: 1 }}
                        styles={{ input: { textAlign: 'center', cursor: 'default' } }}
                      />
                    )}
                    <ActionIcon
                      variant="light"
                      color="blue"
                      size="lg"
                      aria-label="Next period"
                      disabled={!canShiftNext}
                      onClick={() => handleShiftPeriod(1)}
                    >
                      <IconChevronRight size={18} />
                    </ActionIcon>
                  </Group>
                </Stack>
              </Box>

              {loading && (
                <Center>
                  <Loader size="lg" />
                </Center>
              )}

              {friendlyError && (
                <Alert color="red" title={friendlyError.title} variant="light">
                  <Text size="sm">{friendlyError.description}</Text>
                  {friendlyError.details && (
                    <Text size="xs" c="dimmed" mt={4}>
                      Details: {friendlyError.details}
                    </Text>
                  )}
                </Alert>
              )}
              {actionAlert && (
                <Alert color={actionAlert.type === 'error' ? 'red' : 'teal'} title="Staff payouts" variant="light">
                  <Text size="sm">{actionAlert.text}</Text>
                </Alert>
              )}

              {!loading && !error && summaries.length > 0 && (
                <Stack gap="lg">
                  {!isCanonicalRange && (
                    <Alert color="yellow" variant="light">
                      Custom date ranges are view-only. Switch to a full calendar month to record or adjust payouts.
                    </Alert>
                  )}
                  {renderSummaryBoard()}
                  {usingSelfScope ? renderSelfDetails() : isDesktop ? renderDesktopTable() : renderMobileCards()}
                </Stack>
              )}

              {!loading && !error && summaries.length === 0 && (
                <Text ta="center">No data available for the selected dates.</Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Container>
    );
  }

  const reportingRangeLabel =
    startDate && endDate
      ? `${startDate.format('MMM D, YYYY')} - ${endDate.format('MMM D, YYYY')}`
      : 'selected period';
  const reimbursementAddon = entryModal.includeReimbursements ? entryModal.reimbursementsAwaitingAmount : 0;
  const modalTotalAmount = entryModal.amount + reimbursementAddon;
  const modalFundAllocationAmount = entryModal.fundAllocations
    .filter((line) => line.include)
    .reduce((sum, line) => sum + line.amount, 0);
  const modalSettlementAmount = modalTotalAmount + modalFundAllocationAmount;
  const modalHasPersonalPayment = modalTotalAmount > 0;
  const modalRouteConflicts = (entryModal.staff?.settlementSources ?? []).filter(
    (source) => source.routeChanged,
  );
  const paidModalEntries = paidEntriesModal.staff?.paidEntries ?? [];
  const deletablePaidEntries = paidModalEntries.filter((entry) => entry.canDelete);
  const selectedPaidEntries = paidModalEntries.filter((entry) => paidEntriesModal.selectedIds.includes(entry.id));
  const selectedPaidEntriesAmount = selectedPaidEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const allPaidEntriesSelected =
    deletablePaidEntries.length > 0 &&
    deletablePaidEntries.every((entry) => paidEntriesModal.selectedIds.includes(entry.id));

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <>
        {content}
        <Modal
          opened={openingBalanceDetailsOpen}
          onClose={() => setOpeningBalanceDetailsOpen(false)}
          title="Opening balance detail"
          size={isDesktop ? '85vw' : '95vw'}
          radius="lg"
        >
          {renderOpeningBalanceDetails()}
        </Modal>
        <Modal
          opened={paidEntriesModal.open}
          onClose={closePaidEntriesModal}
          title={
            paidEntriesModal.staff
              ? `Manage paid for ${formatPayStaffName(paidEntriesModal.staff)}`
              : 'Manage paid'
          }
          size={isDesktop ? '70vw' : '100%'}
          fullScreen={!isDesktop}
          radius={isDesktop ? 'lg' : 0}
          styles={{
            content: { paddingBottom: 0 },
            body: { padding: isDesktop ? undefined : 0 },
            header: {
              padding: isDesktop ? undefined : '16px 18px',
              borderBottom: isDesktop ? undefined : '1px solid var(--mantine-color-gray-2)',
            },
            title: { fontWeight: 700 },
          }}
        >
          <Box style={{ height: isDesktop ? 'auto' : 'calc(100dvh - 61px)', display: 'flex', flexDirection: 'column' }}>
            <ScrollArea.Autosize mah={isDesktop ? '80vh' : undefined} style={{ flex: 1, minHeight: 0 }}>
              <Stack gap="md" p={isDesktop ? 0 : 'md'} pb={isDesktop ? 'sm' : 96}>
                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                    <Stack gap={2} align="center">
                      <Text size="xs" c="dimmed">
                        Recorded lines
                      </Text>
                      <Text fw={700}>{paidModalEntries.length}</Text>
                    </Stack>
                  </Card>
                  <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                    <Stack gap={2} align="center">
                      <Text size="xs" c="dimmed">
                        Selected
                      </Text>
                      <Text fw={700}>{paidEntriesModal.selectedIds.length}</Text>
                    </Stack>
                  </Card>
                  <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                    <Stack gap={2} align="center">
                      <Text size="xs" c="dimmed">
                        Selected amount
                      </Text>
                      <Text fw={700}>
                        {formatCurrency(
                          selectedPaidEntriesAmount,
                          paidEntriesModal.staff?.payouts?.currency ?? DEFAULT_CURRENCY,
                        )}
                      </Text>
                    </Stack>
                  </Card>
                </SimpleGrid>

                <Card withBorder radius="md" padding={isDesktop ? 'lg' : 'md'}>
                  <Stack gap="md">
                    <Group justify="space-between" align={isDesktop ? 'center' : 'stretch'} wrap="wrap">
                      <Text size="sm" c="dimmed" ta={isDesktop ? undefined : 'center'} style={{ flex: 1 }}>
                        Select the recorded components you want to remove from this payout month.
                      </Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        fullWidth={!isDesktop}
                        onClick={() =>
                          setPaidEntriesModal((prev) => ({
                            ...prev,
                            selectedIds: allPaidEntriesSelected ? [] : deletablePaidEntries.map((entry) => entry.id),
                          }))
                        }
                        disabled={deletablePaidEntries.length === 0}
                      >
                        {allPaidEntriesSelected ? 'Clear selection' : 'Select all'}
                      </Button>
                    </Group>

                    {paidModalEntries.length > 0 ? (
                      isDesktop ? (
                        <ScrollArea mah={420} offsetScrollbars>
                          <PaidEntriesTable
                            entries={paidModalEntries}
                            selectedIds={paidEntriesModal.selectedIds}
                            onToggle={handleTogglePaidEntry}
                            onOpenReceipt={canManageReceiptEvidence
                              ? (receiptId) => void openReceiptEvidenceModal(receiptId)
                              : undefined}
                          />
                        </ScrollArea>
                      ) : (
                          <PaidEntriesTable
                            entries={paidModalEntries}
                            selectedIds={paidEntriesModal.selectedIds}
                            onToggle={handleTogglePaidEntry}
                            onOpenReceipt={canManageReceiptEvidence
                              ? (receiptId) => void openReceiptEvidenceModal(receiptId)
                              : undefined}
                            compact
                          />
                      )
                    ) : (
                      <Alert color="blue" variant="light">
                        No recorded payout components were found for this staff member in the selected month.
                      </Alert>
                    )}
                  </Stack>
                </Card>

                {paidEntriesMessage ? (
                  <Alert color={paidEntriesMessage.type === 'error' ? 'red' : 'teal'} variant="light">
                    {paidEntriesMessage.text}
                  </Alert>
                ) : null}
              </Stack>
            </ScrollArea.Autosize>
            <Box
              p={isDesktop ? 0 : 'md'}
              style={
                isDesktop
                  ? undefined
                  : {
                      borderTop: '1px solid var(--mantine-color-gray-2)',
                      backgroundColor: 'var(--mantine-color-white)',
                    }
              }
            >
              <Group justify={isDesktop ? 'flex-end' : 'space-between'} grow={!isDesktop}>
                <Button variant="subtle" onClick={closePaidEntriesModal}>
                  Close
                </Button>
                <Button
                  color="red"
                  onClick={handleDeletePaidEntries}
                  loading={paidEntriesSubmitting}
                  disabled={paidEntriesModal.selectedIds.length === 0}
                >
                  Delete selected
                </Button>
              </Group>
            </Box>
          </Box>
        </Modal>
        <Modal
          opened={receiptHistoryBrowserModal.open}
          onClose={closeReceiptHistoryBrowserModal}
          title={
            receiptHistoryBrowserModal.staff
              ? `Receipt history for ${formatPayStaffName(receiptHistoryBrowserModal.staff)}`
              : 'Staff payout receipt history'
          }
          size={isDesktop ? '65vw' : '100%'}
          fullScreen={!isDesktop}
          radius={isDesktop ? 'lg' : 0}
          styles={{ title: { fontWeight: 700 } }}
        >
          <Stack gap="md">
            <Alert color="blue" variant="light">
              Showing receipt requests whose compensation period overlaps {reportingRangeLabel}, including cancelled and superseded versions.
            </Alert>
            {receiptHistoryBrowserModal.loading ? (
              <Center py="xl">
                <Stack gap="sm" align="center">
                  <Loader />
                  <Text size="sm" c="dimmed">
                    Loading receipt history...
                  </Text>
                </Stack>
              </Center>
            ) : receiptHistoryBrowserModal.error ? (
              <Alert color="red" variant="light">
                {receiptHistoryBrowserModal.error}
              </Alert>
            ) : receiptHistoryBrowserModal.receipts.length === 0 ? (
              <Alert color="gray" variant="light">
                No payout receipt requests were found for this staff member and period.
              </Alert>
            ) : (
              <Stack gap="sm">
                {receiptHistoryBrowserModal.receipts.map((historyReceipt) => {
                  const historyStatus = getPayReceiptHistoryStatusMeta(historyReceipt);
                   const { at: eventAt, label: eventLabel } = getPayReceiptHistoryEvent(historyReceipt);
                  return (
                    <Paper key={historyReceipt.id} withBorder radius="md" p="md">
                      <Group justify="space-between" align="center" wrap="wrap" gap="md">
                        <Stack gap={5}>
                          <Group gap="xs" wrap="wrap">
                            <Text fw={700}>Receipt #{historyReceipt.id}</Text>
                            <Badge color={historyStatus.color} variant="light">
                              {historyStatus.label}
                            </Badge>
                            {historyReceipt.isCurrent ? (
                              <Badge color="blue" variant="filled">
                                Current
                              </Badge>
                            ) : null}
                            {historyReceipt.hasPhoto || historyReceipt.hasSignature ? (
                              <Badge color="violet" variant="light">
                                Evidence saved
                              </Badge>
                            ) : null}
                          </Group>
                          <Text fw={700}>
                            {historyReceipt.totals
                              .map((total) => formatCurrency(total.amount, total.currency))
                              .join(' + ')}
                          </Text>
                          <Text size="sm" c="dimmed">
                            {formatRangeLabel(historyReceipt.rangeStart, historyReceipt.rangeEnd)} | Paid{' '}
                            {dayjs(historyReceipt.paidDate).format('MMM D, YYYY')}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {eventLabel} {formatDateTimeLabel(eventAt)} | {historyReceipt.itemCount}{' '}
                            {historyReceipt.itemCount === 1 ? 'component' : 'components'}
                          </Text>
                        </Stack>
                        <Button
                          variant="light"
                          leftSection={<IconReceipt size={16} />}
                          onClick={() => openReceiptFromHistoryBrowser(historyReceipt.id)}
                        >
                          View receipt
                        </Button>
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            )}
            {receiptHistoryBrowserModal.hasMore ? (
              <Alert color="blue" variant="light">
                More receipt versions exist outside this result. Narrow the selected payout period to view them.
              </Alert>
            ) : null}
          </Stack>
        </Modal>
        <Modal
          opened={receiptEvidenceModal.open}
          onClose={closeReceiptEvidenceModal}
          title={
            receiptEvidenceModal.detail
              ? `Payout receipt #${receiptEvidenceModal.detail.id}`
              : 'Payout receipt'
          }
          size={isDesktop ? '75vw' : '100%'}
          fullScreen={!isDesktop}
          radius={isDesktop ? 'lg' : 0}
          styles={{ title: { fontWeight: 700 } }}
        >
          {receiptEvidenceModal.loading ? (
            <Center py="xl">
              <Stack gap="sm" align="center">
                <Loader />
                <Text size="sm" c="dimmed">
                  Loading receipt evidence...
                </Text>
              </Stack>
            </Center>
          ) : receiptEvidenceModal.error ? (
            <Alert color="red" variant="light">
              {receiptEvidenceModal.error}
            </Alert>
          ) : receiptEvidenceModal.detail ? (
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <Card withBorder radius="md" padding="sm">
                  <Stack gap={4} align="center" ta="center">
                    <Text size="xs" c="dimmed">
                      Status
                    </Text>
                    <Badge
                      color={getPayReceiptStatusMeta(receiptEvidenceModal.detail).color}
                      variant="light"
                    >
                      {getPayReceiptStatusMeta(receiptEvidenceModal.detail).label}
                    </Badge>
                  </Stack>
                </Card>
                <Card withBorder radius="md" padding="sm">
                  <Stack gap={4} align="center" ta="center">
                    <Text size="xs" c="dimmed">
                      Received amount
                    </Text>
                    <Text fw={700}>
                      {receiptEvidenceModal.detail.totals
                        .map((total) => formatCurrency(total.amount, total.currency))
                        .join(' + ')}
                    </Text>
                  </Stack>
                </Card>
                <Card withBorder radius="md" padding="sm">
                  <Stack gap={4} align="center" ta="center">
                    <Text size="xs" c="dimmed">
                      Payment date
                    </Text>
                    <Text fw={700}>{dayjs(receiptEvidenceModal.detail.paidDate).format('MMM D, YYYY')}</Text>
                  </Stack>
                </Card>
                <Card withBorder radius="md" padding="sm">
                  <Stack gap={4} align="center" ta="center">
                    <Text size="xs" c="dimmed">
                      Confirmed
                    </Text>
                    <Text fw={700}>{formatDateTimeLabel(receiptEvidenceModal.detail.confirmedAt)}</Text>
                  </Stack>
                </Card>
              </SimpleGrid>

              <Card withBorder radius="md" padding="md">
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                  <Stack gap={4} align={isDesktop ? 'flex-start' : 'center'}>
                    <Text size="xs" c="dimmed">
                      Staff member
                    </Text>
                    <Text fw={700}>
                      {formatPayStaffName({
                        fullName: receiptEvidenceModal.detail.staffName,
                        userId: receiptEvidenceModal.detail.staffUserId,
                      })}
                    </Text>
                  </Stack>
                  <Stack gap={4} align="center">
                    <Text size="xs" c="dimmed">
                      Payout period
                    </Text>
                    <Text fw={700}>
                      {formatRangeLabel(
                        receiptEvidenceModal.detail.rangeStart,
                        receiptEvidenceModal.detail.rangeEnd,
                      )}
                    </Text>
                  </Stack>
                  <Stack gap={4} align={isDesktop ? 'flex-end' : 'center'}>
                    <Text size="xs" c="dimmed">
                      Recorded by
                    </Text>
                    <Text fw={700}>{receiptEvidenceModal.detail.paidByName}</Text>
                  </Stack>
                </SimpleGrid>
              </Card>

              {receiptEvidenceModal.detail.status === 'cancelled' ? (
                <Alert color="red" variant="light">
                  This receipt request was cancelled
                  {receiptEvidenceModal.detail.cancelledAt
                    ? ` on ${formatDateTimeLabel(receiptEvidenceModal.detail.cancelledAt)}`
                    : ''}
                  .{receiptEvidenceModal.detail.cancelReason ? ` ${receiptEvidenceModal.detail.cancelReason}` : ''}
                </Alert>
              ) : receiptEvidenceModal.detail.status === 'pending' ? (
                <Alert color="orange" variant="light">
                  Waiting for the staff member to photograph the payment and sign the receipt.
                </Alert>
              ) : null}

              <Card withBorder radius="md" padding="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Group gap="sm" align="flex-start">
                      <IconHistory size={22} />
                      <Stack gap={2}>
                        <Text fw={700}>Receipt history</Text>
                        <Text size="sm" c="dimmed">
                          Current and previous receipt requests for this payout. Superseded evidence remains available for audit.
                        </Text>
                      </Stack>
                    </Group>
                    {!receiptEvidenceModal.historyLoading && !receiptEvidenceModal.historyError ? (
                      <Badge variant="light" color="gray">
                        {receiptEvidenceModal.history.length}{' '}
                        {receiptEvidenceModal.history.length === 1 ? 'version' : 'versions'}
                      </Badge>
                    ) : null}
                  </Group>

                  {receiptEvidenceModal.historyLoading ? (
                    <Group gap="xs" justify="center" py="sm">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">
                        Loading receipt history...
                      </Text>
                    </Group>
                  ) : receiptEvidenceModal.historyError ? (
                    <Alert color="orange" variant="light">
                      {receiptEvidenceModal.historyError}
                    </Alert>
                  ) : receiptEvidenceModal.history.length === 0 ? (
                    <Text size="sm" c="dimmed" ta="center" py="sm">
                      No related receipt versions were found.
                    </Text>
                  ) : (
                    <Stack gap="xs">
                      {receiptEvidenceModal.history.map((historyReceipt) => {
                        const historyStatus = getPayReceiptHistoryStatusMeta(historyReceipt);
                        const isViewing = historyReceipt.id === receiptEvidenceModal.detail?.id;
                        const { at: eventAt, label: eventLabel } = getPayReceiptHistoryEvent(historyReceipt);
                        return (
                          <Paper
                            key={historyReceipt.id}
                            withBorder
                            radius="md"
                            p="sm"
                            style={{
                              borderColor: isViewing
                                ? 'var(--mantine-color-blue-5)'
                                : undefined,
                              backgroundColor: isViewing
                                ? 'var(--mantine-color-blue-0)'
                                : undefined,
                            }}
                          >
                            <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                              <Stack gap={4}>
                                <Group gap="xs" wrap="wrap">
                                  <Text fw={700}>Receipt #{historyReceipt.id}</Text>
                                  <Badge color={historyStatus.color} variant="light">
                                    {historyStatus.label}
                                  </Badge>
                                  {historyReceipt.isCurrent ? (
                                    <Badge color="blue" variant="filled">
                                      Current
                                    </Badge>
                                  ) : null}
                                  {isViewing ? (
                                    <Badge color="gray" variant="outline">
                                      Viewing
                                    </Badge>
                                  ) : null}
                                  {historyReceipt.hasPhoto || historyReceipt.hasSignature ? (
                                    <Badge color="violet" variant="light">
                                      Evidence saved
                                    </Badge>
                                  ) : null}
                                </Group>
                                <Text size="sm" fw={600}>
                                  {historyReceipt.totals
                                    .map((total) => formatCurrency(total.amount, total.currency))
                                    .join(' + ')}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {eventLabel} {formatDateTimeLabel(eventAt)} | {historyReceipt.itemCount}{' '}
                                  {historyReceipt.itemCount === 1 ? 'component' : 'components'}
                                </Text>
                              </Stack>
                              <Button
                                size="compact-sm"
                                variant={isViewing ? 'light' : 'subtle'}
                                leftSection={<IconReceipt size={15} />}
                                disabled={isViewing}
                                onClick={() => void openReceiptEvidenceModal(historyReceipt.id)}
                              >
                                {isViewing ? 'Viewing' : 'View evidence'}
                              </Button>
                            </Group>
                          </Paper>
                        );
                      })}
                    </Stack>
                  )}

                  {receiptEvidenceModal.historyHasMore ? (
                    <Alert color="blue" variant="light">
                      More receipt versions exist outside this result. Narrow the staff payout date range to view them.
                    </Alert>
                  ) : null}
                </Stack>
              </Card>

              <Card withBorder radius="md" padding="md">
                <Stack gap="sm">
                  <Text fw={700}>Payment components</Text>
                  <ScrollArea offsetScrollbars>
                    <Table striped withColumnBorders miw={560}>
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th>Amount</th>
                          <th>Finance transaction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receiptEvidenceModal.detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.label}</td>
                            <td>{formatCurrency(item.amount, item.currency)}</td>
                            <td>{item.financeTransactionId ? `#${item.financeTransactionId}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </ScrollArea>
                </Stack>
              </Card>

              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                <Card withBorder radius="md" padding="md">
                  <Stack gap="sm">
                    <Text fw={700} ta="center">
                      Photo evidence
                    </Text>
                    {receiptEvidenceModal.photoUrl ? (
                      <Image
                        src={receiptEvidenceModal.photoUrl}
                        alt={`Payout receipt ${receiptEvidenceModal.detail.id} photo evidence`}
                        radius="md"
                        fit="contain"
                        mah={460}
                      />
                    ) : (
                      <Text size="sm" c="dimmed" ta="center">
                        No photo evidence has been submitted.
                      </Text>
                    )}
                  </Stack>
                </Card>
                <Card withBorder radius="md" padding="md">
                  <Stack gap="sm">
                    <Text fw={700} ta="center">
                      Staff e-signature
                    </Text>
                    {receiptEvidenceModal.signatureUrl ? (
                      <Box p="md" bg="gray.0" style={{ borderRadius: 'var(--mantine-radius-md)' }}>
                        <Image
                          src={receiptEvidenceModal.signatureUrl}
                          alt={`Payout receipt ${receiptEvidenceModal.detail.id} signature`}
                          fit="contain"
                          mah={260}
                        />
                      </Box>
                    ) : (
                      <Text size="sm" c="dimmed" ta="center">
                        No signature has been submitted.
                      </Text>
                    )}
                    <Text size="xs" c="dimmed" ta="center">
                      {receiptEvidenceModal.detail.acceptanceText}
                    </Text>
                  </Stack>
                </Card>
              </SimpleGrid>
            </Stack>
          ) : null}
        </Modal>
        <Modal
          opened={entryModal.open}
          onClose={closeEntryModal}
          title={
            entryModal.staff
              ? `Process compensation for ${formatPayStaffName(entryModal.staff)}`
              : 'Process staff compensation'
          }
          size={isDesktop ? '80vw' : '100%'}
          fullScreen={!isDesktop}
          radius={isDesktop ? 'lg' : 0}
          styles={{
            content: { paddingBottom: 0 },
            body: { padding: isDesktop ? undefined : 0 },
            header: {
              padding: isDesktop ? undefined : '16px 18px',
              borderBottom: isDesktop ? undefined : '1px solid var(--mantine-color-gray-2)',
            },
            title: { fontWeight: 700 },
          }}
        >
          <Box style={{ height: isDesktop ? 'auto' : 'calc(100dvh - 61px)', display: 'flex', flexDirection: 'column' }}>
            <ScrollArea.Autosize mah={isDesktop ? '80vh' : undefined} style={{ flex: 1, minHeight: 0 }}>
              <Stack gap="md" p={isDesktop ? 0 : 'md'} pb={isDesktop ? 'lg' : 96}>
                {entryModal.staff?.settlementReconciliationRequired ? (
                  <Alert color="red" title="Historical payout reconciliation required">
                    {entryModal.staff.settlementReconciliationMessage
                      ?? 'The saved liability and historical source breakdown no longer match.'}
                  </Alert>
                ) : null}
                {renderVolunteerRoutingNotice(entryModal.staff)}
                <Card withBorder radius="md" padding={isDesktop ? 'lg' : 'md'}>
                  <Stack gap="md" align="stretch">
                    <Stack gap={8} align="center" ta="center">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Payout period
                      </Text>
                      <Text size="sm" c="dimmed">
                        {entryModal.rangeStart && entryModal.rangeEnd
                          ? formatRangeLabel(entryModal.rangeStart, entryModal.rangeEnd)
                          : reportingRangeLabel}
                      </Text>
                    </Stack>
                  {entryModal.staff && (
                    <SimpleGrid cols={{ base: 1, sm: modalFundAllocationAmount > 0 ? 4 : 3 }}>
                      <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                        <Stack gap={2} align="center">
                          <Text size="xs" c="dimmed">
                            Personal outstanding
                          </Text>
                          <Text fw={600}>
                            {formatCurrency(
                              Math.max(
                                entryModal.staff.closingBalance
                                  ?? entryModal.staff.payouts?.payableOutstanding
                                  ?? 0,
                                0,
                              ),
                              entryModal.staff.payouts?.currency ?? DEFAULT_CURRENCY,
                            )}
                          </Text>
                        </Stack>
                      </Card>
                      <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                        <Stack gap={2} align="center">
                          <Text size="xs" c="dimmed">
                            Pay to staff
                          </Text>
                          <Text fw={600}>{formatCurrency(modalTotalAmount, entryModal.currency)}</Text>
                        </Stack>
                      </Card>
                      {modalFundAllocationAmount > 0 && (
                        <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                          <Stack gap={2} align="center">
                            <Text size="xs" c="dimmed">
                              Allocate to fund
                            </Text>
                            <Text fw={600} c="blue">
                              {formatCurrency(modalFundAllocationAmount, entryModal.currency)}
                            </Text>
                          </Stack>
                        </Card>
                      )}
                      <Card padding="sm" radius="md" withBorder shadow="xs" style={{ textAlign: 'center' }}>
                        <Stack gap={2} align="center">
                          <Text size="xs" c="dimmed">
                            Personal remaining
                          </Text>
                          <Text fw={600}>
                            {formatCurrency(
                              Math.max(
                                Math.max(
                                  entryModal.staff.closingBalance
                                    ?? entryModal.staff.payouts?.payableOutstanding
                                    ?? 0,
                                  0,
                                ) - modalTotalAmount,
                                0,
                              ),
                              entryModal.currency,
                            )}
                          </Text>
                        </Stack>
                      </Card>
                    </SimpleGrid>
                  )}
                </Stack>
              </Card>

              {modalRouteConflicts.length > 0 && (
                <Alert color="red" title="Fund allocation needs reconciliation">
                  {modalRouteConflicts.map((source) => source.label).join(', ')} already has an active allocation under an older route. Reverse that ledger entry before applying the new routing rule.
                </Alert>
              )}

              {entryModal.fundAllocations.length > 0 && (
                <Card
                  withBorder
                  radius="md"
                  padding={isDesktop ? 'lg' : 'md'}
                  bg="blue.0"
                  style={{ borderColor: 'var(--mantine-color-blue-5)' }}
                >
                  <Stack gap="md">
                    <Stack gap={3}>
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text fw={800} c="blue.9">Allocate to Volunteer Fund</Text>
                        <Badge color="blue" variant="filled">
                          {formatCurrency(modalFundAllocationAmount, entryModal.currency)}
                        </Badge>
                      </Group>
                      <Text size="sm" c="blue.9">
                        These amounts remain in the organization-controlled fund. They are not paid to the staff member and do not create a receipt request.
                      </Text>
                    </Stack>
                    <Stack gap="xs">
                      {entryModal.fundAllocations.map((line) => (
                        <Card key={line.id} withBorder radius="md" padding="sm" bg="white">
                          <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                            <Stack gap={2} style={{ minWidth: 0 }}>
                              <Text fw={700}>{line.label}</Text>
                              <Text size="xs" c="dimmed">{line.fundName}</Text>
                            </Stack>
                            <Group gap="md">
                              <Text fw={800} c="blue.8">{formatCurrency(line.amount, entryModal.currency)}</Text>
                              <Switch
                                label="Allocate"
                                checked={line.include}
                                onChange={(event) =>
                                  setEntryModal((previous) => ({
                                    ...previous,
                                    fundAllocations: previous.fundAllocations.map((entry) =>
                                      entry.id === line.id
                                        ? { ...entry, include: event.currentTarget.checked }
                                        : entry,
                                    ),
                                  }))
                                }
                              />
                            </Group>
                          </Group>
                        </Card>
                      ))}
                    </Stack>
                  </Stack>
                </Card>
              )}

              <Card withBorder radius="md" padding={isDesktop ? 'lg' : 'md'}>
                <Stack gap="md">
                  {modalHasPersonalPayment && (
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput
                        label="Linked staff vendor"
                        value={
                          financeVendorsById.get(Number(entryModal.counterpartyId))?.name
                          ?? "No finance vendor linked"
                        }
                        readOnly
                        variant="filled"
                      />
                      <Select
                        label="Payout account"
                        placeholder="Select an account"
                        data={accountOptions}
                        value={entryModal.accountId || null}
                        onChange={handleEntryAccountChange}
                        searchable
                        clearable
                      />
                    </SimpleGrid>
                  )}
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <DatePickerInput
                      label="Settlement date"
                      value={entryModal.date}
                      onChange={(value) => {
                        if (value) {
                          setEntryModal((prev) => ({ ...prev, date: value }));
                        }
                      }}
                    />
                    <TextInput label="Currency" value={entryModal.currency} readOnly variant="filled" />
                  </SimpleGrid>
                  <Textarea
                    label="Settlement note"
                    minRows={2}
                    value={entryModal.description}
                    onChange={(event) =>
                      setEntryModal((prev) => ({ ...prev, description: event.currentTarget.value }))
                    }
                  />
                </Stack>
              </Card>

              {entryModal.reimbursementEntries.length > 0 && (
                <Card withBorder radius="md" padding={isDesktop ? 'lg' : 'md'}>
                  <Stack gap="sm">
                    <Stack gap="sm" align={isDesktop ? 'stretch' : 'center'} ta={isDesktop ? undefined : 'center'}>
                      <Stack gap={2} align={isDesktop ? 'stretch' : 'center'}>
                        <Text fw={700}>Reimbursements</Text>
                        <Text size="xs" c="dimmed">
                          Staff-covered expenses within this payout range.
                        </Text>
                        <Group gap="xs" justify="center">
                          <Badge variant="light" color={entryModal.reimbursementsAwaitingAmount > 0 ? 'orange' : 'gray'}>
                            Awaiting {formatCurrency(entryModal.reimbursementsAwaitingAmount)}
                          </Badge>
                          <Badge
                            variant="light"
                            color={
                              (entryModal.staff?.reimbursements?.reimbursedAmount ?? 0) > 0 ? 'teal' : 'gray'
                            }
                          >
                            Reimbursed {formatCurrency(entryModal.staff?.reimbursements?.reimbursedAmount ?? 0)}
                          </Badge>
                        </Group>
                      </Stack>
                      <Switch
                        label="Include in this payout"
                        checked={entryModal.includeReimbursements && entryModal.reimbursementsAwaitingAmount > 0}
                        onChange={(event) =>
                          setEntryModal((prev) => ({
                            ...prev,
                            includeReimbursements: event.currentTarget.checked,
                          }))
                        }
                        disabled={entryModal.reimbursementsAwaitingAmount <= 0}
                      />
                    </Stack>
                    <ReimbursementEntriesTable
                      entries={entryModal.reimbursementEntries}
                      maxHeight={isDesktop ? 240 : undefined}
                      compact={!isDesktop}
                    />
                  </Stack>
                </Card>
              )}

              {entryModal.lines.length > 0 && (
              <Card withBorder radius="md" padding={isDesktop ? 'lg' : 'md'}>
                <Stack gap="md">
                  <Group justify="space-between" align={isDesktop ? 'center' : 'stretch'} wrap="wrap">
                    <Stack gap={2} align={isDesktop ? 'stretch' : 'center'} ta={isDesktop ? undefined : 'center'} style={{ flex: 1 }}>
                      <Text fw={700}>Compensation Items</Text>
                    </Stack>
                    {(entryModal.staff?.staffType ?? '').trim().toLowerCase() !== 'volunteer' && (
                      <Button variant="subtle" size="xs" fullWidth={!isDesktop} onClick={handleAddManualLine}>
                        Add manual line
                      </Button>
                    )}
                  </Group>
                  <Stack gap="sm">
                    {entryModal.lines.map((line) => {
                      const lineComponent = line.componentId
                        ? compensationComponentLookup.get(line.componentId)
                        : null;
                      const canEditLineLabel = Boolean(line.labelEditable);
                      return (
                        <Card key={line.id} withBorder radius="md" padding="md" shadow="sm">
                          <Stack gap="sm">
                            <Group justify="space-between" align="flex-start" gap="sm" wrap={isDesktop ? 'nowrap' : 'wrap'}>
                              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                                <TextInput
                                  value={line.label}
                                  readOnly={!canEditLineLabel}
                                  variant={canEditLineLabel ? 'default' : 'filled'}
                                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                    canEditLineLabel
                                      ? handleLineChange(line.id, { label: event.currentTarget.value })
                                      : undefined
                                  }
                                />
                                {lineComponent && (
                                  <Group gap={6} wrap="wrap" justify={isDesktop ? 'flex-start' : 'center'}>
                                    <Badge color="blue" variant="light">
                                      {lineComponent.name}
                                    </Badge>
                                    <Badge variant="outline" color="gray">
                                      {lineComponent.category}
                                    </Badge>
                                  </Group>
                                )}
                                {line.affiliatePayout && (
                                  <Group gap={6} wrap="wrap" justify={isDesktop ? 'flex-start' : 'center'}>
                                    <Badge color="teal" variant="light">
                                      Promotion Sales
                                    </Badge>
                                    <Badge variant="outline" color="gray">
                                      {line.affiliatePayout.bookingIds.length} bookings
                                    </Badge>
                                  </Group>
                                )}
                              </Stack>
                              <Group gap="xs" justify={isDesktop ? 'flex-start' : 'space-between'} style={!isDesktop ? { width: '100%' } : undefined}>
                                <Switch
                                  label="Include"
                                  size="sm"
                                  checked={line.include}
                                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                    handleLineChange(line.id, { include: event.currentTarget.checked })
                                  }
                                />
                                <ActionIcon
                                  color="red"
                                  variant="subtle"
                                  aria-label="Remove line"
                                  disabled={entryModal.lines.length <= 1}
                                  onClick={() => handleRemoveLine(line.id)}
                                >
                                  <IconTrash size={18} />
                                </ActionIcon>
                              </Group>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                              <NumberInput
                                label={`Amount (${currencyLabel})`}
                                value={line.amount.toFixed(2)}
                                min={0}
                                hideControls
                                step={0.01}
                                leftSection={<Text size="xs">{currencyLabel}</Text>}
                                onChange={(value) => {
                                  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
                                  const sanitized = Number.isFinite(numeric) ? Math.max(numeric, 0) : line.amount;
                                  handleLineChange(line.id, {
                                    amount: Number(Number(sanitized).toFixed(2)),
                                  });
                                }}
                              />
                              <Select
                                label="Account"
                                placeholder="Use payout account"
                                data={accountOptions}
                                value={line.accountId || null}
                                onChange={(value) => handleLineChange(line.id, { accountId: value ?? '' })}
                                searchable
                                clearable
                              />
                              <Select
                                label="Category"
                                placeholder="Choose a category"
                                data={expenseCategoryOptions}
                                value={line.categoryId || null}
                                onChange={(value) => handleLineChange(line.id, { categoryId: value ?? '' })}
                                searchable
                              />
                            </SimpleGrid>
                            <Textarea
                              label="Description"
                              minRows={2}
                              autosize
                              value={line.description}
                              onChange={(event) =>
                                handleLineChange(line.id, { description: event.currentTarget.value })
                              }
                            />
                          </Stack>
                        </Card>
                      );
                    })}
                  </Stack>
                  <Group justify="space-between">
                    <Stack gap={2}>
                      <Text size="sm" c="dimmed">
                        Component total: {formatCurrency(entryModal.amount, entryModal.currency)}
                      </Text>
                      {entryModal.includeReimbursements && reimbursementAddon > 0 && (
                        <Text size="xs" c="dimmed">
                          + Reimbursements {formatCurrency(reimbursementAddon, entryModal.currency)} ={' '}
                          {formatCurrency(modalTotalAmount, entryModal.currency)}
                        </Text>
                      )}
                      {modalFundAllocationAmount > 0 && (
                        <Text size="xs" fw={700} c="blue.8">
                          Total processed: {formatCurrency(modalSettlementAmount, entryModal.currency)}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        Lines with blank accounts use the payout account above.
                      </Text>
                    </Stack>
                  </Group>
                </Stack>
              </Card>
              )}

              {entryMessage && (
                <Alert color={entryMessage.type === 'error' ? 'red' : 'green'}>{entryMessage.text}</Alert>
              )}
            </Stack>
          </ScrollArea.Autosize>
          <Box
            p={isDesktop ? 0 : 'md'}
            style={
              isDesktop
                ? undefined
                : {
                    borderTop: '1px solid var(--mantine-color-gray-2)',
                    backgroundColor: 'var(--mantine-color-white)',
                  }
            }
          >
            <Group justify={isDesktop ? 'flex-end' : 'space-between'} grow={!isDesktop}>
              <Button variant="subtle" onClick={closeEntryModal}>
                Cancel
              </Button>
              <Button
                onClick={handleEntrySubmit}
                loading={entrySubmitting}
                disabled={Boolean(entryModal.staff?.settlementReconciliationRequired)}
              >
                Process compensation
              </Button>
            </Group>
          </Box>
          </Box>
        </Modal>
      </>
    </PageAccessGuard>
  );
};

export default Pays;

