import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconBrowser,
  IconCurrencyZloty,
  IconDeviceFloppy,
  IconFolders,
  IconInfoCircle,
  IconRepeat,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";
import {
  FinanceFormSection,
  FinancePageHeader,
  FinancePanel,
  FinancePrimaryAction,
} from "../../components/finance/FinanceUi";

type FinanceSettingsForm = {
  baseCurrency: string;
  driveFolderId: string;
  autoCreateRecurring: boolean;
  approvalThresholdMinor: number;
};

const STORAGE_KEY = "finance-section-settings";
const DEFAULT_SETTINGS: FinanceSettingsForm = {
  baseCurrency: "PLN",
  driveFolderId: "",
  autoCreateRecurring: true,
  approvalThresholdMinor: 50000,
};

const FinanceSettings = () => {
  const [form, setForm] = useState<FinanceSettingsForm>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<FinanceSettingsForm>;
      setForm({
        baseCurrency:
          typeof parsed.baseCurrency === "string"
            ? parsed.baseCurrency.trim().toUpperCase().slice(0, 3)
            : DEFAULT_SETTINGS.baseCurrency,
        driveFolderId:
          typeof parsed.driveFolderId === "string" ? parsed.driveFolderId : DEFAULT_SETTINGS.driveFolderId,
        autoCreateRecurring:
          typeof parsed.autoCreateRecurring === "boolean"
            ? parsed.autoCreateRecurring
            : DEFAULT_SETTINGS.autoCreateRecurring,
        approvalThresholdMinor:
          typeof parsed.approvalThresholdMinor === "number" && Number.isFinite(parsed.approvalThresholdMinor)
            ? Math.max(0, Math.round(parsed.approvalThresholdMinor))
            : DEFAULT_SETTINGS.approvalThresholdMinor,
      });
    } catch {
      setValidationError("The saved browser settings could not be read. Default values are shown instead.");
    }
  }, []);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) {
        window.clearTimeout(savedTimer.current);
      }
    },
    [],
  );

  const handleSave = () => {
    const normalizedCurrency = form.baseCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setSaved(false);
      setValidationError("Base currency must be a three-letter code, such as PLN, EUR, or USD.");
      return;
    }

    const normalizedForm = { ...form, baseCurrency: normalizedCurrency };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedForm));
    } catch {
      setSaved(false);
      setValidationError("This browser could not save the local finance settings. Check its storage permissions.");
      return;
    }
    setForm(normalizedForm);
    setValidationError(null);
    setSaved(true);
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
    }
    savedTimer.current = window.setTimeout(() => setSaved(false), 2500);
  };

  const approvalThresholdMajor = form.approvalThresholdMinor / 100;
  const currencyLabel = /^[A-Z]{3}$/.test(form.baseCurrency) ? form.baseCurrency : "currency";

  return (
    <Stack gap="lg">
      <FinancePageHeader
        eyebrow="Configuration"
        title="Finance settings"
        description="Set device-specific defaults for this Finance workspace."
        icon={<IconSettings size={24} />}
        actions={
          <FinancePrimaryAction leftSection={<IconDeviceFloppy size={17} />} onClick={handleSave}>
            Save on this device
          </FinancePrimaryAction>
        }
      />

      <Alert
        icon={<IconBrowser size={20} />}
        title="Local browser settings only"
        color="blue"
        variant="light"
        radius="md"
      >
        These values are stored only in this browser on this device. They are not sent to the server, shared with
        other staff, or guaranteed to control backend finance jobs and approval rules.
      </Alert>

      {validationError ? (
        <Alert color="red" variant="light" radius="md" title="Check these settings">
          {validationError}
        </Alert>
      ) : null}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" verticalSpacing="lg">
        <FinancePanel
          title="Reporting defaults"
          description="Local display and review preferences"
          icon={<IconCurrencyZloty size={19} />}
        >
          <Stack gap="xl">
            <FinanceFormSection
              title="Base currency"
              description="Used as the local default when a view does not return its own reporting currency."
              icon={<IconCurrencyZloty size={18} />}
            >
              <TextInput
                label="Three-letter currency code"
                value={form.baseCurrency}
                onChange={(event) => {
                  setSaved(false);
                  setForm((state) => ({
                    ...state,
                    baseCurrency: event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3),
                  }));
                }}
                placeholder="PLN"
                maxLength={3}
                error={
                  form.baseCurrency.length > 0 && form.baseCurrency.length !== 3
                    ? "Enter exactly three letters"
                    : undefined
                }
                autoComplete="off"
              />
            </FinanceFormSection>

            <FinanceFormSection
              title="Approval review threshold"
              description="Displayed in major currency units; the existing local schema remains stored in minor units."
              icon={<IconShieldCheck size={18} />}
            >
              <NumberInput
                label={`Threshold amount (${currencyLabel})`}
                description="Local preference only; this does not enforce the server's approval workflow."
                value={approvalThresholdMajor}
                onChange={(value) => {
                  const majorAmount = typeof value === "number" && Number.isFinite(value) ? value : 0;
                  setSaved(false);
                  setForm((state) => ({
                    ...state,
                    approvalThresholdMinor: Math.max(0, Math.round(majorAmount * 100)),
                  }));
                }}
                min={0}
                decimalScale={2}
                fixedDecimalScale
                thousandSeparator=","
                suffix={` ${currencyLabel}`}
                hideControls
              />
            </FinanceFormSection>
          </Stack>
        </FinancePanel>

        <FinancePanel
          title="Documents & automation"
          description="Reference values saved only on this device"
          icon={<IconFolders size={19} />}
        >
          <Stack gap="xl">
            <FinanceFormSection
              title="Document storage reference"
              description="Keep an optional Google Drive folder identifier in this browser."
              icon={<IconFolders size={18} />}
            >
              <TextInput
                label="Google Drive folder ID"
                description="Saving this value here does not configure or connect Google Drive."
                value={form.driveFolderId}
                onChange={(event) => {
                  setSaved(false);
                  setForm((state) => ({ ...state, driveFolderId: event.currentTarget.value.trimStart() }));
                }}
                placeholder="Optional local reference"
                autoComplete="off"
              />
            </FinanceFormSection>

            <FinanceFormSection
              title="Recurring transaction preference"
              description="Remember how this device should present recurring automation."
              icon={<IconRepeat size={18} />}
            >
              <Switch
                label="Prefer automatic creation from recurring rules"
                description="This local switch does not start, stop, or schedule the backend recurring-rules job."
                checked={form.autoCreateRecurring}
                onChange={(event) => {
                  setSaved(false);
                  setForm((state) => ({ ...state, autoCreateRecurring: event.currentTarget.checked }));
                }}
              />
            </FinanceFormSection>
          </Stack>
        </FinancePanel>
      </SimpleGrid>

      <FinancePanel
        title="Storage scope"
        description="What saving these settings does"
        icon={<IconInfoCircle size={19} />}
      >
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Stack gap={4}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase">
              Location
            </Text>
            <Text size="sm" fw={700}>This browser's local storage</Text>
          </Stack>
          <Stack gap={4}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase">
              Other staff
            </Text>
            <Text size="sm" fw={700}>Not shared</Text>
          </Stack>
          <Stack gap={4}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase">
              Backend enforcement
            </Text>
            <Text size="sm" fw={700}>Not configured by this page</Text>
          </Stack>
        </SimpleGrid>
      </FinancePanel>

      <Group justify="space-between" gap="md" wrap="wrap">
        <Group gap="xs" aria-live="polite">
          <Badge color="orange" variant="light">
            Device-only preferences
          </Badge>
          {saved ? (
            <Badge color="green" variant="light">
              Saved on this device
            </Badge>
          ) : null}
        </Group>
        <Button leftSection={<IconDeviceFloppy size={17} />} onClick={handleSave}>
          Save on this device
        </Button>
      </Group>
    </Stack>
  );
};

export default FinanceSettings;
