import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";

export type RecoveryOfferSettings = {
  override: { mode: "automatic" | "coupon" | "none"; promotionId: number | null };
  groupSize: number; guestCountMode: "largest_group" | "total_guests"; canEdit: boolean;
  offer: { code: string; amount: number; currency: string; ruleName: string | null; source: string; applyAutomatically: boolean } | null;
  couponOptions: Array<{ value: string; label: string; disabled: boolean }>;
  warnings: string[]; error: string | null;
};
export type RecoveryOfferUpdate = RecoveryOfferSettings["override"] & { reason: string };

export const RecoveryOfferControls = ({ settings, saving, onSave, onDirtyChange }: {
  settings: RecoveryOfferSettings; saving: boolean; onSave: (value: RecoveryOfferUpdate) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const [mode, setMode] = useState(settings.override.mode);
  const [promotionId, setPromotionId] = useState(settings.override.promotionId ? String(settings.override.promotionId) : null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setMode(settings.override.mode);
    setPromotionId(settings.override.promotionId ? String(settings.override.promotionId) : null);
    setReason("");
  }, [settings]);
  const dirty = mode !== settings.override.mode || (mode === "coupon" && Number(promotionId) !== settings.override.promotionId);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  return <Paper withBorder radius="md" p="sm"><Stack gap="sm">
    <Group justify="space-between"><Text fw={600}>Recovery offer</Text><Badge variant="light">{settings.groupSize} guests · {settings.guestCountMode === "largest_group" ? "largest group" : "across experiences"}</Badge></Group>
    {settings.canEdit && <>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select label="Offer for this cart" allowDeselect={false} value={mode} onChange={value => setMode(value as typeof mode)} disabled={saving}
          data={[{ value: "automatic", label: "Use automatic rules" }, { value: "coupon", label: "Choose a specific coupon" }, { value: "none", label: "No new coupon offer" }]} />
        {mode === "coupon" && <Select label="Coupon" placeholder="Choose a coupon" searchable value={promotionId} onChange={setPromotionId} data={settings.couponOptions} disabled={saving} />}
      </SimpleGrid>
      {dirty && <Group align="flex-end"><TextInput style={{ flex: 1 }} label="Reason (optional)" value={reason} maxLength={500} onChange={event => setReason(event.currentTarget.value)} disabled={saving} /><Button loading={saving} disabled={mode === "coupon" && !promotionId} onClick={() => void onSave({ mode, promotionId: mode === "coupon" ? Number(promotionId) : null, reason })}>Save and refresh preview</Button></Group>}
    </>}
    {dirty ? <Text size="sm" c="orange">Save your changes to update the email before sending.</Text>
      : settings.offer ? <Text size="sm"><strong>{settings.offer.code}</strong> · Save {new Intl.NumberFormat("en-GB", { style: "currency", currency: settings.offer.currency }).format(settings.offer.amount)} · {settings.offer.source === "manual" ? "Manual override" : settings.offer.ruleName} · {settings.offer.applyAutomatically ? "Applied through email link" : "Customer enters the code"}</Text>
        : <Text size="sm" c="dimmed">No new coupon will be offered. Existing cart discounts are preserved.</Text>}
    {settings.error && <Alert color="red" title="Choose a different offer before sending">{settings.error}</Alert>}
    {settings.warnings.length > 0 && <Alert color="yellow" title="Automatic rule checks">{settings.warnings.join(" ")}</Alert>}
  </Stack></Paper>;
};
