import { Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { formatPartnerMoney, partnerCommissionRule, type PartnerAgreement, type PartnerCommissionRule } from '../../api/partners';

function RuleFields({ rule, onChange, label }: { rule: PartnerCommissionRule; onChange: (rule: PartnerCommissionRule) => void; label: string }) {
  return <Stack gap="xs"><SimpleGrid cols={{ base: 1, sm: 3 }}>
    <Select label={`${label} type`} allowDeselect={false} value={rule.type}
      data={[{ value: 'fixed', label: 'Fixed amount' }, { value: 'percentage', label: 'Percentage' }]}
      onChange={value => onChange({ ...rule, type: value as PartnerCommissionRule['type'], value: value === 'percentage' ? Math.min(rule.value, 100) : rule.value })} />
    <Select label={`${label} basis`} allowDeselect={false} value={rule.basis}
      data={[{ value: 'person', label: 'Per guest place' }, { value: 'experience', label: 'Per experience' }, { value: 'booking', label: 'Per booking' }]}
      onChange={value => onChange({ ...rule, basis: value as PartnerCommissionRule['basis'] })} />
    <NumberInput label={`${label} rate (${rule.type === 'fixed' ? 'PLN' : '%'})`} min={0} max={rule.type === 'fixed' ? 1000000 : 100} decimalScale={2}
      value={rule.value} onChange={value => onChange({ ...rule, value: Number(value) })} />
  </SimpleGrid><Text size="xs" c="dimmed">{rule.type === 'percentage'
    ? `${rule.value}% of the discounted customer price, including add-ons. A uniform percentage gives the same total across the three bases.`
    : rule.basis === 'person' ? `${formatPartnerMoney(rule.value)} for each guest place on each experience.`
    : rule.basis === 'experience' ? `${formatPartnerMoney(rule.value)} for each distinct product, date and start time.`
    : `${formatPartnerMoney(rule.value)} once for the booking's products using this rule.`}</Text></Stack>;
}

export function PartnerCommissionFields({ agreement, onChange, products }: { agreement: PartnerAgreement; onChange: (agreement: PartnerAgreement) => void; products: Array<{ id: number; name: string }> }) {
  const rule = partnerCommissionRule(agreement);
  const overrides = agreement.productCommissions ?? [];
  const approved = products.filter(product => agreement.productIds.includes(product.id));
  const available = approved.filter(product => !overrides.some(entry => entry.productId === product.id));
  return <Stack>
    <Card withBorder radius="md"><Stack gap="sm"><Title order={4}>Default commission</Title>
      <RuleFields label="Default commission" rule={rule} onChange={next => onChange({ ...agreement, commissionRule: next, commissionPercent: next.type === 'percentage' ? next.value : 0 })} />
      <Text size="xs" c="dimmed">For example, 4 guests on 2 different experiences create 8 guest places, 2 experiences and 1 booking. Repeated lines for the same departure count as one experience.</Text>
    </Stack></Card>
    <Card withBorder radius="md"><Stack gap="sm"><Title order={4}>Product-specific rules</Title>
      <Text size="sm" c="dimmed">Products without an override use the default commission. A per-booking product override applies once across that product's experiences in the booking.</Text>
      {overrides.map((entry, index) => <Card key={entry.productId} withBorder radius="sm"><Stack gap="xs">
        <Group align="end" wrap="wrap"><Select label="Override product" style={{ flex: 1, minWidth: 180 }} allowDeselect={false} searchable value={String(entry.productId)}
          data={approved.filter(product => product.id === entry.productId || !overrides.some(value => value.productId === product.id)).map(product => ({ value: String(product.id), label: product.name }))}
          onChange={value => onChange({ ...agreement, productCommissions: overrides.map((item, i) => i === index ? { ...item, productId: Number(value) } : item) })} />
          <Button color="red" variant="light" leftSection={<IconTrash size={14} />} aria-label={`Remove commission override for ${products.find(product => product.id === entry.productId)?.name ?? entry.productId}`}
            onClick={() => onChange({ ...agreement, productCommissions: overrides.filter((_, i) => i !== index) })}>Remove</Button></Group>
        <RuleFields label={products.find(product => product.id === entry.productId)?.name ?? 'Product commission'} rule={entry.rule}
          onChange={next => onChange({ ...agreement, productCommissions: overrides.map((item, i) => i === index ? { ...item, rule: next } : item) })} />
      </Stack></Card>)}
      <Button variant="light" leftSection={<IconPlus size={14} />} disabled={!available.length}
        onClick={() => onChange({ ...agreement, productCommissions: [...overrides, { productId: available[0].id, rule: { ...rule } }] })}>Add product rule</Button>
      {!approved.length && <Text size="xs" c="dimmed">Select approved products above to add their commission rules.</Text>}
    </Stack></Card>
    <Text size="sm" c="dimmed">Fixed commissions stay payable after amount-only refunds. Amend the guest places or experiences, or cancel the booking, to recalculate them. Percentage commissions follow the remaining customer payment. Existing bookings retain their saved agreement.</Text>
  </Stack>;
}
