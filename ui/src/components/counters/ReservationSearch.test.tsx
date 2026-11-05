import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReservationSearch from './ReservationSearch';

const Search = ({ initialValue = '41001', disabled = false, onScan = jest.fn() }) => {
  const [value, setValue] = useState(initialValue);
  return <ReservationSearch value={value} onChange={setValue} onScan={onScan} disabled={disabled} />;
};

it('clears a scanned search and returns focus so staff can type the next customer', () => {
  render(<Search />);
  const input = screen.getByRole('textbox', { name: 'Search reservations' });
  fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  userEvent.type(input, 'next customer');
  expect(input).toHaveValue('next customer');
});

it('keeps Clear available for focusing an empty search without opening the scanner', () => {
  const onScan = jest.fn();
  render(<Search initialValue="" onScan={onScan} />);
  fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
  expect(screen.getByRole('textbox', { name: 'Search reservations' })).toHaveFocus();
  expect(onScan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Scan booking barcode' }));
  expect(onScan).toHaveBeenCalledTimes(1);
});

it('disables the search and its actions while reservations are busy', () => {
  const onScan = jest.fn();
  render(<Search disabled onScan={onScan} />);
  expect(screen.getByRole('textbox', { name: 'Search reservations' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'CLEAR' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Scan booking barcode' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan booking barcode' }));
  expect(screen.getByRole('textbox', { name: 'Search reservations' })).toHaveValue('41001');
  expect(onScan).not.toHaveBeenCalled();
});
