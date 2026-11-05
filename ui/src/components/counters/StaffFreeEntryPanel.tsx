import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Alert, Autocomplete, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress, Stack, Switch, TextField, Typography } from '@mui/material';
import { Add, Close, DeleteOutline, Undo } from '@mui/icons-material';
import { getStaffFreeEntries, type StaffFreeCounterEntry, type StaffFreeOverview } from '../../api/staffFreeEntries';
import { getLiveStaffFreeDecision, getLiveStaffFreeQualification, type StaffFreeLiveAttendance } from '../../utils/staffFreeLiveQualification';
import { hasStaffFreeDraft, staffFreeDraftCount, staffFreeDraftError, type StaffFreeDraft } from '../../utils/staffFreeDraft';

export type StaffFreeEntryOptions = {
  counterId: number; revision?: string; reservationOrders: StaffFreeLiveAttendance['reservationOrders'];
  draft: StaffFreeDraft; onDraftChange: (draft: StaffFreeDraft) => void; onValidationChange?: (error: string | null) => void;
};
export type StaffFreeEntryHandle = { open: () => void };
export type StaffFreeEntryStatus = { enabled: boolean; count: number | null; showCard: boolean };
type Props = StaffFreeEntryOptions & Pick<StaffFreeLiveAttendance, 'walkIns' | 'freePeople'> & { disabled: boolean; excludedUserIds?: number[]; active?: boolean; onStatusChange?: (status: StaffFreeEntryStatus) => void; onOverviewChange?: (data: StaffFreeOverview | null, failed: boolean) => void };
const message = (error: unknown) => isAxiosError(error) ? error.response?.data?.[0]?.message ?? error.message : error instanceof Error ? error.message : 'Unable to load staff free entries.';
const initials = (name: string) => name.split(' ').filter(Boolean).map(s => s[0]).slice(0, 2).join('');
const rowSx = { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 36px', alignItems: 'center', gap: 0.5 };

const StaffFreeEntryPanel = forwardRef<StaffFreeEntryHandle, Props>(function StaffFreeEntryPanel({ counterId, revision, reservationOrders, walkIns, freePeople, draft, onDraftChange, onValidationChange, disabled, active = true, onStatusChange, onOverviewChange, excludedUserIds = [] }, ref) {
  const [savedData, setData] = useState<StaffFreeOverview | null>(null);
  const loadVersion = useRef(0);
  const [forbidden, setForbidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [correction, setCorrection] = useState<StaffFreeCounterEntry | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  useEffect(() => {
    let mounted = true;
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    void getStaffFreeEntries(counterId).then(next => {
      if (mounted && version === loadVersion.current) { setData(next); setForbidden(false); }
    }).catch(err => {
      if (!mounted || version !== loadVersion.current) return;
      setError(message(err));
      if (isAxiosError(err) && err.response?.status === 403) setForbidden(true);
    }).finally(() => { if (mounted && version === loadVersion.current) setLoading(false); });
    return () => { mounted = false; };
  }, [counterId, revision]);
  useEffect(() => { onOverviewChange?.(loading ? null : savedData, Boolean(error)); }, [savedData, loading, error, onOverviewChange]);
  const qualification = useMemo(() => savedData ? getLiveStaffFreeQualification(
    { reservationOrders, walkIns, freePeople }, savedData.qualification?.normalPrices ?? {}, savedData.policy.minimumPricePercent,
  ) : null, [savedData, reservationOrders, walkIns, freePeople]);
  const data = useMemo(() => savedData ? {
    ...savedData, checkedIn: qualification?.count ?? 0, qualification: qualification ?? undefined,
    staff: savedData.staff.map(person => ({ ...person, decision: getLiveStaffFreeDecision(person, qualification?.count ?? 0, savedData.policy) })),
  } : null, [savedData, qualification]);
  const validation = hasStaffFreeDraft(draft) && (error || forbidden) ? error || 'Staff Free access is unavailable.' : staffFreeDraftError(draft, data, Boolean(qualification));
  useEffect(() => { onValidationChange?.(validation); }, [validation, onValidationChange]);
  const retryLoad = async () => {
    setLoading(true); setError('');
    const version = ++loadVersion.current;
    try { const next = await getStaffFreeEntries(counterId); if (version === loadVersion.current) { setData(next); setForbidden(false); } }
    catch (err) { setError(message(err)); }
    finally { setLoading(false); }
  };
  const openStaffEntry = () => { if (!disabled && !forbidden && data?.enabled !== false) { setOpen(true); setSearch(''); } };
  useImperativeHandle(ref, () => ({ open: openStaffEntry }));
  const enabled = !forbidden && data?.enabled !== false;
  const entryCount = data ? staffFreeDraftCount(data.entries, draft) : null;
  const showCard = (enabled || hasStaffFreeDraft(draft)) && (open || Boolean(entryCount) || hasStaffFreeDraft(draft) || Boolean(error));
  useEffect(() => { onStatusChange?.({ enabled, count: entryCount, showCard }); }, [enabled, entryCount, showCard, onStatusChange]);
  const pending = draft.additions.filter(row => !data?.entries.some(entry => entry.userId === row.userId));
  const updateAddition = (userId: number, patch: Partial<StaffFreeDraft['additions'][number]>) => onDraftChange({ ...draft, additions: draft.additions.map(row => row.userId === userId ? { ...row, ...patch } : row) });
  if (!active || !showCard) return null;
  return <Box role="group" aria-label="Staff Free ticket" sx={{ border: '2px solid #7baab5', borderRadius: 2, bgcolor: '#eef9fb', color: '#1f2937', textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
    <Box sx={{ ...rowSx, px: 0.5, py: 0.5, minHeight: 44, bgcolor: '#dceff3', borderBottom: '1px solid #7baab5' }}>
      <Box aria-hidden /><Typography variant="body2" fontWeight={700}>Staff Free</Typography>
      {open && <IconButton size="small" aria-label="Close staff selector" disabled={disabled} onClick={() => setOpen(false)}><Close fontSize="small" /></IconButton>}
    </Box>
    {error && <Alert severity="error" sx={{ m: 1 }}>{error}<Button size="small" disabled={loading || disabled} onClick={() => void retryLoad()}>Retry</Button></Alert>}
    {Boolean(entryCount) && <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', py: 1, '& > :last-child': { borderLeft: '1px solid #7baab5' } }}><Typography variant="body2" fontWeight={700}>{entryCount} staff</Typography><Typography fontWeight={700}>Free</Typography></Box>}
    <Stack spacing={0.75} sx={{ px: 1, pt: 0.75 }}>
      {data?.entries.map(entry => {
        const removed = draft.removals.some(row => row.entryId === entry.id);
        return <Box key={entry.id} sx={{ ...rowSx, py: 0.75, px: 0.5, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid #c1dce3' }}>
          <Avatar sx={{ width: 28, height: 28, bgcolor: '#dceff3', color: '#285864', fontSize: 12 }}>{initials(entry.name)}</Avatar>
          <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere', textDecoration: removed ? 'line-through' : undefined }}>{entry.name}</Typography><Typography variant="caption" color="text.secondary">{removed ? 'Removal pending' : entry.label}</Typography></Box>
          <IconButton size="small" aria-label={(removed ? 'Keep entry for ' : 'Undo entry for ') + entry.name} disabled={disabled} onClick={() => {
            if (removed) onDraftChange({ ...draft, removals: draft.removals.filter(row => row.entryId !== entry.id) });
            else { setCorrection(entry); setCorrectionReason(''); }
          }}><Undo fontSize="small" /></IconButton>
        </Box>;
      })}
      {pending.map(row => {
        const person = data?.staff.find(item => item.id === row.userId);
        const blocked = person && !person.decision.allowed;
        return <Box key={'draft-' + row.userId} sx={{ p: 0.75, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid #c1dce3' }}>
          <Box sx={rowSx}>
            <Avatar sx={{ width: 28, height: 28, bgcolor: '#dceff3', color: '#285864', fontSize: 12 }}>{initials(row.name)}</Avatar>
            <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{row.name}</Typography>
              {person && <Typography variant="caption" color="text.secondary">{person.unlimited ? 'Unlimited entries' : person.remaining + ' of ' + data?.policy.allowance + ' free crawls remaining'}</Typography>}
            </Box>
            <IconButton size="small" aria-label={'Remove ' + row.name} disabled={disabled} onClick={() => onDraftChange({ ...draft, additions: draft.additions.filter(item => item.userId !== row.userId) })}><DeleteOutline fontSize="small" /></IconButton>
          </Box>
          {!person && data && <Alert severity="warning">This staff member is no longer eligible. Remove this entry to continue.</Alert>}
          {blocked && !person.decision.canOverride && <Alert severity="warning">{person.decision.message}</Alert>}
          {blocked && person.decision.canOverride && <>
            <FormControlLabel sx={{ justifyContent: 'center', m: 0 }} control={<Switch checked={row.override} disabled={disabled} onChange={(_, checked) => updateAddition(row.userId, { override: checked })} />} label={'Override for ' + row.name} />
            {row.override && <TextField fullWidth required multiline minRows={2} label={'Override reason for ' + row.name} value={row.overrideReason} disabled={disabled} onChange={event => updateAddition(row.userId, { overrideReason: event.target.value })} inputProps={{ maxLength: 2000 }} error={!row.overrideReason.trim()} />}
          </>}
        </Box>;
      })}
    </Stack>
    {!open && <Box sx={{ p: 1 }}><Button fullWidth size="small" startIcon={<Add />} disabled={disabled || loading || !data || !enabled} onClick={openStaffEntry}>Add staff</Button></Box>}
    {open && <Stack spacing={1.25} sx={{ p: 1.25 }}>
        {data && <Box>
          <Box><Typography variant="caption" color="text.secondary">Qualifying customers checked in</Typography><Typography variant="body1" fontWeight={700}>{qualification ? data.checkedIn : '—'} / {data.policy.busyThreshold}</Typography></Box>
          <LinearProgress value={Math.min(100, data.checkedIn / data.policy.busyThreshold * 100)} variant={qualification ? 'determinate' : 'indeterminate'} color={data.checkedIn >= data.policy.busyThreshold ? 'success' : 'primary'} sx={{ my: 1, height: 4, borderRadius: 3 }} />
          {!qualification && <Typography variant="caption" color="text.secondary">Waiting for reservation attendance.</Typography>}
          <Box component="details" sx={{ mt: 0.75, '& summary': { cursor: 'pointer', fontSize: '0.8rem', color: 'primary.main' } }}>
            <summary>Allowance rules</summary>
            <Stack spacing={1} sx={{ pt: 1 }}>
              <Typography variant="caption">Volunteers and long-term staff have {data.policy.allowance} free crawls for their lifetime. Below {data.policy.busyThreshold} qualifying customers, each visit uses one. At {data.policy.busyThreshold} or more, no allowance is used; any allowance used earlier that night is returned when the counter is saved.</Typography>
              <Typography variant="caption">Only customers paying at least {data.policy.minimumPricePercent}% of the normal ticket price count. Free customers and staff free entries do not count.</Typography>
              <Typography variant="caption">Assistant Managers, Managers, Owners and Administrators have unlimited off-duty entries. Staff must have an active, approved account, an active staff profile and an assigned role. Anyone assigned to work this pub crawl cannot use Staff Free.</Typography>
              <Typography variant="caption">If the allowance is exhausted, an Assistant Manager, Manager, Owner or Administrator can override it with a recorded reason. After the allowance is used, Staff Ticket is available for PLN {data.policy.paidTicketPrice?.toFixed(2)} per visit. Paid visits are tracked separately in Account. Group bookings use the average base ticket price per person, excluding add-ons.</Typography>
              {data.qualification && <Stack direction="row" justifyContent="center" gap={0.75} flexWrap="wrap">{Object.entries(data.qualification.normalPrices).map(([currency, normal]) => <Chip size="small" key={currency} label={`Minimum ${currency} ${(normal * data.policy.minimumPricePercent / 100).toFixed(2)}`} />)}{data.qualification.belowMinimum > 0 && <Chip size="small" label={`${data.qualification.belowMinimum} below minimum`} />}{data.qualification.free > 0 && <Chip size="small" label={`${data.qualification.free} free customers`} />}</Stack>}
            </Stack>
          </Box>
          {Boolean(data.qualification?.unpriced) && <Alert severity="warning" sx={{ mt: 1 }}>{data.qualification!.unpriced} checked-in customers have missing ticket or normal-price information and are excluded. Correct the booking or ticket prices.</Alert>}
        </Box>}
      <Autocomplete size="small" options={data?.staff ?? []} value={null} inputValue={search} onInputChange={(_, value) => setSearch(value)}
        onChange={(_, person) => {
          if (!person || person.onShift || person.alreadyCheckedIn || draft.additions.some(row => row.userId === person.id)) return;
          onDraftChange({ ...draft, additions: [...draft.additions, { userId: person.id, name: person.name, override: false, overrideReason: '' }] }); setSearch('');
        }}
        getOptionDisabled={person => excludedUserIds.includes(person.id) || person.onShift || person.alreadyCheckedIn || draft.additions.some(row => row.userId === person.id)}
        getOptionLabel={person => person.name} isOptionEqualToValue={(a, b) => a.id === b.id} disabled={disabled || loading || !data || !enabled}
        renderInput={params => <TextField {...params} placeholder="Choose staff member" inputProps={{ ...params.inputProps, 'aria-label': 'Staff member' }} sx={{ '& input': { textAlign: 'center' } }} />}
        renderOption={(props, person) => <li {...props}><Stack direction="row" gap={1} alignItems="center" sx={{ width: '100%', py: 0.5 }}><Avatar sx={{ width: 28, height: 28, bgcolor: '#dceff3', color: '#285864', fontSize: 12 }}>{initials(person.name)}</Avatar><Typography variant="body2" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>{person.name}</Typography><Chip size="small" color={person.onShift ? 'warning' : 'default'} label={person.onShift ? 'On shift' : person.alreadyCheckedIn ? 'Checked in' : draft.additions.some(row => row.userId === person.id) ? 'Selected' : person.unlimited ? 'Unlimited' : person.remaining + ' left'} /></Stack></li>} />
    </Stack>}
    <Dialog open={Boolean(correction)} onClose={() => !disabled && setCorrection(null)} fullWidth maxWidth="xs"><DialogTitle>Undo staff entry</DialogTitle><DialogContent><Stack spacing={2}><Typography>Remove {correction?.name} from tonight's attendance when you save the counter. The original entry and correction remain in their history.</Typography><TextField autoFocus required multiline minRows={2} label="Reason for correction" value={correctionReason} inputProps={{ maxLength: 2000 }} onChange={event => setCorrectionReason(event.target.value)} /></Stack></DialogContent><DialogActions><Button disabled={disabled} onClick={() => setCorrection(null)}>Keep entry</Button><Button disabled={disabled || !correctionReason.trim()} color="error" onClick={() => {
      if (!correction) return;
      onDraftChange({ ...draft, additions: draft.additions.filter(row => row.userId !== correction.userId), removals: [...draft.removals.filter(row => row.entryId !== correction.id), { entryId: correction.id, name: correction.name, reason: correctionReason }] }); setCorrection(null);
    }}>Remove entry</Button></DialogActions></Dialog>
  </Box>;
});

export default StaffFreeEntryPanel;
