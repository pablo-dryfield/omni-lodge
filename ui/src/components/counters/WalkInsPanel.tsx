import type { StaffFreeOverview } from '../../api/staffFreeEntries';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Autocomplete, Box, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Add, DeleteOutline, ExpandLess, ExpandMore, Remove } from '@mui/icons-material';
import type { AddonConfig, ChannelConfig } from '../../types/counters/CounterRegistry';
import type { WalkInTicketDefinition } from '../../api/walkInTickets';
import { getWalkInTicketIdentityErrors, getWalkInTicketType, hasWalkInTicketType, nextCustomTicketName } from '../../utils/walkInTicketValidation';
import StaffFreeEntryPanel, { type StaffFreeEntryHandle, type StaffFreeEntryOptions, type StaffFreeEntryStatus } from './StaffFreeEntryPanel';

export type WalkInCurrency = 'PLN' | 'EUR';
export type WalkInCurrencyEntry = { people: number; cash: string; addons: Record<number, number>; unitPrice?: number; addonUnitPrices?: Record<number, number> };
export type WalkInTicketEntry = {
  staffGuests?: Array<{ userId: number; name: string }>;
  name: string; ticketType?: string; transfer?: boolean;
  paymentMethodId?: number; paymentMethodName?: string; paymentStatus?: 'received' | 'awaiting';
  currencyOrder: WalkInCurrency[]; currencies: Partial<Record<WalkInCurrency, WalkInCurrencyEntry>>;
};
export type WalkInChannelState = { ticketOrder: string[]; tickets: Record<string, WalkInTicketEntry> };
type FreeEntry = { qty: number; note: string };
type Props = {
  staffFreeEntry?: StaffFreeEntryOptions; staffFreeCount?: number;
  channels: ChannelConfig[]; addons: AddonConfig[]; types: WalkInTicketDefinition[];
  paymentMethods: Array<{ id: number; name: string }>;
  value: Record<number, WalkInChannelState>; freePeople: Record<number, FreeEntry>;
  freeAddons: Record<number, Record<number, FreeEntry>>; disabled: boolean;
  getAddonPrice: (channel: ChannelConfig, addon: AddonConfig, currency: WalkInCurrency) => number | null;
  onChange: (channelId: number, value: WalkInChannelState) => void;
  onFreeChange: (channelId: number, people: FreeEntry | undefined, addons: Record<number, FreeEntry>) => void;
};

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
const count = (value: string | number) => Math.min(10000, Math.max(0, Math.floor(Number(value) || 0)));
const ticketColors = [
  { background: '#f0f6ff', surface: '#dfebff', border: '#8aa8d1' },
  { background: '#f7f2ff', surface: '#ece2ff', border: '#ab95ce' },
  { background: '#fff6ec', surface: '#ffe8ce', border: '#c7a17b' },
  { background: '#edf8f6', surface: '#d8efea', border: '#82aaa1' },
  { background: '#fff2f6', surface: '#ffe0eb', border: '#c38c9f' },
] as const;
const freeTicketColor = { background: '#f1f8ec', surface: '#dff0d6', border: '#91ae7d' };
const ticketCardSx = (colors: { background: string; surface: string; border: string }) => ({
  '--ticket-border': colors.border, '--ticket-surface': colors.surface,
  border: '2px solid', borderColor: colors.border, borderRadius: 2, bgcolor: colors.background,
  minWidth: 0, overflow: 'hidden', textAlign: 'center', color: '#1f2937',
} as const);
const centeredFieldSx = { minWidth: 0, '& input': { textAlign: 'center' }, '& .MuiSelect-select': { textAlign: 'center' } } as const;
const addonRowSx = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, alignItems: 'center', justifyItems: 'center' } as const;
export const walkInEntryTotal = (entry: WalkInCurrencyEntry) => Math.round(((entry.unitPrice ?? 0) * entry.people + Object.entries(entry.addons).reduce((sum, [id, qty]) => sum + qty * (entry.addonUnitPrices?.[Number(id)] ?? 0), 0)) * 100) / 100;

function TicketHeader({ children, removeLabel, disabled, onRemove }: { children: ReactNode; removeLabel: string; disabled: boolean; onRemove: () => void }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 36px', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.5, minHeight: 44, bgcolor: 'var(--ticket-surface)', borderBottom: '1px solid', borderColor: 'var(--ticket-border)' }}>
    <Box aria-hidden />
    <Box sx={{ minWidth: 0, textAlign: 'center' }}>{children}</Box>
    <Tooltip title="Remove this entry"><IconButton size="small" aria-label={removeLabel} disabled={disabled} onClick={onRemove} sx={{ justifySelf: 'center', width: 32, height: 32 }}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
  </Box>;
}

function TicketMetric({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, width: '100%', minWidth: 0, textAlign: 'center' }}>{children}</Box>;
}

function Quantity({ label, value, onChange, disabled, max = 10000 }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean; max?: number }) {
  return <Stack direction="row" alignItems="center" sx={{ width: '100%', maxWidth: { xs: 122, sm: 114 }, minWidth: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
    <IconButton size="small" aria-label={`Decrease ${label}`} disabled={disabled || value <= 0} onClick={() => onChange(value - 1)} sx={{ flexShrink: 0, width: { xs: 36, sm: 32 }, height: { xs: 38, sm: 34 } }}><Remove fontSize="small" /></IconButton>
    <TextField size="small" type="number" value={value} onChange={(e) => onChange(Math.min(max, count(e.target.value)))} disabled={disabled} inputProps={{ 'aria-label': label, min: 0, max, step: 1 }} sx={{ flex: '1 1 48px', minWidth: 0, '& fieldset': { border: 0 }, '& input': { p: '6px 0', textAlign: 'center', MozAppearance: 'textfield' }, '& input::-webkit-inner-spin-button, & input::-webkit-outer-spin-button': { WebkitAppearance: 'none', m: 0 } }} />
    <IconButton size="small" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} sx={{ flexShrink: 0, width: { xs: 36, sm: 32 }, height: { xs: 38, sm: 34 } }}><Add fontSize="small" /></IconButton>
  </Stack>;
}

export default function WalkInsPanel(props: Props) {
  const { channels, value, types, addons, paymentMethods, disabled, freePeople, freeAddons, onChange, onFreeChange } = props;
  const [staffData, setStaffData] = useState<StaffFreeOverview | null>(null);
  const [staffLoadError, setStaffLoadError] = useState(false);
  const onStaffOverview = useCallback((data: StaffFreeOverview | null, failed: boolean) => { setStaffData(data); setStaffLoadError(failed); }, []);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [currency, setCurrency] = useState<WalkInCurrency>('PLN');
  const [ticketChoice, setTicketChoice] = useState('normal');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [remove, setRemove] = useState<{ channelId: number; key: string; label: string } | null>(null);
  const [otherChannelsAnchor, setOtherChannelsAnchor] = useState<HTMLElement | null>(null);
  const staffFreeRef = useRef<StaffFreeEntryHandle>(null);
  const [staffFreeStatus, setStaffFreeStatus] = useState<StaffFreeEntryStatus>({ enabled: true, count: null, showCard: false });
  const onStaffFreeStatus = useCallback((next: StaffFreeEntryStatus) => setStaffFreeStatus(previous => previous.enabled === next.enabled && previous.count === next.count && previous.showCard === next.showCard ? previous : next), []);
  const staffFreeCount = staffFreeStatus.count ?? props.staffFreeCount ?? 0;
  const otherChannelsMenuId = useId();
  const walkInChannel = channels.find(item => item.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'walkin');
  const otherChannels = channels.filter(item => item.id !== walkInChannel?.id);
  const otherChannelsOpen = Boolean(otherChannelsAnchor) && !disabled && otherChannels.length > 0;
  useEffect(() => { if (!channels.some((c) => c.id === channelId)) setChannelId(walkInChannel?.id ?? channels[0]?.id ?? null); }, [channels, channelId, walkInChannel?.id]);
  const channel = channels.find((c) => c.id === channelId);
  const isWalkInChannel = Boolean(walkInChannel && channel?.id === walkInChannel.id);
  const staffFreeAvailable = Boolean(props.staffFreeEntry && isWalkInChannel && staffFreeStatus.enabled);
  const otherChannelSelected = Boolean(channel && channel.id !== walkInChannel?.id);
  const state = channel ? value[channel.id] ?? { ticketOrder: [], tickets: {} } : { ticketOrder: [], tickets: {} };
  const ticketOptions = types.filter(type => type.enabled).flatMap(type => {
    const price = channel?.walkInTicketPrices.find(item => item.ticketType === type.id && item.currencyCode === currency && item.enabled !== false);
    return price ? [{ id: type.id, name: type.name, price: price.price }] : [];
  });
  const choices = [
    ...ticketOptions,
    { id: 'custom', name: 'Custom amount', price: null },
    { id: 'free', name: 'Free guest', price: 0 },
    ...(staffFreeAvailable ? [{ id: 'staff_free', name: 'Staff Free', price: 0 }, { id: 'staff_paid', name: 'Staff Ticket', price: staffData?.policy.paidTicketPrice ?? null }] : []),
  ];
  // Keep the selection valid when the channel or currency has different prices.
  const selectedChoice = choices.find(choice => choice.id === ticketChoice) ?? choices[0];
  const choiceAlreadyAdded = (id: string) => id === 'staff_free' ? staffFreeStatus.showCard : !['custom', 'free'].includes(id) && hasWalkInTicketType(state, id, id === 'staff_paid' ? 'PLN' : currency);
  const alreadyAdded = choiceAlreadyAdded(selectedChoice.id);
  const identityErrors = getWalkInTicketIdentityErrors(state);
  const totals = useMemo(() => {
    let people = Object.values(freePeople).reduce((sum, entry) => sum + entry.qty, 0);
    const amounts: Record<string, number> = {};
    Object.values(value).forEach((group) => group.ticketOrder.forEach((key) => {
      const ticket = group.tickets[key];
      ticket?.currencyOrder.forEach((code) => { const row = ticket.currencies[code]; if (!row) return; people += row.people; amounts[code] = (amounts[code] ?? 0) + (Number(row.cash) || 0); });
    }));
    return { people, amounts };
  }, [value, freePeople]);
  const awaitingTotals = useMemo(() => {
    const amounts: Record<string, number> = {};
    Object.values(value).forEach(group => group.ticketOrder.forEach(key => {
      const ticket = group.tickets[key];
      if (ticket?.paymentStatus !== 'awaiting') return;
      ticket.currencyOrder.forEach(code => {
        const amount = Number(ticket.currencies[code]?.cash) || 0;
        if (amount > 0) amounts[code] = (amounts[code] ?? 0) + amount;
      });
    }));
    return amounts;
  }, [value]);
  const freeEntry = channel ? freePeople[channel.id] ?? { qty: 0, note: '' } : { qty: 0, note: '' };
  const freeAddonCount = Object.values(freeAddons[channelId ?? -1] ?? {}).reduce((sum, entry) => sum + entry.qty, 0);
  const freeAddonKey = `free-addons:${channelId}`;
  const showTicketGrid = state.ticketOrder.length > 0 || Boolean(channel && freePeople[channel.id]) || freeAddonCount > 0 || (isWalkInChannel && staffFreeStatus.showCard);
  const toggle = (key: string, currentlyOpen = Boolean(expanded[key])) => setExpanded(prev => ({ ...prev, [key]: !currentlyOpen }));
  const channelCount = (id: number) => (value[id]?.ticketOrder.reduce((sum, key) => sum + (value[id].tickets[key]?.currencyOrder.reduce((n, code) => n + (value[id].tickets[key].currencies[code]?.people ?? 0), 0) ?? 0), 0) ?? 0) + (freePeople[id]?.qty ?? 0);
  const otherGuests = otherChannels.reduce((sum, item) => sum + channelCount(item.id), 0);
  const updateTicket = (key: string, next: WalkInTicketEntry) => channel && onChange(channel.id, { ...state, tickets: { ...state.tickets, [key]: next } });
  const add = (type: WalkInTicketDefinition | 'custom') => {
    if (!channel) return;
    const custom = type === 'custom';
    if (!custom && hasWalkInTicketType(state, type.id, currency)) return;
    const price = custom ? null : channel.walkInTicketPrices.find((p) => p.ticketType === type.id && p.currencyCode === currency);
    if (!custom && !price) return;
    const key = `entry:${crypto.randomUUID()}`;
    const entry: WalkInTicketEntry = {
      name: custom ? nextCustomTicketName(state) : type.name, ticketType: custom ? 'custom' : type.id,
      paymentMethodId: channel.paymentMethodId ?? undefined, paymentMethodName: channel.paymentMethodName ?? undefined,
      paymentStatus: /transfer/i.test(channel.paymentMethodName ?? '') ? 'awaiting' : 'received', currencyOrder: [currency],
      currencies: { [currency]: { people: 1, cash: custom ? '' : String(price!.price), addons: {}, unitPrice: custom ? undefined : price!.price, addonUnitPrices: {} } },
    };
    onChange(channel.id, { ticketOrder: [...state.ticketOrder, key], tickets: { ...state.tickets, [key]: entry } });
  };
  const addSelectedTicket = () => {
    if (!channel || alreadyAdded) return;
    if (selectedChoice.id === 'staff_free') {
      staffFreeRef.current?.open();
    } else if (selectedChoice.id === 'staff_paid') {
      const price = staffData?.policy.paidTicketPrice;
      if (!price || !staffData?.enabled) return;
      const key = `entry:${crypto.randomUUID()}`;
      onChange(channel.id, { ticketOrder: [...state.ticketOrder, key], tickets: { ...state.tickets, [key]: {
        name: 'Staff Ticket', ticketType: 'staff_paid', staffGuests: [], currencyOrder: ['PLN'],
        paymentMethodId: channel.paymentMethodId ?? undefined, paymentMethodName: channel.paymentMethodName ?? undefined,
        paymentStatus: /transfer/i.test(channel.paymentMethodName ?? '') ? 'awaiting' : 'received',
        currencies: { PLN: { people: 0, cash: '0', unitPrice: price, addons: {} } },
      } } });
    } else if (selectedChoice.id === 'free') {
      onFreeChange(channel.id, { ...freeEntry, qty: count(freeEntry.qty + 1) }, freeAddons[channel.id] ?? {});
    } else if (selectedChoice.id === 'custom') {
      add('custom');
    } else {
      const type = types.find(item => item.id === selectedChoice.id);
      if (type) add(type);
    }
  };

  return <Paper variant="outlined" sx={{ borderRadius: 2, width: '100%', minWidth: 0, p: { xs: 1.25, sm: 1.5 } }}>
    <Stack spacing={1.25}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" fontWeight={700} sx={{ gridColumn: 2, textAlign: 'center' }}>Walk-Ins</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ gridColumn: 3, minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>
          {totals.people + staffFreeCount} guests
          {Object.entries(totals.amounts).filter(([, amount]) => amount > 0).map(([code, amount]) => <Box component="span" key={code}> · {money(amount, code)}</Box>)}
        </Typography>
      </Box>
      <Stack direction="row" gap={0.5} role="group" aria-label="Arrival channel" sx={{ minWidth: 0, width: '100%', '& > .MuiButton-root': { flex: '1 1 0', minWidth: 0, justifyContent: 'center', textAlign: 'center' } }}>
        {walkInChannel && <Button size="small" variant={channelId === walkInChannel.id ? 'contained' : 'text'} aria-pressed={channelId === walkInChannel.id} onClick={() => setChannelId(walkInChannel.id)} disabled={disabled} sx={{ minHeight: 40, textTransform: 'none', boxShadow: 'none', color: channelId === walkInChannel.id ? undefined : 'text.secondary' }}>
          {walkInChannel.name}{channelCount(walkInChannel.id) + staffFreeCount > 0 && <Box component="span" sx={{ ml: 0.75, opacity: 0.85 }}>({channelCount(walkInChannel.id) + staffFreeCount})</Box>}
        </Button>}
        {otherChannels.length > 0 && <Button
          id={`${otherChannelsMenuId}-button`} size="small" variant={otherChannelSelected ? 'contained' : 'text'}
          aria-pressed={otherChannelSelected} aria-haspopup="menu" aria-expanded={otherChannelsOpen}
          aria-controls={otherChannelsOpen ? otherChannelsMenuId : undefined}
          onClick={event => setOtherChannelsAnchor(event.currentTarget)} disabled={disabled}
          sx={{ minHeight: 40, px: 3, textTransform: 'none', boxShadow: 'none', color: otherChannelSelected ? undefined : 'text.secondary' }}
        >
          <Box component="span" sx={{ minWidth: 0, textAlign: 'center' }}>
            <Box component="span" sx={{ display: 'block' }}>Others{otherGuests > 0 ? ` (${otherGuests})` : ''}</Box>
            {otherChannelSelected && <Typography component="span" variant="caption" noWrap title={channel?.name} sx={{ display: 'block', lineHeight: 1.2 }}>{channel?.name}</Typography>}
          </Box>
          {otherChannelsOpen ? <ExpandLess sx={{ position: 'absolute', right: 4, fontSize: 18 }} /> : <ExpandMore sx={{ position: 'absolute', right: 4, fontSize: 18 }} />}
        </Button>}
      </Stack>
      <Menu
        id={otherChannelsMenuId} anchorEl={otherChannelsAnchor} open={otherChannelsOpen} onClose={() => setOtherChannelsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        MenuListProps={{ 'aria-label': 'Other arrival channels' }}
        PaperProps={{ sx: { mt: 0.5, minWidth: 240, maxWidth: 'calc(100vw - 32px)', maxHeight: 320, borderRadius: 2 } }}
      >
        {otherChannels.map(item => <MenuItem key={item.id} role="menuitemradio" selected={channelId === item.id} aria-checked={channelId === item.id} disabled={disabled}
          onClick={() => { setChannelId(item.id); setOtherChannelsAnchor(null); }}
          sx={{ minHeight: 44, width: '100%', boxSizing: 'border-box', justifyContent: 'center', textAlign: 'center', whiteSpace: 'normal' }}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.name} ({channelCount(item.id)})</Typography>
        </MenuItem>)}
      </Menu>
      {!channel ? <Alert severity="info">No walk-in channels are available. Configure an arrival channel in Settings / Channels.</Alert> : <>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 60px 44px', gap: 1, alignItems: 'stretch', pt: 0.5 }}>
          <TextField
            select size="small" value={selectedChoice.id} disabled={disabled}
            onChange={event => setTicketChoice(event.target.value)}
            sx={{ minWidth: 0, '& .MuiInputBase-root': { height: 56 } }}
            SelectProps={{ inputProps: { 'aria-label': 'Ticket type' }, renderValue: () => <Box sx={{ minWidth: 0, textAlign: 'center' }}>
              <Typography variant="body2" noWrap fontWeight={600}>{selectedChoice.name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">{selectedChoice.id === 'staff_free' ? 'Choose staff member' : selectedChoice.price == null ? 'Enter your total' : selectedChoice.id === 'free' ? 'Reason required' : selectedChoice.price === 0 ? 'Free' : money(selectedChoice.price, selectedChoice.id === 'staff_paid' ? 'PLN' : currency)}</Typography>
            </Box> }}
          >
            {choices.map(choice => <MenuItem key={choice.id} value={choice.id} disabled={choiceAlreadyAdded(choice.id)} divider={choice.id === ticketOptions.at(-1)?.id} sx={{ gap: 2, minHeight: 44, justifyContent: 'space-between' }}>
              <Typography variant="body2">{choice.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{choiceAlreadyAdded(choice.id) ? 'Already added' : choice.price == null ? 'Custom' : choice.price === 0 ? 'Free' : money(choice.price, choice.id === 'staff_paid' ? 'PLN' : currency)}</Typography>
            </MenuItem>)}
          </TextField>
          <TextField select size="small" value={selectedChoice.id === 'staff_paid' ? 'PLN' : currency} onChange={event => setCurrency(event.target.value as WalkInCurrency)} disabled={disabled || ['staff_free', 'staff_paid'].includes(selectedChoice.id)} SelectProps={{ inputProps: { 'aria-label': 'Currency' } }} sx={{ '& .MuiInputBase-root': { height: 56 }, '&& .MuiSelect-select': { px: 1, textAlign: 'center' }, '& .MuiSelect-icon': { display: 'none' } }}><MenuItem value="PLN">PLN</MenuItem><MenuItem value="EUR">EUR</MenuItem></TextField>
          <Tooltip title={alreadyAdded ? selectedChoice.id === 'staff_free' ? '' : 'Update the existing ticket quantity below' : 'Add ticket'}><span style={{ display: 'flex' }}><Button variant="contained" aria-label="Add ticket" disabled={disabled || alreadyAdded || (selectedChoice.id === 'staff_paid' && (!staffData?.enabled || staffLoadError))} onClick={addSelectedTicket} sx={{ boxShadow: 'none', minWidth: 44, px: 1 }}><Add /></Button></span></Tooltip>
        </Box>
        {alreadyAdded && selectedChoice.id !== 'staff_free' && <Typography variant="caption" color="text.secondary" textAlign="center">{selectedChoice.name} ({currency}) is already added. Update its quantity below.</Typography>}
        {selectedChoice.id === 'staff_paid' && staffLoadError && <Alert severity="error">Unable to load Staff Ticket availability. Reopen the counter to retry.</Alert>}
        {ticketOptions.length === 0 && <Typography variant="caption" color="text.secondary">No {currency} prices configured. Use Custom amount or add prices in Settings / Channel Product Prices.</Typography>}
        <Box sx={{ display: showTicketGrid ? 'grid' : 'none', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1, alignItems: 'start' }}>
        {state.ticketOrder.map((key, ticketIndex) => {
          const ticket = state.tickets[key]; if (!ticket) return null;
          const typeId = getWalkInTicketType(key, ticket);
          const custom = typeId === 'custom';
          const paidStaff = typeId === 'staff_paid';
          const methodId = ticket.paymentMethodId ?? (ticket.transfer ? paymentMethods.find((m) => /transfer/i.test(m.name))?.id : channel.paymentMethodId);
          const methodName = ticket.paymentMethodName ?? (ticket.transfer ? 'Transfer' : channel.paymentMethodName);
          const paymentKey = `payment:${channel.id}:${key}`;
          const paymentOpen = expanded[paymentKey] ?? !methodId;
          return <Box key={key} role="group" aria-label={`${ticket.name} ticket`} sx={ticketCardSx(ticketColors[ticketIndex % ticketColors.length])}>
            <TicketHeader removeLabel={`Remove ${ticket.name}`} disabled={disabled} onRemove={() => setRemove({ channelId: channel.id, key, label: ticket.name })}>
              {custom ? <TextField fullWidth size="small" value={ticket.name} placeholder="Ticket name" inputProps={{ 'aria-label': 'Custom ticket name', maxLength: 80 }} error={Boolean(identityErrors[key])} helperText={identityErrors[key]} FormHelperTextProps={{ sx: { textAlign: 'center' } }} onChange={(e) => updateTicket(key, { ...ticket, name: e.target.value })} disabled={disabled} sx={{ ...centeredFieldSx, '& input': { textAlign: 'center', py: 0.75, fontWeight: 600 }, bgcolor: 'background.paper' }} /> : <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{ticket.name}</Typography>}
            </TicketHeader>
            {!custom && identityErrors[key] && <Alert severity="error">{identityErrors[key]}</Alert>}
            {paidStaff && <Box sx={{ p: 1 }}>
              {staffLoadError && <Alert severity="error">Unable to load staff. Reopen the counter to retry.</Alert>}
              <Autocomplete multiple size="small" disabled={disabled || !staffData || staffLoadError}
                options={[
                  ...(ticket.staffGuests ?? []),
                  ...(staffData?.staff ?? []).filter(person => !person.unlimited && person.remaining === 0 && !person.onShift && !person.alreadyCheckedIn && !(ticket.staffGuests ?? []).some(guest => guest.userId === person.id)).map(person => ({ userId: person.id, name: person.name })),
                ]}
                value={ticket.staffGuests ?? []} getOptionLabel={person => person.name} isOptionEqualToValue={(a, b) => a.userId === b.userId}
                getOptionDisabled={person => Boolean(props.staffFreeEntry?.draft.additions.some(row => row.userId === person.userId))}
                onChange={(_, guests) => { const row = ticket.currencies.PLN!; updateTicket(key, { ...ticket, staffGuests: guests, currencies: { PLN: { ...row, people: guests.length, cash: String(Math.round(guests.length * (row.unitPrice ?? 0) * 100) / 100) } } }); }}
                noOptionsText="No staff with an exhausted allowance available"
                renderInput={params => <TextField {...params} placeholder="Choose staff" inputProps={{ ...params.inputProps, 'aria-label': 'Staff Ticket members' }} />} />
            </Box>}
            <Stack>
              {ticket.currencyOrder.map((code) => {
                const row = ticket.currencies[code]; if (!row) return null;
                const rowId = `${channel.id}:${key}:${code}`;
                const addonCount = Object.values(row.addons).reduce((a, b) => a + b, 0);
                const changeRow = (next: WalkInCurrencyEntry, reprice = true) => {
                  let priced = { ...next, addonUnitPrices: { ...row.addonUnitPrices } };
                  addons.forEach((addon) => { if (priced.addonUnitPrices[addon.addonId] == null) { const price = props.getAddonPrice(channel, addon, code); if (price != null) priced.addonUnitPrices[addon.addonId] = price; } });
                  if (!custom && reprice) {
                    const unitPrice = row.unitPrice ?? channel.walkInTicketPrices.find((p) => p.ticketType === typeId && p.currencyCode === code)?.price;
                    if (unitPrice != null) {
                      priced = { ...priced, unitPrice };
                      addons.forEach((addon) => { if (priced.addonUnitPrices![addon.addonId] == null) { const price = props.getAddonPrice(channel, addon, code); if (price != null) priced.addonUnitPrices![addon.addonId] = price; } });
                      priced.cash = String(walkInEntryTotal(priced));
                    }
                  }
                  updateTicket(key, { ...ticket, currencies: { ...ticket.currencies, [code]: priced } });
                };
                const firstCurrency = ticket.currencyOrder[0] === code;
                return <Stack key={code}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, alignItems: 'center', px: 1, py: 1, '& > :last-child': { borderLeft: '1px solid', borderColor: 'var(--ticket-border)', pl: 1 } }}>
                    <TicketMetric>{paidStaff ? <Typography variant="body2">{row.people} staff</Typography> : <Quantity label={`${ticket.name} guests (${code})`} value={row.people} disabled={disabled} onChange={(people) => {
                      const nextAddons = { ...row.addons };
                      addons.forEach((addon) => { const max = /cocktail/i.test(addon.key) ? people : addon.maxPerAttendee != null ? people * addon.maxPerAttendee : undefined; if (max != null && (nextAddons[addon.addonId] ?? 0) > max) nextAddons[addon.addonId] = max; });
                      changeRow({ ...row, people, addons: nextAddons });
                    }} />}</TicketMetric>
                    <TicketMetric>
                      {custom ? <TextField fullWidth size="small" value={row.cash} placeholder="Amount" onChange={(e) => { const raw = e.target.value.replace(',', '.'); if (/^\d{0,9}(\.\d{0,2})?$/.test(raw)) changeRow({ ...row, cash: raw }, false); }} disabled={disabled} inputProps={{ 'aria-label': `Total amount (${code})`, inputMode: 'decimal' }} InputProps={{ endAdornment: <InputAdornment position="end"><Typography variant="caption" color="text.secondary">{code}</Typography></InputAdornment> }} sx={{ ...centeredFieldSx, maxWidth: 160 }} /> : <Typography variant="body1" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{money(Number(row.cash) || 0, code)}</Typography>}
                    </TicketMetric>
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: firstCurrency && !paidStaff && addons.length > 0 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', bgcolor: 'var(--ticket-surface)', borderTop: '1px solid', borderColor: 'var(--ticket-border)', '& > :nth-of-type(2)': { borderLeft: '1px solid', borderColor: 'var(--ticket-border)' } }}>
                    {firstCurrency && <Button size="small" color={ticket.paymentStatus === 'awaiting' ? 'warning' : 'inherit'} aria-expanded={paymentOpen} aria-label={`Payment for ${ticket.name}: ${methodName ?? 'Choose method'}, ${ticket.paymentStatus === 'awaiting' ? 'awaiting payment' : 'received'}`} onClick={() => toggle(paymentKey, paymentOpen)} sx={{ textTransform: 'none', color: ticket.paymentStatus === 'awaiting' ? 'warning.dark' : 'text.secondary', minHeight: 44, borderRadius: 0, px: 3, py: 0.5, minWidth: 0 }}>
                      <Stack alignItems="center" spacing={0} sx={{ minWidth: 0 }}><Typography variant="caption" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{methodName ?? 'Choose payment'}</Typography><Typography variant="caption">{ticket.paymentStatus === 'awaiting' ? 'Awaiting payment' : 'Received'}</Typography></Stack>
                      {paymentOpen ? <ExpandLess sx={{ position: 'absolute', right: 4, fontSize: 18 }} /> : <ExpandMore sx={{ position: 'absolute', right: 4, fontSize: 18 }} />}
                    </Button>}
                    {!paidStaff && addons.length > 0 && <Button size="small" aria-expanded={Boolean(expanded[rowId])} onClick={() => toggle(rowId)} sx={{ textTransform: 'none', minHeight: 44, borderRadius: 0, px: 3, minWidth: 0 }}>Add-ons{addonCount > 0 ? ` (${addonCount})` : ''}{ticket.currencyOrder.length > 1 ? ` · ${code}` : ''}{expanded[rowId] ? <ExpandLess sx={{ position: 'absolute', right: 4, fontSize: 18 }} /> : <ExpandMore sx={{ position: 'absolute', right: 4, fontSize: 18 }} />}</Button>}
                  </Box>
                  {addons.length > 0 && <Collapse in={Boolean(expanded[rowId])} unmountOnExit><Stack spacing={1} sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'var(--ticket-border)' }}>
                      {addons.map((addon) => {
                        const price = row.addonUnitPrices?.[addon.addonId] ?? props.getAddonPrice(channel, addon, code);
                        const max = /cocktail/i.test(addon.key) ? row.people : addon.maxPerAttendee != null ? row.people * addon.maxPerAttendee : 10000;
                        return <Box key={addon.addonId} sx={addonRowSx}><Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{addon.name}</Typography><Typography variant="caption" color="text.secondary">{custom ? 'Included in your custom total' : price == null ? `No ${code} price configured` : `${money(price, code)} each`}</Typography></Box><Quantity label={`${ticket.name} ${addon.name} (${code})`} value={row.addons[addon.addonId] ?? 0} max={max} disabled={disabled || (!custom && price == null)} onChange={(qty) => changeRow({ ...row, addons: { ...row.addons, [addon.addonId]: qty } })} /></Box>;
                      })}
                    </Stack></Collapse>}
                </Stack>;
              })}
              <Collapse in={paymentOpen} unmountOnExit><Box sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'var(--ticket-border)' }}>
                <Stack spacing={1}>
                <TextField fullWidth select size="small" value={methodId ?? ''} disabled={disabled} SelectProps={{ inputProps: { 'aria-label': 'Payment method' }, displayEmpty: true, renderValue: selected => paymentMethods.find(method => method.id === Number(selected))?.name ?? methodName ?? 'Choose payment' }} onChange={(e) => { const selected = paymentMethods.find((m) => m.id === Number(e.target.value)); if (selected) updateTicket(key, { ...ticket, paymentMethodId: selected.id, paymentMethodName: selected.name, transfer: /transfer/i.test(selected.name), paymentStatus: /transfer/i.test(selected.name) ? 'awaiting' : 'received' }); }} sx={centeredFieldSx}>
                  {methodId != null && !paymentMethods.some((m) => m.id === methodId) && <MenuItem value={methodId}>{methodName ?? 'Original method'}</MenuItem>}
                  {paymentMethods.map((method) => <MenuItem key={method.id} value={method.id}>{method.name}</MenuItem>)}
                </TextField>
                <TextField fullWidth select size="small" value={ticket.paymentStatus ?? 'received'} disabled={disabled} SelectProps={{ inputProps: { 'aria-label': 'Payment status' } }} onChange={(e) => updateTicket(key, { ...ticket, paymentStatus: e.target.value as 'received' | 'awaiting' })} sx={centeredFieldSx}><MenuItem value="received">Payment received</MenuItem><MenuItem value="awaiting">Awaiting payment</MenuItem></TextField>
                </Stack>
              </Box></Collapse>
            </Stack>
          </Box>;
        })}
        {(freePeople[channel.id] || freeAddonCount > 0) && <Box role="group" aria-label="Free guest ticket" sx={ticketCardSx(freeTicketColor)}>
          <TicketHeader removeLabel="Remove free entry" disabled={disabled} onRemove={() => setRemove({ channelId: channel.id, key: 'free', label: 'Free entry and its add-ons' })}><Typography variant="body2" fontWeight={700} color="success.dark">Free guests</Typography></TicketHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, px: 1, py: 1, '& > :last-child': { borderLeft: '1px solid', borderColor: 'var(--ticket-border)', pl: 1 } }}>
            <TicketMetric><Quantity label="Free guests" value={freeEntry.qty} disabled={disabled} onChange={(qty) => onFreeChange(channel.id, { ...freeEntry, qty }, freeAddons[channel.id] ?? {})} /></TicketMetric>
            <TicketMetric><Typography variant="body1" fontWeight={700} color="success.dark">Free</Typography></TicketMetric>
          </Box>
          <Box sx={{ px: 1.25, pb: 1.25 }}><TextField fullWidth required size="small" placeholder="Reason for free entry" value={freeEntry.note} error={freeEntry.qty > 0 && !freeEntry.note.trim()} disabled={disabled} inputProps={{ 'aria-label': 'Reason for free entry' }} onChange={(e) => onFreeChange(channel.id, { ...freeEntry, note: e.target.value }, freeAddons[channel.id] ?? {})} sx={centeredFieldSx} /></Box>
          {addons.length > 0 && <Button fullWidth size="small" aria-expanded={Boolean(expanded[freeAddonKey])} endIcon={expanded[freeAddonKey] ? <ExpandLess /> : <ExpandMore />} onClick={() => toggle(freeAddonKey)} sx={{ textTransform: 'none', minHeight: 44, bgcolor: 'var(--ticket-surface)', borderTop: '1px solid', borderColor: 'var(--ticket-border)', borderRadius: 0 }}>Free add-ons{freeAddonCount > 0 ? ` (${freeAddonCount})` : ''}</Button>}
          <Collapse in={Boolean(expanded[freeAddonKey])} unmountOnExit><Stack spacing={1} sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'var(--ticket-border)' }}>
          {addons.map((addon) => {
            const entry = freeAddons[channel.id]?.[addon.addonId] ?? { qty: 0, note: '' };
            return (
              <Box key={addon.addonId}>
                <Box sx={addonRowSx}>
                  <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>Free {addon.name}</Typography>
                  <Quantity
                    label={`Free ${addon.name}`}
                    value={entry.qty}
                    disabled={disabled}
                    onChange={(qty) => onFreeChange(channel.id, freeEntry, {
                      ...freeAddons[channel.id],
                      [addon.addonId]: { ...entry, qty },
                    })}
                  />
                </Box>
                {entry.qty > 0 && (
                  <Box sx={{ mt: 1 }}><TextField
                    fullWidth required size="small"
                    placeholder={`Reason for free ${addon.name}`}
                    inputProps={{ 'aria-label': `Reason for free ${addon.name}` }}
                    value={entry.note}
                    error={!entry.note.trim()}
                    disabled={disabled}
                    sx={centeredFieldSx}
                    onChange={(e) => onFreeChange(channel.id, freeEntry, {
                      ...freeAddons[channel.id],
                      [addon.addonId]: { ...entry, note: e.target.value },
                    })}
                  /></Box>
                )}
              </Box>
            );
          })}
          </Stack></Collapse>
        </Box>}
        {props.staffFreeEntry && <StaffFreeEntryPanel {...props.staffFreeEntry} walkIns={value} freePeople={freePeople} ref={staffFreeRef} excludedUserIds={state.ticketOrder.flatMap(key => state.tickets[key]?.staffGuests?.map(person => person.userId) ?? [])} active={isWalkInChannel} disabled={disabled} onStatusChange={onStaffFreeStatus} onOverviewChange={onStaffOverview} />}
        </Box>
        {Object.keys(awaitingTotals).length > 0 && <Typography variant="body2" color="warning.dark">Awaiting payment: {Object.entries(awaitingTotals).map(([code, amount]) => money(amount, code)).join(' · ')}</Typography>}
      </>}
    </Stack>
    <Dialog open={Boolean(remove)} onClose={() => setRemove(null)} maxWidth="xs" fullWidth><DialogTitle>Remove this entry?</DialogTitle><DialogContent>{remove?.label} and its counts will be removed from this counter.</DialogContent><DialogActions><Button onClick={() => setRemove(null)}>Keep entry</Button><Button color="error" disabled={disabled} onClick={() => {
      if (!remove) return;
      if (remove.key === 'free') onFreeChange(remove.channelId, undefined, {});
      else { const current = value[remove.channelId]; const tickets = { ...current.tickets }; delete tickets[remove.key]; onChange(remove.channelId, { ...current, ticketOrder: current.ticketOrder.filter((key) => key !== remove.key), tickets }); }
      setRemove(null);
    }}>Remove entry</Button></DialogActions></Dialog>
  </Paper>;
}
