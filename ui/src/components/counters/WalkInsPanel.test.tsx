import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WalkInsPanel, { type WalkInChannelState, walkInEntryTotal } from './WalkInsPanel';
import type { ChannelConfig } from '../../types/counters/CounterRegistry';

const channels: ChannelConfig[] = [
  { id: 5, name: 'Walk-In', sortOrder: 1, paymentMethodId: 4, paymentMethodName: 'Cash', cashPrice: 110, cashPaymentEligible: true, walkInTicketPrices: [{ ticketType: 'normal', currencyCode: 'PLN', price: 110 }] },
  { id: 8, name: 'Hostel Atlantis', sortOrder: 2, paymentMethodId: 4, paymentMethodName: 'Cash', cashPrice: 80, cashPaymentEligible: true, walkInTicketPrices: [{ ticketType: 'normal', currencyCode: 'PLN', price: 80 }] },
];
const observed = jest.fn();
function Harness({ initial = {}, channelConfig = channels, initialFreePeople = {}, disabled = false }: { initial?: Record<number, WalkInChannelState>; channelConfig?: ChannelConfig[]; initialFreePeople?: Record<number, { qty: number; note: string }>; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  const [freePeople, setFreePeople] = useState(initialFreePeople);
  const [freeAddons, setFreeAddons] = useState({});
  return <WalkInsPanel channels={channelConfig} value={value} types={[{ id: 'normal', name: 'Normal', enabled: true }]} addons={[{ addonId: 1, name: 'Cocktails', key: 'cocktails', maxPerAttendee: 1, sortOrder: 0 }]} paymentMethods={[{ id: 4, name: 'Cash' }, { id: 2, name: 'Bank Transfer' }]} freePeople={freePeople} freeAddons={freeAddons} disabled={disabled} getAddonPrice={() => 25}
    onChange={(id, next) => { observed(next); setValue((prev) => ({ ...prev, [id]: next })); }}
    onFreeChange={(id, people, addons) => { setFreePeople((prev) => { const next = { ...prev }; if (people) next[id] = people; else delete next[id]; return next; }); setFreeAddons((prev) => ({ ...prev, [id]: addons })); }} />;
}
beforeEach(() => {
  observed.mockClear(); let sequence = 0;
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => `test-${++sequence}` } });
});

function chooseTicket(name: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${name}\\b`) }));
}
function addTicket(name = 'Normal') {
  chooseTicket(name);
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
}
async function chooseOtherChannel(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /^Others/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${name} \\(`) }));
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Other arrival channels' })).not.toBeInTheDocument());
}

it('uses each channel price and keeps entries when switching channels', async () => {
  render(<Harness />);
  addTicket();
  await chooseOtherChannel('Hostel Atlantis');
  addTicket();
  expect(observed.mock.calls.at(-1)![0].tickets['entry:test-2'].currencies.PLN.cash).toBe('80');
  fireEvent.click(screen.getByRole('button', { name: /Walk-In/ }));
  expect(screen.getByRole('spinbutton', { name: 'Normal guests (PLN)' })).toHaveValue(1);
});
it('keeps only Walk-In and Others visible and lists other channels with zero counts', async () => {
  render(<Harness channelConfig={[...channels, { ...channels[1], id: 9, name: 'TopDeck' }]} />);
  const navigation = within(screen.getByRole('group', { name: 'Arrival channel' }));
  expect(navigation.getAllByRole('button')).toHaveLength(2);
  expect(navigation.getByRole('button', { name: 'Walk-In' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('Hostel Atlantis')).not.toBeInTheDocument();
  expect(screen.queryByText('TopDeck')).not.toBeInTheDocument();
  fireEvent.click(navigation.getByRole('button', { name: 'Others' }));
  const menu = within(screen.getByRole('menu', { name: 'Other arrival channels' }));
  expect(menu.getAllByRole('menuitemradio')).toHaveLength(2);
  expect(menu.getByRole('menuitemradio', { name: 'Hostel Atlantis (0)' })).toBeInTheDocument();
  expect(menu.getByRole('menuitemradio', { name: 'TopDeck (0)' })).toBeInTheDocument();
  expect(menu.queryByText('Walk-In')).not.toBeInTheDocument();
  fireEvent.click(menu.getByRole('menuitemradio', { name: 'TopDeck (0)' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  expect(navigation.getByRole('button', { name: /Others.*TopDeck/ })).toHaveAttribute('aria-pressed', 'true');
  expect(observed).not.toHaveBeenCalled();
});
it('sums only other-channel guests across currencies and free entries, excluding add-ons', async () => {
  const saved = (people: number): WalkInChannelState => ({ ticketOrder: ['entry:saved'], tickets: { 'entry:saved': {
    name: 'Normal', ticketType: 'normal', paymentMethodId: 4, currencyOrder: ['PLN'], currencies: { PLN: { people, cash: String(people * 80), unitPrice: 80, addons: { 1: 2 } } },
  } } });
  const topDeck = saved(2);
  topDeck.tickets['entry:saved'].currencyOrder.push('EUR');
  topDeck.tickets['entry:saved'].currencies.EUR = { people: 1, cash: '25', unitPrice: 25, addons: {} };
  render(<Harness channelConfig={[...channels, { ...channels[1], id: 9, name: 'TopDeck' }]} initial={{ 5: saved(4), 8: saved(2), 9: topDeck }} initialFreePeople={{ 9: { qty: 1, note: 'Guest list' } }} />);
  expect(screen.getByRole('button', { name: 'Walk-In (4)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Others (6)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Others (6)' }));
  expect(screen.getByRole('menuitemradio', { name: 'Hostel Atlantis (2)' })).toBeInTheDocument();
  expect(screen.getByRole('menuitemradio', { name: 'TopDeck (4)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hostel Atlantis (2)' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Increase Normal guests (PLN)' }));
  expect(screen.getByRole('button', { name: /^Others \(7\)/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Others/ }));
  expect(screen.getByRole('menuitemradio', { name: 'Hostel Atlantis (3)' })).toHaveAttribute('aria-checked', 'true');
});
it('handles a single channel, no Walk-In channel, and disabled controls', () => {
  const { rerender } = render(<Harness channelConfig={[channels[0]]} />);
  expect(screen.queryByRole('button', { name: /^Others/ })).not.toBeInTheDocument();
  rerender(<Harness channelConfig={[channels[1]]} />);
  expect(screen.queryByRole('button', { name: /^Walk-In/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Others.*Hostel Atlantis/ })).toHaveAttribute('aria-pressed', 'true');
  rerender(<Harness disabled />);
  expect(screen.getByRole('button', { name: /^Walk-In/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^Others/ })).toBeDisabled();
});
it('selects a ticket without adding guests until Add is pressed', () => {
  render(<Harness />);
  chooseTicket('Custom amount');
  expect(observed).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'Custom ticket name' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(screen.getByRole('textbox', { name: 'Custom ticket name' })).toHaveValue('Custom');
});
it('offers custom and free tickets when the selected currency has no configured prices', () => {
  render(<Harness />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Currency/ }));
  fireEvent.click(screen.getByRole('option', { name: 'EUR' }));
  expect(screen.getByText(/No EUR prices configured/)).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  expect(screen.queryByRole('option', { name: /^Normal/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /^Custom amount/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(observed.mock.calls.at(-1)![0].tickets['entry:test-1'].currencyOrder).toEqual(['EUR']);
});
it.each(['PLN', 'EUR'])('labels zero-priced tickets as Free in the %s selector', currency => {
  render(<Harness channelConfig={[{ ...channels[0], walkInTicketPrices: [
    { ticketType: 'normal', currencyCode: 'PLN', price: 0 },
    { ticketType: 'normal', currencyCode: 'EUR', price: 0 },
  ] }]} />);
  if (currency === 'EUR') {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Currency/ }));
    fireEvent.click(screen.getByRole('option', { name: 'EUR' }));
  }
  expect(within(screen.getByRole('combobox', { name: /^Ticket type/ })).getByText('Free')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  expect(screen.getByRole('option', { name: 'Normal Free' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Free guest Free' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Custom amount Custom' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /0\.00/ })).not.toBeInTheDocument();
});
it('adds another free guest to the existing free entry while keeping its reason', () => {
  render(<Harness />);
  addTicket('Free guest');
  fireEvent.change(screen.getByRole('textbox', { name: /Reason for free entry/ }), { target: { value: 'Approved guest list' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(screen.getAllByRole('spinbutton', { name: 'Free guests' })).toHaveLength(1);
  expect(screen.getByRole('spinbutton', { name: 'Free guests' })).toHaveValue(2);
  expect(screen.getByRole('textbox', { name: /Reason for free entry/ })).toHaveValue('Approved guest list');
});
it('defaults transfer to awaiting payment, then allows marking it received', () => {
  render(<Harness />); addTicket();
  fireEvent.click(screen.getByRole('button', { name: 'Payment for Normal: Cash, received' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Payment method/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Bank Transfer' }));
  expect(observed.mock.calls.at(-1)![0].tickets['entry:test-1'].paymentStatus).toBe('awaiting');
  expect(screen.getByText('Awaiting payment: PLN 110.00')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Payment status/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Payment received' }));
  expect(observed.mock.calls.at(-1)![0].tickets['entry:test-1'].paymentStatus).toBe('received');
});
it('keeps payment and add-on editors closed until requested without changing the entry', () => {
  render(<Harness />); addTicket();
  expect(screen.queryByRole('combobox', { name: /^Payment method/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: 'Normal Cocktails (PLN)' })).not.toBeInTheDocument();
  observed.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Payment for Normal: Cash, received' }));
  expect(screen.getByRole('combobox', { name: /^Payment method/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add-ons' }));
  expect(screen.getByRole('spinbutton', { name: 'Normal Cocktails (PLN)' })).toBeInTheDocument();
  expect(observed).not.toHaveBeenCalled();
});
it('keeps saved awaiting payments and selected add-ons visible while their editors are closed', async () => {
  render(<Harness initial={{ 5: { ticketOrder: ['entry:saved'], tickets: { 'entry:saved': {
    name: 'Normal', ticketType: 'normal', paymentMethodId: 2, paymentMethodName: 'Bank Transfer', paymentStatus: 'awaiting',
    currencyOrder: ['PLN'], currencies: { PLN: { people: 2, cash: '245', addons: { 1: 1 }, unitPrice: 110, addonUnitPrices: { 1: 25 } } },
  } } } }} />);
  expect(screen.getByRole('button', { name: 'Payment for Normal: Bank Transfer, awaiting payment' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Add-ons (1)' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Awaiting payment: PLN 245.00')).toBeInTheDocument();
  await chooseOtherChannel('Hostel Atlantis');
  expect(screen.getByText('Awaiting payment: PLN 245.00')).toBeInTheDocument();
  expect(observed).not.toHaveBeenCalled();
});
it('prevents duplicate type/currency entries and allows adding again after confirmed removal', async () => {
  render(<Harness />);
  addTicket();
  expect(screen.getByRole('button', { name: 'Add ticket' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(observed).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('spinbutton', { name: 'Normal guests (PLN)' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Normal' }));
  expect(observed).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove entry' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Add ticket' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(screen.getAllByRole('spinbutton', { name: 'Normal guests (PLN)' })).toHaveLength(1);
});
it('allows the same type in another currency and blocks the original currency', () => {
  render(<Harness channelConfig={[{ ...channels[0], walkInTicketPrices: [...channels[0].walkInTicketPrices, { ticketType: 'normal', currencyCode: 'EUR', price: 25 }] }]} />);
  addTicket();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Currency/ }));
  fireEvent.click(screen.getByRole('option', { name: 'EUR' }));
  expect(screen.getByRole('button', { name: 'Add ticket' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(screen.getByRole('spinbutton', { name: 'Normal guests (EUR)' })).toHaveValue(1);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Currency/ }));
  fireEvent.click(screen.getByRole('option', { name: 'PLN' }));
  expect(screen.getByRole('button', { name: 'Add ticket' })).toBeDisabled();
});
it('creates distinct custom names and shows duplicate or empty names inline', () => {
  render(<Harness />);
  addTicket('Custom amount');
  fireEvent.change(screen.getByRole('textbox', { name: 'Custom ticket name' }), { target: { value: 'Birthday group' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  const names = screen.getAllByRole('textbox', { name: 'Custom ticket name' });
  expect(names.map(input => (input as HTMLInputElement).value)).toEqual(['Birthday group', 'Custom', 'Custom 2']);
  fireEvent.change(names[1], { target: { value: ' birthday   GROUP ' } });
  expect(names[0]).toHaveAttribute('aria-invalid', 'true');
  expect(names[1]).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(names[1], { target: { value: 'Private group' } });
  expect(names[0]).toHaveAttribute('aria-invalid', 'false');
  expect(names[1]).toHaveAttribute('aria-invalid', 'false');
  fireEvent.change(names[1], { target: { value: '   ' } });
  expect(screen.getByText('Enter a name for this custom ticket.')).toBeInTheDocument();
});
it('keeps quantity and payment edits inside the selected ticket', () => {
  const entry = { paymentMethodId: 4, paymentMethodName: 'Cash', paymentStatus: 'received' as const, currencyOrder: ['PLN' as const], currencies: { PLN: { people: 1, cash: '110', unitPrice: 110, addons: {} } } };
  render(<Harness initial={{ 5: { ticketOrder: ['entry:one', 'entry:two'], tickets: {
    'entry:one': { ...entry, name: 'Normal', ticketType: 'normal' },
    'entry:two': { ...entry, name: 'Group', ticketType: 'group' },
  } } }} />);
  const ticket = within(screen.getByRole('group', { name: 'Group ticket' }));
  fireEvent.click(ticket.getByRole('button', { name: 'Increase Group guests (PLN)' }));
  fireEvent.click(ticket.getByRole('button', { name: 'Payment for Group: Cash, received' }));
  fireEvent.mouseDown(ticket.getByRole('combobox', { name: /^Payment method/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Bank Transfer' }));
  const saved = observed.mock.calls.at(-1)![0].tickets;
  expect(saved['entry:one']).toMatchObject({ paymentMethodName: 'Cash', paymentStatus: 'received', currencies: { PLN: { people: 1, cash: '110' } } });
  expect(saved['entry:two']).toMatchObject({ paymentMethodName: 'Bank Transfer', paymentStatus: 'awaiting', currencies: { PLN: { people: 2, cash: '220' } } });
});
it('keeps legacy multi-currency amounts separate within one ticket', () => {
  render(<Harness initial={{ 5: { ticketOrder: ['Normal'], tickets: { Normal: {
    name: 'Normal', ticketType: 'normal', currencyOrder: ['PLN', 'EUR'], currencies: {
      PLN: { people: 1, cash: '110', unitPrice: 110, addons: {} },
      EUR: { people: 1, cash: '25', unitPrice: 25, addons: {} },
    },
  } } } }} />);
  const ticket = within(screen.getByRole('group', { name: 'Normal ticket' }));
  expect(ticket.getAllByRole('button', { name: 'Remove Normal' })).toHaveLength(1);
  fireEvent.click(ticket.getByRole('button', { name: 'Increase Normal guests (PLN)' }));
  expect(observed.mock.calls.at(-1)![0].tickets.Normal.currencies).toMatchObject({
    PLN: { people: 2, cash: '220' }, EUR: { people: 1, cash: '25' },
  });
});
it('prices add-ons without adding another attendee and caps cocktails to guest count', () => {
  render(<Harness />); addTicket();
  fireEvent.click(screen.getByRole('button', { name: 'Add-ons' }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase Normal Cocktails (PLN)' }));
  const row = observed.mock.calls.at(-1)![0].tickets['entry:test-1'].currencies.PLN;
  expect(row).toMatchObject({ people: 1, cash: '135', addons: { 1: 1 } });
  expect(screen.getByRole('button', { name: 'Increase Normal Cocktails (PLN)' })).toBeDisabled();
});
it('supports custom decimals and free reasons', () => {
  render(<Harness />); addTicket('Custom amount');
  fireEvent.change(screen.getByRole('textbox', { name: 'Total amount (PLN)' }), { target: { value: '125.50' } });
  expect(observed.mock.calls.at(-1)![0].tickets['entry:test-1'].currencies.PLN.cash).toBe('125.50');
  addTicket('Free guest');
  expect(screen.getByRole('textbox', { name: /Reason for free entry/ })).toBeRequired();
});
it('reveals free add-on quantities and their required reasons only when needed', () => {
  render(<Harness />); addTicket('Free guest');
  expect(screen.getByRole('textbox', { name: /Reason for free entry/ })).toBeRequired();
  expect(screen.queryByRole('spinbutton', { name: 'Free Cocktails' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Free add-ons' }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase Free Cocktails' }));
  expect(screen.getByRole('textbox', { name: /Reason for free Cocktails/ })).toBeRequired();
  expect(screen.getByRole('button', { name: 'Free add-ons (1)' })).toBeInTheDocument();
});
it('keeps historical amounts on load even when the price has changed', () => {
  render(<Harness initial={{ 5: { ticketOrder: ['Normal'], tickets: { Normal: { name: 'Normal', currencyOrder: ['PLN'], currencies: { PLN: { people: 2, cash: '161.45', addons: {} } } } } } }} />);
  expect(screen.getByText('PLN 161.45')).toBeInTheDocument();
  expect(observed).not.toHaveBeenCalled();
});
it('calculates totals from saved unit prices', () => {
  expect(walkInEntryTotal({ people: 3, cash: '', unitPrice: 100, addons: { 1: 2 }, addonUnitPrices: { 1: 25 } })).toBe(350);
});
