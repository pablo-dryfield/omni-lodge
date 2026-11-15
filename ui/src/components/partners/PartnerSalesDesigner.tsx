import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Box, Button, Card, Checkbox, Divider, FileButton, Group, Image, Loader, Modal, MultiSelect, SegmentedControl, Select, SimpleGrid, Stack, Switch, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { partnerApi, partnerError, type PartnerOverview, type PartnerSalesPage, type SalesAppearance } from '../../api/partners';

const groups = {
  brand: ['showBrand', 'brandDisplay', 'logoUrl'], powered: ['showPoweredBy', 'poweredByText'], stepper: ['showStepper'],
  eyebrow: ['showEyebrow', 'eyebrow'], title: ['showTitle', 'title'], description: ['showDescription', 'description'],
  count: ['showCount', 'hideSingleCount'], secure: ['showSecureBooking', 'secureBookingText'],
  payment: ['showPaymentTrust', 'paymentTrustText'], email: ['showEmailTrust', 'emailTrustText'], partner: ['showPartnerTrust', 'partnerTrustText'],
  entry: ['entryMode', 'entryProductId'], products: ['productIds'],
} satisfies Record<string, Array<keyof SalesAppearance>>;
type GroupKey = keyof typeof groups;
const serial = (data: PartnerSalesPage) => JSON.stringify({ defaults: data.defaults, links: data.links });
function embedCode(url: string) {
  const frame = new URL(url); frame.searchParams.set('embed', '1');
  return `<iframe data-omnilodge-partner src="${frame.href}" title="Book an experience" width="100%" height="1000" style="border:0;border-radius:16px" allow="payment" loading="lazy"></iframe>\n<script src="${frame.origin}/api/partner-sales/embed.js" async></script>`;
}

export function PartnerSalesDesigner({ overview }: { overview: PartnerOverview }) {
  const [data, setData] = useState<PartnerSalesPage | null>(null), [saved, setSaved] = useState('');
  const [selected, setSelected] = useState('defaults'), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false), [previewSize, setPreviewSize] = useState('desktop');
  const [copied, setCopied] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const id = overview.partner.id, index = selected === 'defaults' ? -1 : Number(selected);
  const link = data && index >= 0 ? data.links[index] : null;
  const overrides = link?.overrides ?? data?.defaults ?? {};
  const inherited = data ? { ...data.systemDefaults, ...data.defaults } : null;
  const appearance = inherited ? { ...inherited, ...overrides } : null;
  const dirty = Boolean(data && serial(data) !== saved);
  useEffect(() => {
    let mounted = true;
    partnerApi.get<PartnerSalesPage>(id, 'sales-page').then(value => { if (mounted) { setData(value); setSaved(serial(value)); } }).catch(e => { if (mounted) setError(partnerError(e)); });
    return () => { mounted = false; };
  }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const previewJson = JSON.stringify(appearance);
  useEffect(() => {
    if (preview && data && frame.current?.contentWindow) frame.current.contentWindow.postMessage({ type: 'omnilodge:partner-preview', appearance: JSON.parse(previewJson) }, new URL(data.url).origin);
  }, [preview, previewJson, data]);
  if (!data || !appearance || !inherited) return <Card withBorder>{error ? <Alert color="red">{error}</Alert> : <Group><Loader size="sm" /><Text>Loading page designer…</Text></Group>}</Card>;

  function patch(value: Partial<SalesAppearance>) {
    setSuccess('');
    setData(current => !current ? current : index < 0 ? { ...current, defaults: { ...current.defaults, ...value } } : { ...current, links: current.links.map((row, i) => i === index ? { ...row, overrides: { ...row.overrides, ...value } } : row) });
  }
  function inherit(group: GroupKey, useDefault: boolean) {
    const next = { ...overrides };
    for (const key of groups[group]) { if (useDefault) delete next[key]; else Object.assign(next, { [key]: appearance![key] }); }
    setData(current => !current ? current : index < 0 ? { ...current, defaults: next } : { ...current, links: current.links.map((row, i) => i === index ? { ...row, overrides: next } : row) });
  }
  function section(group: GroupKey, title: string, children: ReactNode) {
    const usesDefault = index >= 0 && (groups[group] as Array<keyof SalesAppearance>).every(key => !Object.prototype.hasOwnProperty.call(overrides, key));
    return <Card withBorder radius="md" p="md"><Stack gap="sm"><Group justify="space-between"><Text fw={600}>{title}</Text>{index >= 0 && <Checkbox size="xs" label="Use partner default" checked={usesDefault} onChange={event => inherit(group, event.currentTarget.checked)} />}</Group><Box component="fieldset" disabled={usesDefault || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: usesDefault ? 0.6 : 1 }}><Stack gap="sm">{children}</Stack></Box></Stack></Card>;
  }
  function textBlock(group: GroupKey, title: string, visible: keyof SalesAppearance, field: keyof SalesAppearance, multiline = false, help?: string) {
    return section(group, title, <><Switch label={`Show ${title.toLowerCase()}`} checked={Boolean(appearance![visible])} onChange={event => patch({ [visible]: event.currentTarget.checked })} />{multiline ? <Textarea label={`${title} text`} value={String(appearance![field])} onChange={event => patch({ [field]: event.currentTarget.value })} autosize minRows={2} maxRows={5} maxLength={1000} /> : <TextInput label={`${title} text`} value={String(appearance![field])} onChange={event => patch({ [field]: event.currentTarget.value })} maxLength={160} />}{help && <Text size="xs" c="dimmed">{help}</Text>}</>);
  }
  async function save() {
    setBusy(true); setError(''); setSuccess('');
    try {
      const result: PartnerSalesPage = await partnerApi.put(id, 'sales-page', { version: data!.version, defaults: data!.defaults, links: data!.links, reason });
      setData(result); setSaved(serial(result)); setReason(''); setSuccess('Page settings saved. Your booking links and widgets now use this design.');
    } catch (e) { setError(partnerError(e)); } finally { setBusy(false); }
  }
  async function upload(file: File | null) {
    if (!file) return; setUploading(true); setError('');
    try { const result = await partnerApi.uploadLogo(id, file); patch({ logoUrl: result.url, brandDisplay: 'logo', showBrand: true }); }
    catch (e) { setError(partnerError(e)); } finally { setUploading(false); }
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); } catch { setError('Clipboard access is unavailable. Select and copy the link manually.'); }
  }
  const options = overview.catalog.map(product => ({ value: String(product.id), label: product.name }));
  const url = link?.url ?? (index < 0 ? data.url : null);
  const previewUrl = new URL(data.url); previewUrl.searchParams.set('preview', '1');
  const qrUrl = url ? new URL(url) : null;
  if (qrUrl) qrUrl.pathname += '/qr';
  return <Card withBorder radius="lg" p={{ base: 'sm', sm: 'lg' }}><Stack gap="lg">
    <Group justify="space-between"><div><Title order={3}>Booking page designer</Title><Text size="sm" c="dimmed">Your branding, your message, and the right starting point for each link.</Text></div><Badge color={dirty ? 'orange' : 'teal'}>{dirty ? 'Unsaved changes' : 'Saved design'}</Badge></Group>
    {error && <Alert color="red" title="Unable to save changes">{error}</Alert>}{success && <Alert color="teal">{success}</Alert>}
    <Group align="end" grow><Select label="Customize" disabled={busy} value={selected} allowDeselect={false} onChange={value => { setSelected(value ?? 'defaults'); setCopied(''); }} data={[{ value: 'defaults', label: 'Partner defaults · main booking page' }, ...data.links.map((row, i) => ({ value: String(i), label: `${row.name}${row.active ? '' : ' · disabled'}` }))]} /><Button variant="light" style={{ flexGrow: 0 }} disabled={busy || data.links.length >= 50} onClick={() => { setData({ ...data, links: [...data.links, { name: `Booking link ${data.links.length + 1}`, active: true, overrides: {} }] }); setSelected(String(data.links.length)); }}>New link</Button></Group>
    <Text size="sm" c="dimmed">{index < 0 ? 'These settings apply to the main page and are inherited by saved links.' : 'Override only what this link needs. All other settings follow the partner defaults.'}</Text>
    {link && <SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput disabled={busy} label="Link name (internal)" maxLength={100} value={link.name} onChange={event => { const name = event.currentTarget.value; setData({ ...data, links: data.links.map((row, i) => i === index ? { ...row, name } : row) }); }} /><Switch disabled={busy} mt="xl" label="Link enabled" description="Disable to stop customers using this specific link." checked={link.active} onChange={event => { const active = event.currentTarget.checked; setData({ ...data, links: data.links.map((row, i) => i === index ? { ...row, active } : row) }); }} /></SimpleGrid>}
    <Tabs defaultValue="brand" keepMounted={false}><Tabs.List style={{ flexWrap: 'wrap' }}>{[['brand', 'Branding'], ['intro', 'Introduction'], ['catalog', 'Experiences'], ['footer', 'Trust & footer']].map(([value, label]) => <Tabs.Tab value={value} key={value}>{label}</Tabs.Tab>)}</Tabs.List>
      <Tabs.Panel value="brand" pt="md"><SimpleGrid cols={{ base: 1, md: 2 }}>
        {section('brand', 'Partner identity', <><Switch label="Show partner branding" checked={appearance.showBrand} onChange={event => patch({ showBrand: event.currentTarget.checked })} /><Select label="Display" value={appearance.brandDisplay} allowDeselect={false} data={[{ value: 'name', label: 'Partner name' }, { value: 'logo', label: 'Logo instead of name' }, { value: 'both', label: 'Logo and name' }]} onChange={value => patch({ brandDisplay: value as SalesAppearance['brandDisplay'] })} /><TextInput label="Logo URL" placeholder="https://…" value={appearance.logoUrl} onChange={event => patch({ logoUrl: event.currentTarget.value })} maxLength={2048} /><Group justify="center"><FileButton onChange={file => void upload(file)} accept="image/png,image/jpeg,image/webp,image/gif">{props => <Button {...props} variant="light" loading={uploading}>Upload logo</Button>}</FileButton>{appearance.logoUrl && <Button variant="subtle" color="red" onClick={() => patch({ logoUrl: '', brandDisplay: 'name' })}>Remove logo</Button>}</Group>{appearance.logoUrl && <Image src={appearance.logoUrl} alt="Partner logo preview" fit="contain" h={80} maw={260} mx="auto" />}<Text size="xs" c="dimmed">Up to 5 MB. Uploads are optimized to WebP with transparent backgrounds preserved. The partner name is used if no logo is available.</Text></>)}
        <Stack>{textBlock('powered', 'Powered by', 'showPoweredBy', 'poweredByText')}{section('stepper', 'Booking stepper', <Switch label="Show booking steps" checked={appearance.showStepper} onChange={event => patch({ showStepper: event.currentTarget.checked })} />)}</Stack>
      </SimpleGrid></Tabs.Panel>
      <Tabs.Panel value="intro" pt="md"><Stack>{textBlock('eyebrow', 'Small introduction', 'showEyebrow', 'eyebrow')}{textBlock('title', 'Headline', 'showTitle', 'title')}{textBlock('description', 'Introduction description', 'showDescription', 'description', true)}<Text size="xs" c="dimmed">These three elements appear above the experience cards. They are skipped when a link opens the booking form directly.</Text></Stack></Tabs.Panel>
      <Tabs.Panel value="catalog" pt="md"><SimpleGrid cols={{ base: 1, md: 2 }}>
        <Stack>{section('products', 'Experiences on this page', <><Switch label="All approved experiences" checked={appearance.productIds === null} onChange={event => patch({ productIds: event.currentTarget.checked ? null : overview.catalog.map(p => p.id) })} />{appearance.productIds !== null && <MultiSelect label="Visible experiences" data={options} value={appearance.productIds.map(String)} searchable onChange={values => patch({ productIds: values.map(Number) })} description="Only experiences approved in the partner agreement can be selected." />}</>)}
          {section('entry', 'Where customers start', <><Select label="First screen" allowDeselect={false} value={appearance.entryMode} data={[{ value: 'catalog', label: 'Experience selection' }, { value: 'single', label: 'Booking form if only one experience' }, { value: 'product', label: 'Booking form for a specific experience' }]} onChange={value => patch({ entryMode: value as SalesAppearance['entryMode'] })} />{appearance.entryMode === 'product' && <Select label="Experience to open" searchable value={appearance.entryProductId ? String(appearance.entryProductId) : null} data={options.filter(row => appearance.productIds === null || appearance.productIds.includes(Number(row.value)))} onChange={value => patch({ entryProductId: value ? Number(value) : null })} />}<Text size="xs" c="dimmed">The “only one” option uses the experiences currently available on this page. A specific experience opens directly even when the partner offers others.</Text></>)}</Stack>
        <Stack>{section('count', 'Experience count', <><Switch label="Show experience count" checked={appearance.showCount} onChange={event => patch({ showCount: event.currentTarget.checked })} /><Checkbox label="Hide when only one experience is available" checked={appearance.hideSingleCount} onChange={event => patch({ hideSingleCount: event.currentTarget.checked })} /></>)}{textBlock('secure', 'Secure online booking', 'showSecureBooking', 'secureBookingText')}</Stack>
      </SimpleGrid></Tabs.Panel>
      <Tabs.Panel value="footer" pt="md"><Stack>{textBlock('payment', 'Payment reassurance', 'showPaymentTrust', 'paymentTrustText')}{textBlock('email', 'Ticket delivery reassurance', 'showEmailTrust', 'emailTrustText')}{textBlock('partner', 'Partner selection message', 'showPartnerTrust', 'partnerTrustText', false, 'Use {partnerName} to insert the partner’s name automatically.')}</Stack></Tabs.Panel>
    </Tabs>
    <Divider /><Group justify="space-between"><Text size="sm" c="dimmed">Preview your draft at desktop or mobile width.</Text><Button variant="light" onClick={() => setPreview(true)}>Preview draft</Button></Group>
    <SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput disabled={busy} label="Reason for change" placeholder="For example: Walkative website branding" value={reason} onChange={event => setReason(event.currentTarget.value)} maxLength={1000} /><Group align="end" justify="end"><Button variant="subtle" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved page changes and reload the saved design?')) void partnerApi.get<PartnerSalesPage>(id, 'sales-page').then(value => { setData(value); setSaved(serial(value)); setSelected('defaults'); setError(''); }).catch(e => setError(partnerError(e))); }}>Reload saved design</Button><Button loading={busy} disabled={!dirty || !reason.trim() || uploading} onClick={() => void save()}>Save page settings</Button></Group></SimpleGrid>
    {url ? <Card withBorder bg="var(--mantine-color-default-hover)"><Stack gap="sm"><Title order={5}>{index < 0 ? 'Main booking page' : 'Share this saved link'}</Title><TextInput aria-label="Shareable booking link" value={url} readOnly /><Group justify="center" wrap="wrap"><Button size="xs" onClick={() => void copy(url, 'Link copied')}>Copy link</Button><Button size="xs" variant="light" onClick={() => void copy(embedCode(url), 'Widget code copied')}>Copy iframe widget</Button><Button size="xs" variant="subtle" component="a" href={url} target="_blank" rel="noopener noreferrer">Open saved page</Button><Button size="xs" variant="subtle" component="a" href={qrUrl!.href} target="_blank" rel="noopener noreferrer">Open QR code</Button></Group>{copied && <Text size="xs" ta="center" c="teal" role="status">{copied}</Text>}{dirty && <Text size="xs" ta="center" c="orange">Shared links show the saved design. Save your changes when ready.</Text>}</Stack></Card> : <Text size="sm" c="dimmed">Save this new link to generate its booking URL, widget and QR code.</Text>}
    <Modal opened={preview} onClose={() => setPreview(false)} title="Booking page · draft preview" size="90vw"><Stack><Group justify="space-between"><Text size="sm" c="dimmed">Design preview only. Booking and payment submission is disabled.</Text><SegmentedControl size="xs" value={previewSize} onChange={setPreviewSize} data={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]} /></Group><Box style={{ maxWidth: previewSize === 'mobile' ? 390 : '100%', width: '100%', marginInline: 'auto' }}><iframe ref={frame} title="Booking page draft preview" src={previewUrl.href} onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'omnilodge:partner-preview', appearance }, previewUrl.origin)} style={{ width: '100%', height: '72vh', border: '1px solid var(--mantine-color-default-border)', borderRadius: 12 }} /></Box></Stack></Modal>
  </Stack></Card>;
}
