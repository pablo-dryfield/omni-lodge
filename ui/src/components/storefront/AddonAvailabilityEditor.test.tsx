import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddonStorefrontRulesEditor } from './StorefrontRulesEditors';
import type { StorefrontAddonConfig } from '../../types/productAddons/ProductAddon';

function Editor() {
  const [value, setValue] = useState<StorefrontAddonConfig>({ selectionMode: 'quantity', quantityPrices: { '2': 30 } });
  return <MantineProvider><AddonStorefrontRulesEditor value={value} onChange={setValue} />
    <output data-testid="config">{JSON.stringify(value)}</output></MantineProvider>;
}
const config = () => JSON.parse(screen.getByTestId('config').textContent || '{}');
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = jest.fn();
});
it('switches weekday availability without losing selection pricing or the unavailable message', () => {
  render(<Editor />);
  fireEvent.click(screen.getByLabelText('Availability', { selector: 'input' }));
  fireEvent.click(screen.getByRole('option', { name: 'Available on selected weekdays' }));
  expect(config().availability.daysOfWeek).toEqual([1, 2, 3, 4, 5, 6, 7]);
  fireEvent.change(screen.getByLabelText('Unavailable message'), { target: { value: 'Weekend tours only.' } });
  fireEvent.click(screen.getByLabelText('Availability', { selector: 'input' }));
  fireEvent.click(screen.getByRole('option', { name: 'Unavailable' }));
  expect(config()).toMatchObject({ selectionMode: 'quantity', quantityPrices: { '2': 30 },
    availability: { enabled: false, unavailableMessage: 'Weekend tours only.' } });
  fireEvent.click(screen.getByLabelText('Availability', { selector: 'input' }));
  fireEvent.click(screen.getByRole('option', { name: 'Available every day' }));
  expect(config().availability).toEqual({ enabled: true, unavailableMessage: 'Weekend tours only.' });
  expect(screen.queryByText('Available experience weekdays')).not.toBeInTheDocument();
});
