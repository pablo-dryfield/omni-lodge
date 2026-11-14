import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { formatPartnerMoney, partnerApi, partnerError, paymentLabel, type BookingLine, type PartnerBookingInput, type PartnerBookingRow, type PartnerOverview } from '../../api/partners';

export function PartnerBookingForm({ overview, onCreated, amending }: { overview: PartnerOverview; onCreated: () => void; amending?: PartnerBookingRow }) {
  const [customer, setCustomer] = useState({ firstName: amending?.customer.firstName || '', lastName: amending?.customer.lastName || '', email: amending?.customer.email || '', phone: amending?.customer.phone || '' });
  const initialLine = (): BookingLine => { const p = overview.catalog[0]; return { productId: p?.id || 0, quantity: 1, experienceDate: p?.config.availability?.fixedDate || '', experienceTime: p?.config.defaultStartTime || p?.config.startTimes?.[0] || '', options: {} }; };
  const [lines, setLines] = useState<BookingLine[]>(amending?.items.map(line => ({ ...line })) || [initialLine()]);
  const [reference, setReference] = useState(() => crypto.randomUUID());
  const [paymentMode, setPaymentMode] = useState(amending?.paymentMode || overview.partner.agreement.paymentModes[0] || 'platform');
  const [paymentReference, setPaymentReference] = useState('');
  const [requestApproval, setRequestApproval] = useState(false);
  const [discountCode, setDiscountCode] = useState(amending?.discountCode || '');
  const [reason, setReason] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [offeringCode, setOfferingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<{ total: number; items: Array<{ productName: string; total: number; quantity: number }> } | null>(null);
  const [result, setResult] = useState<{ id: number; checkoutUrl?: string; status: string } | null>(null);
  const changed = () => { setQuote(null); setResult(null); setReference(crypto.randomUUID()); };
  const patchLine = (index: number, patch: Partial<BookingLine>) => { changed(); setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line)); };
  const payload = (): PartnerBookingInput => ({ reference, customer, items: lines.map(line => ({ ...line, options: { ...line.options, fullName: `${customer.firstName} ${customer.lastName}`.trim(), email: customer.email, phone: customer.phone } })), paymentMode, paymentReference, requestApproval, discountCode: discountCode || undefined, offeringCode: offeringCode || undefined });
  const submit = async (create: boolean) => {
    setBusy(true); setError('');
    try {
      const input = payload();
      const value = await partnerApi.post<{ total: number; items: Array<{ productName: string; total: number; quantity: number }> }>(overview.partner.id, amending ? `bookings/${amending.id}/amend/quote` : 'quote', input);
      setQuote(value);
      if (create) { setResult(await partnerApi.post(overview.partner.id, amending ? `bookings/${amending.id}/amend` : 'bookings', amending ? { items: input.items, reference, reason, notifyCustomer, discountCode, paymentReference } : input)); onCreated(); }
    } catch (e) { setError(partnerError(e)); } finally { setBusy(false); }
  };
  if (overview.bookingsEnabled === false) return <Alert title="Partner bookings paused">New bookings and amendments are paused. Booking history, refunds and financial reconciliation remain available.</Alert>;
  if (!overview.catalog.length) return <Alert title="No products assigned">Ask a manager to select the experiences this partner can sell.</Alert>;
  return <form onSubmit={e => { e.preventDefault(); void submit(true); }}><Stack gap="md">
    <Group justify="space-between"><div><Title order={3}>{amending ? 'Change your booking' : 'Create a booking'}</Title><Text c="dimmed" size="sm">Live prices and availability. Each experience creates its own manifest entry.</Text></div><Button variant="light" leftSection={<IconPlus size={16} />} disabled={busy || lines.length >= 20} onClick={() => { changed(); setLines([...lines, initialLine()]); }}>Experience</Button></Group>
    {!amending && <Select clearable label="Package or referral voucher" placeholder="Individual experiences" value={offeringCode} data={overview.offerings.filter(o => o.active).map(o => ({ value: o.code, label: `${o.name} · ${o.kind}` }))} onChange={value => { changed(); setOfferingCode(value); const offering = overview.offerings.find(o => o.code === value); if (offering?.kind === 'package') setLines(offering.items.map(item => ({ ...initialLine(), ...item }))); }} />}
    {lines.map((line, index) => { const product = overview.catalog.find(p => p.id === line.productId); const times = product?.config.startTimes?.length ? product.config.startTimes : product?.config.defaultStartTime ? [product.config.defaultStartTime] : [];
      const participants = (line.options?.participants || {}) as { men?: number; women?: number };
      return <Card key={index} withBorder radius="md" bg={index % 2 ? 'gray.0' : 'blue.0'}><Stack gap="sm"><Group justify="space-between"><Text fw={700}>Experience {index + 1}</Text>{lines.length > 1 && <Button size="compact-sm" variant="subtle" color="red" aria-label={`Remove experience ${index + 1}`} onClick={() => { changed(); setLines(lines.filter((_, i) => i !== index)); }}><IconTrash size={16} /></Button>}</Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}><Select required label="Product" value={String(line.productId)} data={overview.catalog.map(p => ({ value: String(p.id), label: p.name }))} onChange={value => { const p = overview.catalog.find(p => p.id === Number(value)); patchLine(index, { productId: Number(value), experienceTime: p?.config.defaultStartTime || p?.config.startTimes?.[0] || '', experienceDate: p?.config.availability?.fixedDate || line.experienceDate, addons: [], options: {} }); }} /><TextInput required type="date" label="Experience date" value={line.experienceDate} onChange={e => patchLine(index, { experienceDate: e.currentTarget.value })} />{times.length ? <Select required label="Start time" value={line.experienceTime} data={times} onChange={value => patchLine(index, { experienceTime: value || '' })} /> : <TextInput required type="time" label="Start time" value={line.experienceTime} onChange={e => patchLine(index, { experienceTime: e.currentTarget.value })} />}<NumberInput readOnly={product?.config.participantMode === 'gender_split'} required label="Guests" min={product?.config.minParticipants || 1} max={product?.config.maxParticipants || 100} allowDecimal={false} value={line.quantity} onChange={value => patchLine(index, { quantity: Number(value) })} /></SimpleGrid>
        {product?.config.participantMode === 'gender_split' && <SimpleGrid cols={2}><NumberInput label="Men" min={0} allowDecimal={false} value={participants.men || 0} onChange={value => patchLine(index, { options: { ...line.options, participants: { men: Number(value), women: participants.women || 0 } }, quantity: Number(value) + (participants.women || 0) })} /><NumberInput label="Women" min={0} allowDecimal={false} value={participants.women || 0} onChange={value => patchLine(index, { options: { ...line.options, participants: { men: participants.men || 0, women: Number(value) } }, quantity: Number(value) + (participants.men || 0) })} /></SimpleGrid>}
        {!!product?.addons.length && <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>{product.addons.map(addon => {
          const current = line.addons?.find(a => a.addonId === addon.id);
          if (addon.inventory.variantSelectionRequired) return <Card key={addon.id} withBorder padding="sm"><Text fw={600} size="sm">{addon.name}{addon.price ? ` - ${formatPartnerMoney(addon.price.amount)} each` : ''}</Text><SimpleGrid cols={2} mt="xs">{addon.inventory.variants.filter(variant => variant.inStock || current?.variants?.some(value => value.value === variant.value)).map(variant => <NumberInput key={variant.value} label={variant.label} min={0} allowDecimal={false} value={current?.variants?.find(value => value.value === variant.value)?.quantity || 0} onChange={value => {
            const variants = [...(current?.variants || []).filter(entry => entry.value !== variant.value), ...(Number(value) > 0 ? [{ value: variant.value, quantity: Number(value) }] : [])];
            const quantity = variants.reduce((sum, entry) => sum + entry.quantity, 0);
            patchLine(index, { addons: [...(line.addons || []).filter(entry => entry.addonId !== addon.id), ...(quantity ? [{ addonId: addon.id, quantity, variants }] : [])] });
          }} />)}</SimpleGrid></Card>;
          const update = (value: number, option?: string) => patchLine(index, { addons: [...(line.addons || []).filter(a => a.addonId !== addon.id), ...(value > 0 ? [{ addonId: addon.id, quantity: value, ...(option ? addon.inventory.variantSelectionRequired ? { variants: [{ value: option, quantity: value }] } : { value: option } : {}) }] : [])] });
          return <Stack gap={4} key={addon.id}><NumberInput label={`${addon.name}${addon.price ? ` · ${formatPartnerMoney(addon.price.amount)}` : ''}`} min={0} allowDecimal={false} max={line.quantity * 10} value={current?.quantity || 0} onChange={value => update(Number(value), current?.value || current?.variants?.[0]?.value)} />{(addon.inventory.variantSelectionRequired || addon.config.selectionMode === 'options') && !!current?.quantity && <Select label={`${addon.name} option`} required value={current.value || current.variants?.[0]?.value || null} data={(addon.config.options || addon.inventory.variants.filter(v => v.inStock)).map(v => ({ value: v.value, label: v.label }))} onChange={value => update(current.quantity, value || undefined)} />}</Stack>;
        })}</SimpleGrid>}
        {product?.config.content?.meetingPoint?.name && <Text c="dimmed" size="sm" ta="center">Meeting point: {product.config.content.meetingPoint.name}</Text>}
      </Stack></Card>;
    })}
    {!amending && <SimpleGrid cols={{ base: 1, sm: 2 }}>{(['firstName', 'lastName', 'email', 'phone'] as const).map(key => <TextInput key={key} required={key !== 'phone'} type={key === 'email' ? 'email' : 'text'} label={{ firstName: 'First name', lastName: 'Last name', email: 'Customer email', phone: 'Phone (optional)' }[key]} value={customer[key]} onChange={e => { changed(); setCustomer({ ...customer, [key]: e.currentTarget.value }); }} />)}<Select label="Payment arrangement" required value={paymentMode} data={overview.partner.agreement.paymentModes.map(mode => ({ value: mode, label: paymentLabel(mode) }))} onChange={value => { changed(); setPaymentMode(value || 'platform'); }} /></SimpleGrid>}
    <TextInput label="Discount code (optional)" value={discountCode} onChange={e => { changed(); setDiscountCode(e.currentTarget.value); }} />
    {paymentMode !== 'platform' && (paymentMode === 'partner' || amending) && <TextInput label={amending ? 'Verified external collection / refund receipt (operations only)' : 'Partner receipt / payment reference'} required={!amending} value={paymentReference} onChange={e => { changed(); setPaymentReference(e.currentTarget.value); }} />}
    {!amending && <Checkbox label="Submit as a group request for management approval" checked={requestApproval} onChange={e => { changed(); setRequestApproval(e.currentTarget.checked); }} />}
    {amending && <><Alert>Extra Stripe payment opens a secure payment link. Your existing booking stays until payment and availability are verified. Lower prices refund the difference automatically. Payments collected outside Stripe require a verified receipt from operations.</Alert><Textarea label="Reason for amendment" required value={reason} onChange={e => setReason(e.currentTarget.value)} /><Checkbox label="Notify the customer by email" checked={notifyCustomer} onChange={e => setNotifyCustomer(e.currentTarget.checked)} /></>}
    {!amending && paymentMode === 'partner' && <Alert color="blue">The customer paid your company. The net amount remains payable to OmniLodge until a settlement is recorded.</Alert>}
    {error && <Alert color="red" title="Booking not submitted">{error}</Alert>}
    {quote && <Card withBorder ta="center"><Text c="dimmed">{amending ? 'Updated experience total' : 'Customer total'}</Text><Title order={2}>{formatPartnerMoney(quote.total)}</Title>{quote.items.map((item, i) => <Text key={i} size="sm">{item.productName} · {item.quantity} guests · {formatPartnerMoney(item.total)}</Text>)}</Card>}
    {result && <Alert color="green" title={amending ? 'Amendment submitted' : result.status === 'requested' ? 'Request submitted' : 'Booking created'}><Text>Reference: {reference}</Text>{result.checkoutUrl && <Group mt="xs"><Button component="a" href={result.checkoutUrl} target="_blank" rel="noopener noreferrer" size="xs">Open customer payment</Button><Button size="xs" variant="light" onClick={() => void navigator.clipboard.writeText(result.checkoutUrl!)}>Copy payment link</Button></Group>}</Alert>}
    <Group justify="flex-end"><Button variant="default" loading={busy} onClick={() => void submit(false)}>Check price</Button><Button type="submit" loading={busy} disabled={!!result}>{amending ? 'Confirm amendment' : requestApproval ? 'Submit group request' : paymentMode === 'platform' ? 'Create payment link' : 'Confirm booking'}</Button></Group>
  </Stack></form>;
}
