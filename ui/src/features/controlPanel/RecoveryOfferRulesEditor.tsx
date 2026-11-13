import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Button, Group, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react";
import axiosInstance from "../../utils/axiosInstance";

type Rule = { id: string; name: string; enabled: boolean; minGuests: number; promotionId: number };
type Rules = { guestCountMode: "largest_group" | "total_guests"; applyAutomatically: boolean; rules: Rule[] };
type Coupon = { value: string; label: string; disabled: boolean };
type Props = { value: string; onChange: (value: string) => void; onError: (error: string | null) => void };
const defaults: Rules = { guestCountMode: "largest_group", applyAutomatically: true, rules: [] };

export const RecoveryOfferRulesEditor = ({ value, onChange, onError }: Props) => {
  const [view, setView] = useState("form");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError("");
    axiosInstance.get<{ data: Coupon[] }>("/storefront-ongoing-carts/recovery-coupons")
      .then(response => { if (active) setCoupons(response.data.data); })
      .catch(() => { if (active) setLoadError("Could not load coupons. Try again before saving rules."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  const parsed = useMemo(() => {
    try {
      const result = value.trim() ? JSON.parse(value) : defaults;
      if (!result || typeof result !== "object" || !Array.isArray(result.rules)
        || !["largest_group", "total_guests"].includes(result.guestCountMode)
        || typeof result.applyAutomatically !== "boolean" || result.rules.some((rule: unknown) => !rule || typeof rule !== "object")) {
        throw new Error("Use an object containing guestCountMode, applyAutomatically and a rules array.");
      }
      return { data: result as Rules, error: null };
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : "Invalid recovery rules." }; }
  }, [value]);
  const validationError = useMemo(() => {
    if (parsed.error) return parsed.error;
    if (loadError) return loadError;
    const rules = parsed.data!.rules;
    if (rules.length > 25) return "Use up to 25 recovery rules.";
    const ids = new Set<string>();
    for (const rule of rules) {
      if (typeof rule.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(rule.id) || ids.has(rule.id)) return "Each rule needs a unique ID.";
      ids.add(rule.id);
      if (typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 120) return "Give every rule a name of up to 120 characters.";
      if (typeof rule.enabled !== "boolean") return "Each rule must be enabled or disabled.";
      if (!Number.isSafeInteger(rule.minGuests) || rule.minGuests < 1 || rule.minGuests > 10000) return "Minimum guests must be between 1 and 10,000.";
      if (!Number.isSafeInteger(rule.promotionId) || rule.promotionId <= 0) return "Select a coupon for every rule.";
      if (rule.enabled && !loading && !coupons.some(coupon => coupon.value === String(rule.promotionId) && !coupon.disabled)) return "An enabled rule has an unavailable coupon. Choose an active coupon or disable that rule.";
    }
    return null;
  }, [parsed, coupons, loading, loadError]);
  useEffect(() => { onError(validationError); }, [validationError, onError]);
  const update = (next: Rules) => onChange(JSON.stringify(next, null, 2));
  const patchRule = (index: number, patch: Partial<Rule>) => {
    if (parsed.data) update({ ...parsed.data, rules: parsed.data.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) });
  };
  const move = (index: number, delta: number) => {
    if (!parsed.data) return;
    const rules = [...parsed.data.rules];
    [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]];
    update({ ...parsed.data, rules });
  };
  return <Stack gap="md">
    <SegmentedControl value={view} onChange={setView} data={[{ value: "form", label: "Offer rules" }, { value: "json", label: "Advanced JSON" }]} />
    <Text size="sm" c="dimmed">Rules run from top to bottom. The first eligible coupon that improves the cart total is offered. A cart override takes priority. These rules choose who receives an offer; the coupon retains its own checkout conditions.</Text>
    {loadError && <Alert color="red">{loadError}<Button size="xs" variant="subtle" onClick={() => setRetry(n => n + 1)}>Retry</Button></Alert>}
    {view === "json" || !parsed.data ? <Textarea label="Recovery offer rules JSON" autosize minRows={12} maxRows={25} value={value} onChange={event => onChange(event.currentTarget.value)} error={parsed.error} styles={{ input: { fontFamily: "monospace" } }} /> : <>
      <Select label="Count guests by" value={parsed.data.guestCountMode} allowDeselect={false} data={[{ value: "largest_group", label: "Largest group on one experience" }, { value: "total_guests", label: "Total guests across all experiences" }]} onChange={mode => update({ ...parsed.data!, guestCountMode: mode as Rules["guestCountMode"] })} />
      <Switch label="Apply the offered coupon when the email link is opened" description="When disabled, the email shows the code for the customer to enter." checked={parsed.data.applyAutomatically} onChange={event => update({ ...parsed.data!, applyAutomatically: event.currentTarget.checked })} />
      {!parsed.data.rules.length && <Paper withBorder p="md" ta="center"><Text>No automatic offers. Add a rule to get started.</Text></Paper>}
      {parsed.data.rules.map((rule, index) => <Paper key={rule.id} withBorder p="md" radius="md"><Stack gap="sm">
        <Group justify="space-between"><Text fw={600}>Rule {index + 1}</Text><Group gap={4}>
          <ActionIcon variant="subtle" aria-label={`Move rule ${index + 1} up`} disabled={!index} onClick={() => move(index, -1)}><IconArrowUp size={16} /></ActionIcon>
          <ActionIcon variant="subtle" aria-label={`Move rule ${index + 1} down`} disabled={index === parsed.data!.rules.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={16} /></ActionIcon>
          <ActionIcon variant="subtle" color="red" aria-label={`Remove rule ${index + 1}`} onClick={() => update({ ...parsed.data!, rules: parsed.data!.rules.filter((_, i) => i !== index) })}><IconTrash size={16} /></ActionIcon>
        </Group></Group>
        <TextInput label="Rule name" value={rule.name} maxLength={120} onChange={event => patchRule(index, { name: event.currentTarget.value })} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label="Minimum guests" description="Inclusive: 9 means more than 8 people." min={1} max={10000} allowDecimal={false} value={rule.minGuests || ""} onChange={count => patchRule(index, { minGuests: Number(count) })} />
          <Select label="Coupon to offer" placeholder={loading ? "Loading coupons..." : "Choose an existing coupon"} searchable data={coupons} value={rule.promotionId ? String(rule.promotionId) : null} onChange={id => patchRule(index, { promotionId: Number(id) })} />
        </SimpleGrid>
        <Switch label="Rule enabled" checked={rule.enabled} onChange={event => patchRule(index, { enabled: event.currentTarget.checked })} />
      </Stack></Paper>)}
      <Button variant="light" leftSection={<IconPlus size={16} />} disabled={parsed.data.rules.length >= 25} onClick={() => update({ ...parsed.data!, rules: [...parsed.data!.rules, { id: crypto.randomUUID(), name: "Group recovery offer", enabled: true, minGuests: 9, promotionId: 0 }] })}>Add rule</Button>
      {validationError && <Text c="red" size="sm">{validationError}</Text>}
    </>}
  </Stack>;
};
