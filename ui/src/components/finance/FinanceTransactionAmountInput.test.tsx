import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinanceTransactionAmountInput from './FinanceTransactionAmountInput';

function Harness({ initial = 0, autoFocus = false }: { initial?: number; autoFocus?: boolean }) {
  const [minor, setMinor] = useState(initial);
  return <MantineProvider>
    <FinanceTransactionAmountInput valueMinor={minor} onChangeMinor={setMinor} currency="PLN" autoFocus={autoFocus} />
    <output data-testid="minor">{minor}</output><button>Done</button>
    <button onClick={() => setMinor(7050)}>Restore draft</button>
  </MantineProvider>;
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  Object.defineProperty(global, 'ResizeObserver', { writable: true, value: jest.fn(() => ({
    observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn(),
  })) });
});

it('appends whole digits to an existing whole amount without padding decimals during typing', async () => {
  render(<Harness initial={1200} />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' }) as HTMLInputElement;
  await userEvent.click(input);
  input.setSelectionRange(input.value.length, input.value.length);
  await userEvent.type(input, '3', { skipClick: true });
  expect(input).toHaveValue('123');
  expect(screen.getByTestId('minor').textContent).toBe('12300');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue('123.00');
});

it.each(['12.30', '12,30'])('accepts decimal entry %s and preserves exact cents', async value => {
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' });
  await userEvent.type(input, value);
  expect(screen.getByTestId('minor').textContent).toBe('1230');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue('12.30');
});

it('supports clearing and replacing a value and restores external draft changes', async () => {
  render(<Harness initial={1234} />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' });
  await userEvent.clear(input);
  expect(screen.getByTestId('minor').textContent).toBe('0');
  await userEvent.type(input, '5.75');
  expect(screen.getByTestId('minor').textContent).toBe('575');
  fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
  expect(input).toHaveValue('70.5');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue('70.50');
});

it('accepts whole-number typing with the caret at the end of the initial zero amount', async () => {
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' }) as HTMLInputElement;
  await userEvent.click(input);
  input.setSelectionRange(input.value.length, input.value.length);
  await userEvent.type(input, '123', { skipClick: true });
  expect(screen.getByTestId('minor').textContent).toBe('12300');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue('123.00');
});

it('accepts cent-only amounts, limits precision to cents, and offers a decimal keyboard', async () => {
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' });
  expect(input).toHaveAttribute('inputmode', 'decimal');
  await userEvent.type(input, '.50');
  expect(screen.getByTestId('minor').textContent).toBe('50');
  await userEvent.clear(input);
  await userEvent.type(input, '1.239');
  expect(screen.getByTestId('minor').textContent).toBe('123');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue('1.23');
});

it.each([
  ['120.45', '120.45', '12045'],
  ['120,45', '120.45', '12045'],
  ['1,234.56', '1234.56', '123456'],
  ['1.234,56', '1234.56', '123456'],
])('accepts pasted amount %s and stores exact minor units', async (value, display, minor) => {
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' });
  await userEvent.click(input);
  const paste = createEvent.paste(input, { clipboardData: { getData: () => value } });
  fireEvent(input, paste);
  // Native insertion happens only when the paste handler does not prevent it.
  if (!paste.defaultPrevented) fireEvent.input(input, { target: { value }, inputType: 'insertFromPaste' });
  expect(screen.getByTestId('minor').textContent).toBe(minor);
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue(display);
});

it('starts an automatically focused new amount ready for keyboard entry', async () => {
  render(<Harness autoFocus />);
  const input = screen.getByRole('textbox', { name: 'Transaction amount' });
  expect(input).toHaveFocus();
  await userEvent.type(input, '45.6', { skipClick: true });
  expect(screen.getByTestId('minor').textContent).toBe('4560');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(input).toHaveValue('45.60');
});
