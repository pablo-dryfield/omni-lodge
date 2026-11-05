import { useEffect, useState } from 'react';
import { Accordion, ActionIcon, Alert, Badge, Button, Group, Paper, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconTicket } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfigEntry, useUpdateConfigEntry } from '../../api/config';
import { WALK_IN_TICKET_CONFIG_KEY, WalkInTicketDefinition } from '../../api/walkInTickets';

export default function WalkInTicketSettings() {
  const config = useConfigEntry(WALK_IN_TICKET_CONFIG_KEY);
  const save = useUpdateConfigEntry();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Array<WalkInTicketDefinition & { idLocked?: boolean }>>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!config.data || dirty) return;
    try {
      const values = JSON.parse(config.data.value ?? config.data.defaultValue ?? '[]') as WalkInTicketDefinition[];
      setRows(values.map(row => ({ ...row, idLocked: true })));
    } catch { setError('Unable to read ticket configuration. Open Control Panel to inspect it.'); }
  }, [config.data, dirty]);
  const change = (next: Array<WalkInTicketDefinition & { idLocked?: boolean }>) => { setRows(next); setDirty(true); setSaved(false); };
  const move = (index: number, direction: number) => {
    const next = [...rows]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; change(next);
  };
  return <Accordion variant="separated" radius="lg">
    <Accordion.Item value="walk-in-tickets">
      <Accordion.Control icon={<IconTicket size={22} />}><Text fw={600}>Walk-Ins ticket types</Text><Text size="sm" c="dimmed">Name, order and enable the tickets your team can sell.</Text></Accordion.Control>
      <Accordion.Panel><Stack gap="md">
        <Text size="sm">Set the price for each channel, product, currency and date in the table below. Custom and Free are always available. Staff Free appears under Walk-In for eligible products and uses the staff allowance rules. Disabling a type keeps existing counter records.</Text>
        {config.isLoading && <Text size="sm">Loading ticket settings…</Text>}
        {config.isError && <Alert color="orange">Administrator access to Control Panel is required to edit ticket types.</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        {saved && <Alert color="green">Ticket types saved. Reload open counters to use the updated list.</Alert>}
        {rows.map((row, index) => <Paper key={index} withBorder radius="md" p="md"><Group align="end" wrap="wrap">
          <TextInput label="Ticket name" value={row.name} maxLength={60} style={{ flex: '2 1 180px' }} onChange={(e) => change(rows.map((r, i) => i === index ? { ...r, name: e.currentTarget.value } : r))} />
          <TextInput label="Permanent ID" description="Used to link prices and history" value={row.id} disabled={Boolean(row.idLocked)} style={{ flex: '1 1 150px' }} onChange={(e) => change(rows.map((r, i) => i === index ? { ...r, id: e.currentTarget.value } : r))} />
          <Switch label="Available" checked={row.enabled} onChange={(e) => change(rows.map((r, i) => i === index ? { ...r, enabled: e.currentTarget.checked } : r))} mb={8} />
          <Group gap={4} mb={4}><ActionIcon aria-label={`Move ${row.name} up`} variant="light" disabled={index === 0} onClick={() => move(index, -1)}><IconArrowUp size={16} /></ActionIcon><ActionIcon aria-label={`Move ${row.name} down`} variant="light" disabled={index === rows.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={16} /></ActionIcon></Group>
        </Group></Paper>)}
        <Group><Button variant="light" leftSection={<IconPlus size={16} />} disabled={!config.data || rows.length >= 50} onClick={() => change([...rows, { id: '', name: '', enabled: true }])}>Add ticket type</Button><Badge variant="light">Custom · built in</Badge><Badge color="green" variant="light">Free · built in</Badge></Group>
        <TextInput label="Reason for change (optional)" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <Group justify="flex-end"><Button loading={save.isPending} disabled={!dirty || !config.data?.isEditable} onClick={async () => {
          setError('');
          try {
            await save.mutateAsync({ key: WALK_IN_TICKET_CONFIG_KEY, value: rows.map(({ id, name, enabled }) => ({ id, name, enabled })), reason });
            await queryClient.invalidateQueries({ queryKey: ['walk-in-ticket-types'] });
            await config.refetch(); setDirty(false); setSaved(true);
          } catch (err: any) { setError(err.response?.data?.[0]?.message ?? err.message ?? 'Unable to save ticket types.'); }
        }}>Save ticket types</Button></Group>
      </Stack></Accordion.Panel>
    </Accordion.Item>
  </Accordion>;
}
