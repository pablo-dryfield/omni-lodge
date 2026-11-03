import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import UnclaimedReviewFundControl, { unclaimedVolunteerReviewSources } from './UnclaimedReviewFundControl';
import type { Pay, PaySettlementSource } from '../../types/pays/Pay';
import axiosInstance from '../../utils/axiosInstance';

jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { post: jest.fn() } }));
const source: PaySettlementSource = { sourceKey: 'compensation_component', label: 'Reviews 1-15',
  category: 'review', componentId: 4, amount: 40, outstandingAmount: 40, currency: 'PLN',
  destination: 'staff_vendor', fundId: null, fundName: null, ruleId: 3, allocatedAmount: 0,
  allocatedFundIds: [], settledAmount: 0, overallocatedAmount: 0, routeChanged: false,
  segmentKey: 'seg_before', staffTypePeriodId: 11, staffType: 'volunteer',
  settlementIntent: 'signed-before' };
const otherSource = { ...source, segmentKey: 'seg_after', amount: 60, outstandingAmount: 60,
  staffTypePeriodId: 12, settlementIntent: 'signed-after' };
const staff: Pay = { userId: 101, firstName: 'Sample Volunteer', totalPayout: 100, totalCommission: 0,
  breakdown: [], settlementSources: [source, otherSource] };

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  Object.defineProperty(global, 'ResizeObserver', { writable: true, value: jest.fn(() => ({
    observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn(),
  })) });
});

it('requires a reason and sends both historical segments together before refreshing the form', async () => {
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: { routed: true } });
  const onRouted = jest.fn(async () => {});
  const onBusyChange = jest.fn();
  render(<MantineProvider><UnclaimedReviewFundControl staff={staff} rangeStart="2026-10-01" rangeEnd="2026-10-31"
    disabled={false} onBusyChange={onBusyChange} onRouted={onRouted} /></MantineProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Send unpaid reviews to Volunteer Fund' }));
  expect(screen.getByRole('button', { name: 'Move reviews to fund' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Volunteer departed; review pay left unclaimed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move reviews to fund' }));
  await waitFor(() => expect(onRouted).toHaveBeenCalledWith([4]));
  expect(axiosInstance.post).toHaveBeenCalledWith('/reports/staffPayouts/routeUnclaimedReviews', {
    staffUserId: 101, rangeStart: '2026-10-01', rangeEnd: '2026-10-31',
    reason: 'Volunteer departed; review pay left unclaimed', settlementIntents: ['signed-before', 'signed-after'],
  }, { withCredentials: true });
  expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([true, false]);
});

it('keeps the form and reason after a server rejection', async () => {
  (axiosInstance.post as jest.Mock).mockRejectedValue({ response: { data: [{ message: 'Review pay was already settled' }] } });
  const onRouted = jest.fn();
  render(<MantineProvider><UnclaimedReviewFundControl staff={staff} rangeStart="2026-10-01" rangeEnd="2026-10-31"
    disabled={false} onBusyChange={jest.fn()} onRouted={onRouted} /></MantineProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Send unpaid reviews to Volunteer Fund' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Departed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move reviews to fund' }));
  expect(await screen.findByText('Review pay was already settled')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /Reason/ })).toHaveValue('Departed');
  expect(onRouted).not.toHaveBeenCalled();
});

it('offers only entirely unpaid volunteer review components, excluding mixed paid histories', () => {
  expect(unclaimedVolunteerReviewSources(staff)).toHaveLength(2);
  const changed = (changes: Partial<PaySettlementSource>) => ({ ...staff,
    settlementSources: [source, { ...otherSource, ...changes }] });
  expect(unclaimedVolunteerReviewSources(changed({ settledAmount: 5, outstandingAmount: 55 }))).toEqual([]);
  expect(unclaimedVolunteerReviewSources(changed({ staffType: 'long_term' }))).toEqual([]);
  expect(unclaimedVolunteerReviewSources(changed({ destination: 'volunteer_fund' }))).toEqual([]);
  expect(unclaimedVolunteerReviewSources({ ...staff, settlementReconciliationRequired: true })).toEqual([]);
  expect(unclaimedVolunteerReviewSources({ ...staff, settlementSources: [{ ...source, category: 'commission' }] })).toEqual([]);
});
