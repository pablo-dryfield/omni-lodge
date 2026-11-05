import { Box, Chip, Stack, Typography } from '@mui/material';
import type { WalkInSummaryRow } from '../../utils/walkInSummary';

export default function WalkInSummaryDetails({ rows }: { rows: WalkInSummaryRow[] }) {
  if (!rows.length) return null;
  const channels = Array.from(new Set(rows.map(row => row.channelId)));
  return <Stack spacing={1.5} aria-label="Walk-Ins ticket details" sx={{ textAlign: 'center' }}>
    {channels.map(id => {
      const tickets = rows.filter(row => row.channelId === id);
      const guests = tickets.reduce((total, row) => total + row.guests, 0);
      return <Box key={id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <Typography fontWeight={700} sx={{ py: 0.75, bgcolor: 'action.hover' }}>{tickets[0].channelName} · {guests} {guests === 1 ? 'guest' : 'guests'}</Typography>
        {tickets.map(row => <Box key={row.key} sx={{ p: 1, '& + &': { borderTop: '1px solid', borderColor: 'divider' }, overflowWrap: 'anywhere' }}>
          <Stack direction="row" justifyContent="center" alignItems="center" gap={0.75} flexWrap="wrap">
            <Typography variant="body2" fontWeight={700}>{row.ticket}</Typography><Chip size="small" label={row.guests ? `${row.guests} ${row.guests === 1 ? 'guest' : 'guests'}` : 'Add-ons only'} />
            {row.amount != null && <Typography variant="body2" fontWeight={600}>{row.amount === 0 ? 'Free' : `${row.currency} ${row.amount.toFixed(2)}`}</Typography>}
          </Stack>
          {row.payment && row.payment !== 'Free' && <Typography variant="caption" color={row.payment.includes('Awaiting') ? 'warning.main' : 'text.secondary'}>{row.payment}</Typography>}
          {row.reason && <Typography variant="body2">Reason: {row.reason}</Typography>}
          {row.addons.map((addon, index) => <Typography key={index} variant="body2" color="text.secondary">{addon.name}: {addon.quantity}{addon.reason ? ` · ${addon.reason}` : ''}</Typography>)}
          {row.staff?.map((person, index) => <Typography key={index} variant="body2">{person.name} · {person.label}{person.reason ? ` · Reason: ${person.reason}` : ''}</Typography>)}
        </Box>)}
      </Box>;
    })}
  </Stack>;
}
