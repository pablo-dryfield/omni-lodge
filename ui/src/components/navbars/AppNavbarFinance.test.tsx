import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppSelector } from '../../store/hooks';
import { AppNavbarFinance } from './AppNavbarFinance';
jest.mock('../../store/hooks', () => ({ useAppSelector: jest.fn() }));
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({
    matches: false, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) });
});
const renderNavigation = (productTypeIds: number[] | null) => {
  (useAppSelector as jest.Mock).mockImplementation(selector => selector({ accessControl: { productTypeIds } }));
  render(<MemoryRouter initialEntries={['/finance/reports']}><MantineProvider><AppNavbarFinance /></MantineProvider></MemoryRouter>);
};
it('shows reports but hides company-wide bank, ledger and administrative links for a scoped owner', () => {
  renderNavigation([3]);
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/finance/reports');
});
it('preserves all existing finance navigation for company-wide owners', () => {
  renderNavigation(null);
  expect(screen.getAllByRole('link').length).toBeGreaterThan(5);
  expect(screen.getByRole('link', { name: /Accounts/ })).toHaveAttribute('href', '/finance/accounts');
});
