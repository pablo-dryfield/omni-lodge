import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PartnerCommissionFields } from './PartnerCommissionFields';
import { partnerCommissionLabel, type PartnerAgreement } from '../../api/partners';

const base: PartnerAgreement = { productIds: [28, 44], commissionPercent: 20, paymentModes: ['platform'], creditLimit: 0,
  connectSplit: false, allowCancellation: true, allowAmendment: true, allowRefunds: true, cancellationHours: 24, allowedOrigins: [] };
const products = [{ id: 28, name: 'Pub Crawl' }, { id: 44, name: 'Food Tour' }];
function Harness() {
  const [agreement, setAgreement] = useState(base);
  return <MantineProvider><PartnerCommissionFields agreement={agreement} onChange={setAgreement} products={products} />
    <output aria-label="Commission agreement">{JSON.stringify(agreement)}</output></MantineProvider>;
}
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
const current = () => JSON.parse(screen.getByLabelText('Commission agreement').textContent || '{}') as PartnerAgreement;
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('textbox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it('shows existing percentage agreements and explains the counting units and refund behavior', () => {
  render(<Harness />);
  expect(screen.getByRole('textbox', { name: 'Default commission type' })).toHaveValue('Percentage');
  expect(screen.getByRole('textbox', { name: 'Default commission basis' })).toHaveValue('Per booking');
  expect(screen.getByText(/4 guests on 2 different experiences/)).toBeInTheDocument();
  expect(screen.getByText(/Fixed commissions stay payable after amount-only refunds/)).toBeInTheDocument();
});
it('supports a fixed amount per guest place', async () => {
  render(<Harness />);
  await choose('Default commission type', 'Fixed amount');
  await choose('Default commission basis', 'Per guest place');
  fireEvent.change(screen.getByLabelText('Default commission rate (PLN)'), { target: { value: '10' } });
  await waitFor(() => expect(current().commissionRule).toEqual({ type: 'fixed', basis: 'person', value: 10 }));
  expect(current().commissionPercent).toBe(0);
});
it('adds and removes scoped product overrides while preserving the default rule', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Add product rule' }));
  expect(current().productCommissions?.[0]).toEqual({ productId: 28, rule: { type: 'percentage', basis: 'booking', value: 20 } });
  await choose('Pub Crawl basis', 'Per experience');
  expect(current().productCommissions?.[0].rule.basis).toBe('experience');
  fireEvent.click(screen.getByRole('button', { name: 'Remove commission override for Pub Crawl' }));
  expect(current().productCommissions).toEqual([]);
  expect(partnerCommissionLabel(current())).toBe('20% per booking');
});
it('labels fixed rates and override counts without displaying a false percentage', () => {
  expect(partnerCommissionLabel({ ...base, commissionRule: { type: 'fixed', basis: 'experience', value: 15 },
    productCommissions: [{ productId: 28, rule: { type: 'fixed', basis: 'person', value: 10 } }] })).toMatch(/15\.00 per experience.*1 product/);
});
