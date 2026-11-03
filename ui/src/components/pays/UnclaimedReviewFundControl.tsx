import React, { useState } from 'react';
import { Alert, Button, Card, Group, Stack, Text, Textarea } from '@mantine/core';
import { IconArrowRight, IconPigMoney } from '@tabler/icons-react';
import axiosInstance from '../../utils/axiosInstance';
import type { Pay, PaySettlementSource } from '../../types/pays/Pay';

export const unclaimedVolunteerReviewSources = (staff: Pay): PaySettlementSource[] => {
  if (staff.settlementReconciliationRequired) return [];
  const sources = staff.settlementSources ?? [];
  const eligible = sources.filter(source => source.sourceKey === 'compensation_component'
    && source.category === 'review' && source.componentId !== null && source.staffType === 'volunteer'
    && source.destination === 'staff_vendor' && Boolean(source.segmentKey) && Boolean(source.settlementIntent)
    && !source.routeChanged && source.amount > 0 && source.settledAmount === 0 && source.allocatedAmount === 0
    && Math.round(source.amount * 100) === Math.round(source.outstandingAmount * 100));
  return eligible.filter(source => sources.filter(candidate => candidate.sourceKey === 'compensation_component'
    && candidate.componentId === source.componentId).every(candidate => eligible.includes(candidate)));
};

type Props = {
  staff: Pay;
  rangeStart: string;
  rangeEnd: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onRouted: (componentIds: number[]) => Promise<void>;
};

export default function UnclaimedReviewFundControl({ staff, rangeStart, rangeEnd, disabled, onBusyChange, onRouted }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = unclaimedVolunteerReviewSources(staff);
  if (!sources.length) return null;
  const currency = sources[0].currency;
  const amount = sources.reduce((sum, source) => sum + Math.round(source.outstandingAmount * 100), 0) / 100;
  const formattedAmount = new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
  const submit = async () => {
    if (busy || disabled || !reason.trim()) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await axiosInstance.post('/reports/staffPayouts/routeUnclaimedReviews', {
        staffUserId: staff.userId, rangeStart, rangeEnd, reason: reason.trim(),
        settlementIntents: sources.map(source => source.settlementIntent),
      }, { withCredentials: true });
      await onRouted([...new Set(sources.map(source => source.componentId as number))]);
    } catch (caught) {
      const data = (caught as { response?: { data?: Array<{ message?: string }> } })?.response?.data;
      setError(data?.[0]?.message ?? 'Unable to update review pay. Refresh Staff Payments and try again.');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Group gap="xs"><IconPigMoney size={21} /><Text fw={700}>Unclaimed review pay</Text></Group>
        <Text size="sm">{formattedAmount} in unpaid volunteer review earnings can go to the Volunteer Fund.</Text>
        {!expanded ? (
          <Button variant="light" leftSection={<IconArrowRight size={16} />} disabled={disabled}
            onClick={() => setExpanded(true)}>Send unpaid reviews to Volunteer Fund</Button>
        ) : (
          <>
            <Alert color="blue">This saves the destination for this person and month. The review lines will move into
              Allocate to Volunteer Fund. Complete the allocation with Process compensation.</Alert>
            <Textarea label="Reason" required maxLength={2000} minRows={2} value={reason}
              disabled={busy} placeholder="For example: volunteer departed and left the review pay unclaimed"
              onChange={event => setReason(event.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="subtle" disabled={busy} onClick={() => { setExpanded(false); setError(null); }}>Cancel</Button>
              <Button onClick={submit} loading={busy} disabled={disabled || !reason.trim()}>Move reviews to fund</Button>
            </Group>
          </>
        )}
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Card>
  );
}
