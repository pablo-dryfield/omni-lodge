import { render, screen } from '@testing-library/react';
import WalkInSummaryDetails from './WalkInSummaryDetails';

it('retains staff names while excluding busy-night free visits from the channel count', () => {
  render(<WalkInSummaryDetails rows={[
    { key: 'normal', channelId: 5, channelName: 'Walk-In', ticket: 'Normal', guests: 2, addons: [] },
    { key: 'staff-free', channelId: 5, channelName: 'Walk-In', ticket: 'Staff Free', guests: 3, metricsGuests: 0, amount: 0, addons: [], staff: [{ name: 'Henry Brown', label: 'Attendance exemption' }] },
  ]} />);
  expect(screen.getByText(/Walk-In.*2 guests/)).toBeInTheDocument();
  expect(screen.getByText(/Henry Brown/)).toBeInTheDocument();
  expect(screen.getByText('3 staff excluded from Counter and Venue Numbers totals')).toBeInTheDocument();
});
