import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Container,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconClock,
  IconLock,
  IconReceipt,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useParams } from "react-router-dom";
import {
  StaffPayoutReceiptAccessError,
  confirmStaffPayoutReceiptWithAccess,
  exchangeStaffPayoutReceiptAccess,
  getReceiptAccessErrorMessage,
  getStaffPayoutReceiptWithAccess,
  isExpiredReceiptAccessError,
  type ReceiptOnlyPayoutPayload,
} from "../api/staffPayoutReceiptAccess";
import {
  ESignaturePad,
  StaffPayoutReceiptConfirmation,
  type ESignaturePayload,
} from "../components/requiredActions/StaffPayoutReceiptConfirmation";
import { normalizeStaffPayoutReceipt } from "../components/requiredActions/staffPayoutReceiptUtils";

const PayoutReceiptAccessPage = () => {
  const { receiptId: receiptIdParam } = useParams<{ receiptId: string }>();
  const parsedReceiptId = Number(receiptIdParam);
  const receiptId = Number.isInteger(parsedReceiptId) && parsedReceiptId > 0 ? parsedReceiptId : null;
  const accessTokenRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [receipt, setReceipt] = useState<ReceiptOnlyPayoutPayload | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [signature, setSignature] = useState<ESignaturePayload | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  const clearReceiptAccess = useCallback((message?: string) => {
    accessTokenRef.current = null;
    setReceipt(null);
    setExpiresAt(null);
    setSignature(null);
    setSignatureError(null);
    if (message) {
      setError(message);
    }
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Confirm payout receipt | OmniLodge";
    return () => {
      accessTokenRef.current = null;
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    // React Router can reuse this component while only the receipt id changes.
    // Never leave the prior receipt or its capability visible in that case.
    accessTokenRef.current = null;
    setReceipt(null);
    setExpiresAt(null);
    setSignature(null);
    setSignatureError(null);
    setIdentity("");
    setPassword("");
    setError(null);
    setCompleted(false);
  }, [receiptIdParam]);

  useEffect(() => {
    if (!receipt || !expiresAt) {
      return undefined;
    }
    const expiresAtMs = Date.parse(expiresAt);
    const delay = expiresAtMs - Date.now();
    if (!Number.isFinite(expiresAtMs) || delay <= 0) {
      clearReceiptAccess("Your secure access expired. Enter your credentials again to continue.");
      return undefined;
    }
    const timer = window.setTimeout(() => {
      clearReceiptAccess("Your secure access expired. Enter your credentials again to continue.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [clearReceiptAccess, expiresAt, receipt]);

  const handleAccess = async () => {
    const cleanIdentity = identity.trim();
    if (!receiptId) {
      setError("This payout receipt link is invalid. Ask a manager for a new link.");
      return;
    }
    if (!cleanIdentity || !password) {
      setError("Enter your email or username and password.");
      return;
    }

    setAccessLoading(true);
    setError(null);
    setCompleted(false);
    accessTokenRef.current = null;
    try {
      const grant = await exchangeStaffPayoutReceiptAccess({
        receiptId,
        identity: cleanIdentity,
        password,
      });
      if (
        typeof grant.accessToken !== "string" ||
        !grant.accessToken ||
        Number(grant.receiptId) !== receiptId
      ) {
        throw new Error("The server returned an invalid secure access response.");
      }

      accessTokenRef.current = grant.accessToken;
      const response = await getStaffPayoutReceiptWithAccess({
        receiptId,
        accessToken: grant.accessToken,
      });
      const normalizedReceipt = normalizeStaffPayoutReceipt(response.receipt);
      if (!normalizedReceipt || normalizedReceipt.id !== receiptId) {
        throw new Error("The payout receipt details could not be verified.");
      }

      setReceipt(response.receipt);
      setExpiresAt(grant.expiresAt);
      setPassword("");
      setSignature(null);
      setSignatureError(null);
    } catch (accessError) {
      accessTokenRef.current = null;
      setReceipt(null);
      setExpiresAt(null);
      setError(getReceiptAccessErrorMessage(accessError, "Unable to access this payout receipt."));
    } finally {
      setAccessLoading(false);
    }
  };

  const handleConfirm = async (photo: File) => {
    const normalizedReceipt = normalizeStaffPayoutReceipt(receipt ?? undefined);
    if (!receiptId || !normalizedReceipt) {
      clearReceiptAccess("This payout receipt is no longer available. Sign in again to retry.");
      return;
    }
    if (!signature) {
      setSignatureError("Draw your signature before confirming this payment.");
      return;
    }
    const accessToken = accessTokenRef.current;
    if (!accessToken) {
      clearReceiptAccess("Your secure access expired. Enter your credentials again to continue.");
      return;
    }

    setConfirmationLoading(true);
    setError(null);
    try {
      await confirmStaffPayoutReceiptWithAccess({
        receiptId,
        accessToken,
        photo,
        signature,
        acknowledgedAmount: normalizedReceipt.acknowledgedAmount,
        acknowledgedAt: new Date().toISOString(),
      });
      accessTokenRef.current = null;
      setReceipt(null);
      setExpiresAt(null);
      setIdentity("");
      setPassword("");
      setSignature(null);
      setSignatureError(null);
      setCompleted(true);
    } catch (confirmationError) {
      if (
        isExpiredReceiptAccessError(confirmationError) ||
        (confirmationError instanceof StaffPayoutReceiptAccessError && confirmationError.status === 409)
      ) {
        clearReceiptAccess(
          isExpiredReceiptAccessError(confirmationError)
            ? "Your secure access expired. Enter your credentials again to continue."
            : getReceiptAccessErrorMessage(confirmationError, "This payout receipt is no longer pending."),
        );
      } else {
        setError(
          getReceiptAccessErrorMessage(
            confirmationError,
            "Unable to confirm this payout receipt. Your evidence has not been submitted.",
          ),
        );
      }
    } finally {
      setConfirmationLoading(false);
    }
  };

  const expiryLabel = expiresAt && dayjs(expiresAt).isValid()
    ? dayjs(expiresAt).format("HH:mm")
    : null;

  return (
    <Box
      mih="100dvh"
      py="lg"
      style={{
        background:
          "radial-gradient(circle at top, rgba(34, 139, 230, 0.16), transparent 42%), linear-gradient(180deg, #f8fafc 0%, #eef3f8 100%)",
      }}
    >
      <Container size="sm" px="sm">
        <Stack gap="lg">
          <Group justify="center" gap="sm">
            <ThemeIcon size={46} radius={14} variant="gradient" gradient={{ from: "blue", to: "indigo" }}>
              <IconReceipt size={25} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={900} size="lg">OmniLodge</Text>
              <Text size="xs" c="dimmed">Secure payout confirmation</Text>
            </Stack>
          </Group>

          <Card
            withBorder
            radius="xl"
            p="lg"
            shadow="sm"
            style={{ borderColor: "var(--mantine-color-gray-3)" }}
          >
            {completed ? (
              <Center mih={360}>
                <Stack align="center" ta="center" gap="md" maw={440}>
                  <ThemeIcon size={72} radius="xl" color="green" variant="light">
                    <IconCheck size={40} />
                  </ThemeIcon>
                  <Title order={2}>Payment confirmed</Title>
                  <Text c="dimmed">
                    Your photo, e-signature, and confirmation were saved securely. You can close this page.
                  </Text>
                </Stack>
              </Center>
            ) : receipt ? (
              <Stack gap="lg">
                <Stack gap={5} ta="center">
                  <Title order={2}>Confirm payment received</Title>
                  <Text size="sm" c="dimmed">
                    Review the amount, provide photo evidence, and sign below.
                  </Text>
                  {expiryLabel ? (
                    <Group gap={5} justify="center">
                      <IconClock size={14} color="var(--mantine-color-gray-6)" />
                      <Text size="xs" c="dimmed">Secure access expires at {expiryLabel}</Text>
                    </Group>
                  ) : null}
                </Stack>

                {error ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />}>
                    {error}
                  </Alert>
                ) : null}

                <StaffPayoutReceiptConfirmation
                  receipt={receipt}
                  onConfirm={handleConfirm}
                  loading={confirmationLoading}
                  signatureSlot={(
                    <ESignaturePad
                      value={signature}
                      onChange={(nextSignature) => {
                        setSignature(nextSignature);
                        if (nextSignature) {
                          setSignatureError(null);
                        }
                      }}
                      error={signatureError}
                      disabled={confirmationLoading}
                    />
                  )}
                />

                <Button
                  variant="subtle"
                  color="gray"
                  onClick={() => {
                    clearReceiptAccess();
                    setError(null);
                  }}
                  disabled={confirmationLoading}
                >
                  Use a different account
                </Button>
              </Stack>
            ) : (
              <Stack gap="lg" maw={460} mx="auto">
                <Stack gap="xs" ta="center" align="center">
                  <ThemeIcon size={58} radius="xl" color="blue" variant="light">
                    <IconLock size={30} />
                  </ThemeIcon>
                  <Title order={2}>Open payout receipt</Title>
                  <Text c="dimmed" size="sm">
                    Sign in with the account that received this payment. This only grants access to receipt #{receiptIdParam ?? "-"}.
                  </Text>
                </Stack>

                {error ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />}>
                    {error}
                  </Alert>
                ) : null}

                {!receiptId ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />}>
                    This payout receipt link is invalid. Ask a manager for a new link.
                  </Alert>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleAccess();
                    }}
                  >
                    <Stack gap="md">
                      <TextInput
                        label="Email or username"
                        placeholder="Your OmniLodge account"
                        value={identity}
                        onChange={(event) => setIdentity(event.currentTarget.value)}
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        disabled={accessLoading}
                      />
                      <PasswordInput
                        label="Password"
                        value={password}
                        onChange={(event) => setPassword(event.currentTarget.value)}
                        autoComplete="current-password"
                        required
                        disabled={accessLoading}
                      />
                      <Button type="submit" size="lg" fullWidth loading={accessLoading}>
                        {accessLoading ? "Verifying..." : "Continue securely"}
                      </Button>
                    </Stack>
                  </form>
                )}

                <Text size="xs" c="dimmed" ta="center">
                  This page does not sign you into OmniLodge or provide access to schedules, reports, or other staff data.
                </Text>
              </Stack>
            )}
          </Card>
          {accessLoading ? (
            <Center>
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Verifying receipt access...</Text>
              </Group>
            </Center>
          ) : null}
        </Stack>
      </Container>
    </Box>
  );
};

export default PayoutReceiptAccessPage;
