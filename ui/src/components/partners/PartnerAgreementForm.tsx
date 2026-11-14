import { useState } from 'react';
import { Alert, Button, Checkbox, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, TagsInput, Text, Textarea } from '@mantine/core';
import { partnerApi, partnerError, paymentLabel, type PartnerAgreement, type PartnerOverview } from '../../api/partners';

export function AgreementFields({ agreement, setAgreement, products }: { agreement: PartnerAgreement; setAgreement: (value: PartnerAgreement) => void; products: Array<{ id: number; name: string }> }) {
  return <Stack><MultiSelect label="Approved products" searchable clearable value={agreement.productIds.map(String)} data={products.map(p => ({ value: String(p.id), label: p.name }))} onChange={values => setAgreement({ ...agreement, productIds: values.map(Number) })} />
    <SimpleGrid cols={{ base: 1, sm: 3 }}><NumberInput label="Partner commission (%)" description="Share of the discounted customer total, including add-ons." min={0} max={100} decimalScale={2} value={agreement.commissionPercent} onChange={value => setAgreement({ ...agreement, commissionPercent: Number(value) })} /><NumberInput label="Credit limit (PLN)" description="Maximum net amount a collecting partner can owe OmniLodge." min={0} max={1000000} decimalScale={2} value={agreement.creditLimit} onChange={value => setAgreement({ ...agreement, creditLimit: Number(value) })} /><NumberInput label="Change cutoff (hours)" description="Hours before the earliest departure." min={0} max={8760} value={agreement.cancellationHours} onChange={value => setAgreement({ ...agreement, cancellationHours: Number(value) })} /></SimpleGrid>
    <MultiSelect label="Payment arrangements" required value={agreement.paymentModes} data={['platform', 'partner', 'arrival'].map(mode => ({ value: mode, label: paymentLabel(mode) }))} onChange={values => setAgreement({ ...agreement, paymentModes: values })} />
    <SimpleGrid cols={{ base: 1, sm: 2 }}>{(['connectSplit', 'allowCancellation', 'allowAmendment', 'allowRefunds'] as const).map(key => <Checkbox key={key} label={{ connectSplit: 'Automatic Stripe Connect commission', allowCancellation: 'Allow partner cancellations', allowAmendment: 'Allow partner amendments', allowRefunds: 'Allow partner Stripe refunds' }[key]} checked={agreement[key] === true} onChange={e => setAgreement({ ...agreement, [key]: e.currentTarget.checked })} />)}</SimpleGrid>
    <TagsInput label="Websites allowed to embed booking" description="Exact HTTPS origins. Press Enter after each website, for example https://partner.com." value={agreement.allowedOrigins} onChange={values => setAgreement({ ...agreement, allowedOrigins: values })} />
  </Stack>;
}

export function PartnerAgreementForm({ overview, products, onSaved }: { overview: PartnerOverview; products: Array<{ id: number; name: string }>; onSaved: () => void }) {
  const [agreement, setAgreement] = useState(overview.partner.agreement);
  const [status, setStatus] = useState(overview.partner.status);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); partnerApi.put(overview.partner.id, 'agreement', { agreement, status, version: overview.partner.version, reason }).then(onSaved).catch(e => setError(partnerError(e))).finally(() => setBusy(false)); }}><Stack>
    <Text c="dimmed">Channel #{overview.partner.channelId} remains the reporting parent. Changes apply to new bookings; existing bookings keep their saved agreement.</Text>
    <AgreementFields agreement={agreement} setAgreement={setAgreement} products={products} /><Select label="Partner status" value={status} data={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended — block partner access and new sales' }]} onChange={value => setStatus(value || 'active')} />
    <Textarea label="Reason for this change" required value={reason} onChange={e => setReason(e.currentTarget.value)} />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button type="submit" loading={busy}>Save agreement</Button></Group>
  </Stack></form>;
}
