import { useId, useState } from 'react';
import {
  ActionIcon,
  Collapse,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import dayjs from 'dayjs';
import type { PayTaskCompletionDailyBreakdownRow } from '../../types/pays/Pay';

type TaskCompletionDailyBreakdownProps = {
  rows?: PayTaskCompletionDailyBreakdownRow[] | null;
  formatAmount: (amount: number) => string;
  salaryRecipientUserId?: number | null;
};

const formatPercent = (value: number): string => {
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
  return `${normalized.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
};

const formatDay = (value: string): string => {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('ddd, MMM D, YYYY') : value || 'Unknown day';
};

const completionCountLabel = (row: PayTaskCompletionDailyBreakdownRow): string | null => {
  if (row.attributionMethod === 'ambiguous') {
    return 'Automatic task attribution skipped \u2014 no deduction';
  }
  if (row.totalTasks == null) {
    return null;
  }
  if (row.totalTasks === 0) {
    return 'No tasks assigned \u2014 no deduction';
  }
  const parts = [
    row.completedTasks == null ? null : `${row.completedTasks} completed`,
    row.waivedTasks == null || row.waivedTasks === 0 ? null : `${row.waivedTasks} waived`,
    `${row.totalTasks} total`,
  ].filter(Boolean);
  return parts.join(' / ');
};

const isAlternateTaskOwner = (
  row: PayTaskCompletionDailyBreakdownRow,
  salaryRecipientUserId?: number | null,
): boolean => {
  const taskOwnerUserId = Number(row.taskOwnerUserId);
  const recipientUserId = Number(salaryRecipientUserId);
  if (
    Number.isInteger(taskOwnerUserId)
    && taskOwnerUserId > 0
    && Number.isInteger(recipientUserId)
    && recipientUserId > 0
  ) {
    return taskOwnerUserId !== recipientUserId;
  }

  // Older/cached report payloads may omit one of the IDs. An explicit
  // takeover attribution remains safe to explain in that case.
  return ['shift_assignment', 'shift_instance'].includes(
    row.attributionMethod?.trim().toLowerCase() ?? '',
  );
};

type TakeoverAllocationDetails = {
  label: string;
  color: string;
  taskOwnerLabel: string;
  fullDayBaseAmount: number;
  fullDayPayableAmount: number;
};

const takeoverAllocationDetails = (
  row: PayTaskCompletionDailyBreakdownRow,
): TakeoverAllocationDetails | null => {
  const split = row.takeoverSplit;
  const role = row.takeoverAllocationRole;
  if (!split || (role !== 'shift_taker' && role !== 'task_owner')) {
    return null;
  }

  const fullDayBaseAmount = Number(split.fullDayBaseAmount);
  const fullDayPayableAmount = Number(split.fullDayPayableAmount);
  if (!Number.isFinite(fullDayBaseAmount) || !Number.isFinite(fullDayPayableAmount)) {
    return null;
  }

  const isShiftTaker = role === 'shift_taker';
  const percent = isShiftTaker
    ? Number(split.shiftTakerPercent)
    : Number(split.taskOwnerPercent);
  if (!Number.isFinite(percent)) {
    return null;
  }

  const counterpartName = (
    isShiftTaker ? split.taskOwnerName : split.shiftTakerName
  )?.trim();
  const counterpartUserId = isShiftTaker
    ? Number(split.taskOwnerUserId)
    : Number(split.shiftTakerUserId);
  const counterpartLabel = counterpartName
    || (Number.isInteger(counterpartUserId) && counterpartUserId > 0
      ? `Staff #${counterpartUserId}`
      : 'the other staff member');
  const taskOwnerName = split.taskOwnerName?.trim();
  const taskOwnerUserId = Number(split.taskOwnerUserId);
  const taskOwnerLabel = taskOwnerName
    || (Number.isInteger(taskOwnerUserId) && taskOwnerUserId > 0
      ? `Staff #${taskOwnerUserId}`
      : 'the task-plan owner');

  return {
    label: `${formatPercent(percent)} ${isShiftTaker ? 'shift-takeover' : 'task-plan'} share \u00b7 shared with ${counterpartLabel}`,
    color: isShiftTaker ? 'blue.8' : 'violet.8',
    taskOwnerLabel,
    fullDayBaseAmount,
    fullDayPayableAmount,
  };
};

const TaskCompletionDailyBreakdown = ({
  rows,
  formatAmount,
  salaryRecipientUserId,
}: TaskCompletionDailyBreakdownProps) => {
  const [opened, setOpened] = useState(false);
  const detailsId = useId();
  const validRows = Array.isArray(rows) ? rows.filter((row) => row && row.date) : [];

  if (validRows.length === 0) {
    return null;
  }

  const totalDeduction = validRows.reduce(
    (sum, row) => sum + Math.max(Number(row.deductionAmount) || 0, 0),
    0,
  );
  const uniqueDayCount = new Set(validRows.map((row) => row.date)).size;
  const calculationCountLabel = uniqueDayCount < validRows.length
    ? `${uniqueDayCount} ${uniqueDayCount === 1 ? 'day' : 'days'} \u00b7 ${validRows.length} ${validRows.length === 1 ? 'allocation' : 'allocations'}`
    : `${uniqueDayCount} ${uniqueDayCount === 1 ? 'day' : 'days'}`;

  return (
    <Stack gap={4} w="100%" align="center">
      <Group gap={6} justify="center" wrap="nowrap">
        <Text size="xs" fw={600} c={totalDeduction > 0 ? 'red.7' : 'dimmed'}>
          Daily task calculation ({calculationCountLabel})
          {' \u00b7 '}
          {totalDeduction > 0 ? `-${formatAmount(totalDeduction)}` : 'No deduction'}
        </Text>
        <ActionIcon
          type="button"
          size="xs"
          radius="xl"
          variant="light"
          color={totalDeduction > 0 ? 'red' : 'blue'}
          onClick={() => setOpened((current) => !current)}
          aria-label={opened ? 'Hide daily task calculation' : 'Show daily task calculation'}
          aria-expanded={opened}
          aria-controls={detailsId}
        >
          {opened ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        </ActionIcon>
      </Group>

      <Collapse in={opened} id={detailsId} style={{ width: '100%' }}>
        <ScrollArea type="auto" offsetScrollbars>
          <Table
            striped
            withTableBorder
            withColumnBorders
            verticalSpacing="xs"
            horizontalSpacing="xs"
            miw={720}
            aria-label="Assistant Manager Salary daily task completion calculation"
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Day</Table.Th>
                <Table.Th ta="right">Base amount</Table.Th>
                <Table.Th ta="right">Completed</Table.Th>
                <Table.Th ta="right">Missing</Table.Th>
                <Table.Th ta="right">Deduction</Table.Th>
                <Table.Th ta="right">Payable</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {validRows.map((row, index) => {
                const deduction = Math.max(Number(row.deductionAmount) || 0, 0);
                const countLabel = completionCountLabel(row);
                const alternateTaskOwner = isAlternateTaskOwner(row, salaryRecipientUserId);
                const taskOwnerName = row.taskOwnerName?.trim();
                const attributionWarning = row.attributionWarning?.trim();
                const takeoverAllocation = takeoverAllocationDetails(row);
                return (
                  <Table.Tr key={`${row.date}-${index}`}>
                    <Table.Td>
                      <Text size="xs" fw={600}>{formatDay(row.date)}</Text>
                      {takeoverAllocation && (
                        <>
                          <Text size="xs" fw={700} c={takeoverAllocation.color}>
                            {takeoverAllocation.label}
                          </Text>
                          <Text size="xs" fw={600} c="dimmed">
                            Tasks: {takeoverAllocation.taskOwnerLabel}
                          </Text>
                          <Text size="xs" c="dimmed">
                            Full day: {formatAmount(takeoverAllocation.fullDayBaseAmount)} base
                            {' \u00b7 '}
                            {formatAmount(takeoverAllocation.fullDayPayableAmount)} payable after tasks
                          </Text>
                        </>
                      )}
                      {!takeoverAllocation && alternateTaskOwner && taskOwnerName && (
                        <Text size="xs" fw={600} c="blue.8">
                          Task plan: {taskOwnerName} · shift takeover
                        </Text>
                      )}
                      {attributionWarning && (
                        <Text size="xs" fw={600} c="orange.8">
                          {attributionWarning}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{formatAmount(Number(row.baseAmount) || 0)}</Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" fw={700} c="teal.7">{formatPercent(row.completedPercent)}</Text>
                      {countLabel && <Text size="xs" c="dimmed">{countLabel}</Text>}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" fw={700} c={(Number(row.missingPercent) || 0) > 0 ? 'orange.8' : 'dimmed'}>
                        {formatPercent(row.missingPercent)}
                      </Text>
                      {row.incompleteTasks != null && (
                        <Text size="xs" c="dimmed">{row.incompleteTasks} incomplete</Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" fw={700} c={deduction > 0 ? 'red.7' : 'dimmed'}>
                        {deduction > 0 ? `-${formatAmount(deduction)}` : formatAmount(0)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" fw={800} c="teal.8">
                        {formatAmount(Number(row.payableAmount) || 0)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Collapse>
    </Stack>
  );
};

export default TaskCompletionDailyBreakdown;
