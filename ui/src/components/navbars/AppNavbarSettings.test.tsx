import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../store/hooks';
import { AppNavbarSettings } from './AppNavbarSettings';

jest.mock('../../store/hooks', () => ({ useAppSelector: jest.fn() }));

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: false, addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(),
    })),
  });
});

const Location = () => <span data-testid="location">{useLocation().pathname}</span>;
const renderNavbar = (pages: string[]) => {
  (useAppSelector as jest.Mock).mockImplementation((selector) => selector({ accessControl: { pages, modules: {} } }));
  const onNavigate = jest.fn();
  render(<MemoryRouter initialEntries={['/settings']}><MantineProvider><AppNavbarSettings onNavigate={onNavigate} /><Location /></MantineProvider></MemoryRouter>);
  return { onNavigate };
};

it('links to Review Platforms under Integrations for permitted accounts', () => {
  const { onNavigate } = renderNavbar(['settings', 'settings-review-platforms']);
  expect(screen.getByText('Integrations')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Review Platforms'));
  expect(screen.getByTestId('location')).toHaveTextContent('/settings/review-platforms');
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it('does not expose the settings link without page permission', () => {
  renderNavbar(['settings']);
  expect(screen.queryByText('Review Platforms')).not.toBeInTheDocument();
});
