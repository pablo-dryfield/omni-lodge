import { useEffect, useState } from "react";
import { Alert, Button, Grid, Group, NumberInput, Stack, Switch, TextInput, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

type FinanceSettingsForm = {
  baseCurrency: string;
  driveFolderId: string;
  autoCreateRecurring: boolean;
  approvalThresholdMinor: number;
};

const STORAGE_KEY = "finance-section-settings";

const FinanceSettings = () => {
  const [form, setForm] = useState<FinanceSettingsForm>({
    baseCurrency: "PLN",
    driveFolderId: "",
    autoCreateRecurring: true,
    approvalThresholdMinor: 50000,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FinanceSettingsForm;
        setForm(parsed);
      } catch {
        // ignore invalid stored data
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Stack gap="lg">
      <Title order={3}>Finance Settings</Title>
      <Alert icon={<IconInfoCircle size={16} />} title="Prototype configuration" color="blue" radius="md">
        These settings are stored locally for now. Connect them to the backend settings API to sync across users.
      </Alert>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput
            label="Base currency"
            description="Default currency for reporting and conversion"
            value={form.baseCurrency}
            onChange={(event) => setForm((state) => ({ ...state, baseCurrency: event.currentTarget.value.toUpperCase() }))}
            maxLength={3}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput
            label="Google Drive folder ID"
            description="Folder used to store invoices and attachments"
            value={form.driveFolderId}
            onChange={(event) => setForm((state) => ({ ...state, driveFolderId: event.currentTarget.value }))}
            placeholder="Optional override"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Switch
            label="Auto-create planned transactions from recurring rules"
            checked={form.autoCreateRecurring}
            onChange={(event) => setForm((state) => ({ ...state, autoCreateRecurring: event.currentTarget.checked }))}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <NumberInput
            label="Approval threshold"
            description="Requests above this amount (in minor units) require management approval"
            value={form.approvalThresholdMinor}
            onChange={(value) =>
              setForm((state) => ({
                ...state,
                approvalThresholdMinor: Number(value) || 0,
              }))
            }
          />
        </Grid.Col>
      </Grid>

      <Group>
        <Button onClick={handleSave}>Save</Button>
        {saved && <Alert color="green">Saved locally</Alert>}
      </Group>
    </Stack>
  );
};

export default FinanceSettings;

