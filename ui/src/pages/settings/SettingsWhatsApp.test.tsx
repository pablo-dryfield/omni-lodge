import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  completeWhatsAppEmbeddedSignup,
  fetchWhatsAppAdminStatus,
  fetchWhatsAppOutboundTemplates,
  prepareWhatsAppEmbeddedSignup,
  repairWhatsAppWebhookSubscription,
  sendWhatsAppTemplateMessage,
  type WhatsAppAdminStatus,
} from "../../api/whatsappAdmin";
import {
  loadMetaFacebookSdk,
  META_WHATSAPP_EMBEDDED_SIGNUP_VERSION,
  META_WHATSAPP_SESSION_INFO_VERSION,
  META_WHATSAPP_SESSION_INFO_VERSION_PARAMETER,
  META_WHATSAPP_SIGNUP_FEATURE,
  META_WHATSAPP_SIGNUP_FINISH_EVENT,
  META_WHATSAPP_SIGNUP_TYPE,
} from "../../utils/metaWhatsAppSignup";
import SettingsWhatsApp, {
  getWhatsAppConfirmationTimeoutMessage,
  getWhatsAppPairingWaitMs,
} from "./SettingsWhatsApp";

jest.mock("../../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../../api/whatsappAdmin", () => ({
  WHATSAPP_ADMIN_STATUS_QUERY_KEY: ["whatsapp-admin-status"],
  WHATSAPP_OUTBOUND_TEMPLATES_QUERY_KEY: ["whatsapp-outbound-templates"],
  fetchWhatsAppAdminStatus: jest.fn(),
  fetchWhatsAppOutboundTemplates: jest.fn(),
  prepareWhatsAppEmbeddedSignup: jest.fn(),
  completeWhatsAppEmbeddedSignup: jest.fn(),
  repairWhatsAppWebhookSubscription: jest.fn(),
  sendWhatsAppTemplateMessage: jest.fn(),
}));

jest.mock("../../utils/metaWhatsAppSignup", () => {
  const actual = jest.requireActual("../../utils/metaWhatsAppSignup");
  return {
    ...actual,
    loadMetaFacebookSdk: jest.fn(),
  };
});

const mockFetchStatus = fetchWhatsAppAdminStatus as jest.MockedFunction<typeof fetchWhatsAppAdminStatus>;
const mockFetchTemplates = fetchWhatsAppOutboundTemplates as jest.MockedFunction<typeof fetchWhatsAppOutboundTemplates>;
const mockPrepare = prepareWhatsAppEmbeddedSignup as jest.MockedFunction<typeof prepareWhatsAppEmbeddedSignup>;
const mockComplete = completeWhatsAppEmbeddedSignup as jest.MockedFunction<typeof completeWhatsAppEmbeddedSignup>;
const mockRepairSubscription = repairWhatsAppWebhookSubscription as jest.MockedFunction<typeof repairWhatsAppWebhookSubscription>;
const mockSendTemplate = sendWhatsAppTemplateMessage as jest.MockedFunction<typeof sendWhatsAppTemplateMessage>;
const mockLoadSdk = loadMetaFacebookSdk as jest.MockedFunction<typeof loadMetaFacebookSdk>;

const unavailableStatus: WhatsAppAdminStatus = {
  available: false,
  connectionStatus: "unavailable",
  webhookSubscriptionStatus: "unknown",
  coexistenceVerified: false,
  launchConfigured: true,
  webhookVerifyTokenConfigured: true,
  metaAppSecretConfigured: true,
  tokenConfigured: false,
  wabaConfigured: false,
  phoneNumberConfigured: false,
  wabaId: null,
  phoneNumberId: null,
  latestAttemptId: null,
  onboardingStatus: "not_started",
  appStateSyncStatus: "not_started",
  historyDispatchStatus: "not_started",
  historySyncStatus: "not_started",
  recoveryRequired: false,
  lastErrorCode: null,
  updatedAt: null,
};

const connectedStatus: WhatsAppAdminStatus = {
  ...unavailableStatus,
  available: true,
  connectionStatus: "connected",
  webhookSubscriptionStatus: "verified",
  coexistenceVerified: true,
  tokenConfigured: true,
  wabaConfigured: true,
  phoneNumberConfigured: true,
  wabaId: "123456789012345",
  phoneNumberId: "987654321098765",
  latestAttemptId: "attempt-1",
  onboardingStatus: "complete",
  appStateSyncStatus: "requested",
  historyDispatchStatus: "requested",
  historySyncStatus: "requested",
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <SettingsWhatsApp />
      </MantineProvider>
    </QueryClientProvider>,
  );
};

describe("SettingsWhatsApp", () => {
  let loginCallback: ((response: MetaFacebookLoginResponse) => void) | null;
  let sdk: MetaFacebookSdk;

  beforeEach(() => {
    Object.defineProperty(global, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class ResizeObserverMock {
        observe = jest.fn();
        unobserve = jest.fn();
        disconnect = jest.fn();
      },
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    loginCallback = null;
    sdk = {
      init: jest.fn(),
      login: jest.fn((callback) => {
        loginCallback = callback;
      }),
    };
    mockFetchStatus.mockResolvedValue(unavailableStatus);
    mockPrepare.mockResolvedValue({
      id: "attempt-1",
      nonce: "nonce-1",
      expiresAt: "2099-08-27T08:00:00.000Z",
      launch: {
        appId: "111222333",
        configId: "444555666",
        graphApiVersion: "v25.0",
      },
    });
    mockLoadSdk.mockResolvedValue(sdk);
    mockComplete.mockResolvedValue(connectedStatus);
    mockRepairSubscription.mockResolvedValue({ repaired: true, status: connectedStatus });
    mockFetchTemplates.mockResolvedValue([
      { name: "hello_world", language: "en_US", category: "UTILITY" },
    ]);
    mockSendTemplate.mockResolvedValue({ messageId: "wamid.accepted-message-1" });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("launches from a second user click and posts paired completion signals only once", async () => {
    renderPage();
    await screen.findByText("unavailable");

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare connection" }));

    await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("admin-password", false));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Meta" })).toBeEnabled());
    expect(sdk.login).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Meta" }));
    expect(sdk.login).toHaveBeenCalledWith(expect.any(Function), {
      config_id: "444555666",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: META_WHATSAPP_SIGNUP_FEATURE,
        sessionInfoVersion: META_WHATSAPP_SESSION_INFO_VERSION_PARAMETER,
        version: META_WHATSAPP_EMBEDDED_SIGNUP_VERSION,
      },
    });

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://attacker.example",
        data: {
          type: META_WHATSAPP_SIGNUP_TYPE,
          event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
          version: META_WHATSAPP_SESSION_INFO_VERSION,
          data: { waba_id: "123456789012345" },
        },
      }));
    });
    act(() => loginCallback?.({ authResponse: { code: "single-use-code" } }));
    expect(mockComplete).not.toHaveBeenCalled();

    const trustedSession = {
      type: META_WHATSAPP_SIGNUP_TYPE,
      event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
      version: META_WHATSAPP_SESSION_INFO_VERSION,
      data: { waba_id: "123456789012345", ignored: "discarded" },
    };
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://www.facebook.com",
        data: trustedSession,
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://www.facebook.com",
        data: trustedSession,
      }));
      loginCallback?.({ authResponse: { code: "single-use-code" } });
    });

    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockComplete).toHaveBeenCalledWith("attempt-1", {
      nonce: "nonce-1",
      code: "single-use-code",
      session: {
        type: META_WHATSAPP_SIGNUP_TYPE,
        event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
        version: META_WHATSAPP_SESSION_INFO_VERSION,
        data: { waba_id: "123456789012345" },
      },
    });
    expect(screen.queryByText("single-use-code")).not.toBeInTheDocument();
    expect(await screen.findByText(/WhatsApp Business is connected/i)).toBeInTheDocument();
  });

  it("requires explicit mobile-app offboarding confirmation before preparing re-onboarding", async () => {
    renderPage();
    await screen.findByText("unavailable");

    const offboardingConfirmation = screen.getByRole("checkbox", {
      name: "I disconnected this number from Business Platform in the WhatsApp Business app",
    });
    expect(offboardingConfirmation).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Prepare connection" })).toBeInTheDocument();

    fireEvent.click(offboardingConfirmation);
    expect(offboardingConfirmation).toBeChecked();
    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare re-onboarding" }));

    await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("admin-password", true));
    expect(await screen.findByText(/reconnect the offboarded WhatsApp Business number/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue re-onboarding with Meta" })).toBeEnabled();
  });

  it("uses the remaining secure-attempt lifetime instead of a 25-second pairing deadline", () => {
    const now = Date.parse("2026-09-06T10:00:00.000Z");

    expect(getWhatsAppPairingWaitMs("2026-09-06T10:05:00.000Z", false, now)).toBe(5 * 60_000);
    expect(getWhatsAppPairingWaitMs("2026-09-06T10:20:00.000Z", false, now)).toBe(10 * 60_000);
    expect(getWhatsAppPairingWaitMs("2026-09-06T10:05:00.000Z", true, now)).toBe(25_000);
    expect(getWhatsAppPairingWaitMs("2026-09-06T10:00:00.000Z", false, now)).toBeNull();
    expect(getWhatsAppPairingWaitMs("not-a-date", false, now)).toBeNull();
  });

  it("keeps timeout diagnostics structural and free of Meta identifiers", () => {
    expect(getWhatsAppConfirmationTimeoutMessage(null)).toContain(
      "No trusted WhatsApp session event reached this page",
    );
    expect(getWhatsAppConfirmationTimeoutMessage("rejected_event")).toContain(
      "not a supported completion event",
    );
    expect(getWhatsAppConfirmationTimeoutMessage("rejected_version")).toContain(
      "unsupported session version",
    );
    expect(getWhatsAppConfirmationTimeoutMessage("rejected_phone")).toContain(
      "invalid phone reference",
    );
  });

  it("reconciles status after an uncertain completion response without replaying the code", async () => {
    mockComplete.mockRejectedValue(new Error("proxy timeout"));
    mockFetchStatus
      .mockResolvedValueOnce(unavailableStatus)
      .mockResolvedValueOnce(connectedStatus);

    renderPage();
    await screen.findByText("unavailable");

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Meta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Meta" }));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://www.facebook.com",
        data: {
          type: META_WHATSAPP_SIGNUP_TYPE,
          event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
          version: META_WHATSAPP_SESSION_INFO_VERSION,
          data: { waba_id: "123456789012345" },
        },
      }));
      loginCallback?.({ authResponse: { code: "single-use-code" } });
    });

    expect(await screen.findByText(/WhatsApp Business is connected/i)).toBeInTheDocument();
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockFetchStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("single-use-code")).not.toBeInTheDocument();
  });

  it("requires a fresh flow when an uncertain completion response cannot be confirmed", async () => {
    mockComplete.mockRejectedValue(new Error("proxy timeout"));
    mockFetchStatus
      .mockResolvedValueOnce(unavailableStatus)
      .mockResolvedValueOnce({
        ...unavailableStatus,
        latestAttemptId: "attempt-1",
        onboardingStatus: "processing",
        recoveryRequired: true,
      });

    renderPage();
    await screen.findByText("unavailable");

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Meta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Meta" }));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://web.facebook.com",
        data: {
          type: META_WHATSAPP_SIGNUP_TYPE,
          event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
          version: META_WHATSAPP_SESSION_INFO_VERSION,
          data: { waba_id: "123456789012345" },
        },
      }));
      loginCallback?.({ authResponse: { code: "single-use-code" } });
    });

    expect(await screen.findByText("Manual recovery required")).toBeInTheDocument();
    expect(screen.getAllByText(/Do not retry or prepare a fresh connection/i).length).toBeGreaterThan(0);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("single-use-code")).not.toBeInTheDocument();
  });

  it("warns instead of claiming success when an initial sync is unknown", async () => {
    mockComplete.mockResolvedValue({
      ...connectedStatus,
      historyDispatchStatus: "unknown",
      recoveryRequired: true,
      lastErrorCode: "history_sync_unknown",
    });
    renderPage();
    await screen.findByText("unavailable");

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Meta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Meta" }));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://web.facebook.com",
        data: {
          type: META_WHATSAPP_SIGNUP_TYPE,
          event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
          version: META_WHATSAPP_SESSION_INFO_VERSION,
          data: { waba_id: "123456789012345" },
        },
      }));
      loginCallback?.({ authResponse: { code: "single-use-code" } });
    });

    expect(await screen.findByText("Initial sync needs attention")).toBeInTheDocument();
    expect(screen.getByText("Manual recovery required")).toBeInTheDocument();
    expect(screen.queryByText(/requests were submitted safely/i)).not.toBeInTheDocument();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("treats declined history sharing as an informational connected state", async () => {
    mockComplete.mockResolvedValue({
      ...connectedStatus,
      historySyncStatus: "declined",
      lastErrorCode: null,
    });
    renderPage();
    await screen.findByText("unavailable");

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Meta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Meta" }));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://www.facebook.com",
        data: {
          type: META_WHATSAPP_SIGNUP_TYPE,
          event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
          version: META_WHATSAPP_SESSION_INFO_VERSION,
          data: { waba_id: "123456789012345" },
        },
      }));
      loginCallback?.({ authResponse: { code: "single-use-code" } });
    });

    expect(await screen.findByText(/WhatsApp Business is connected/i)).toBeInTheDocument();
    expect(screen.queryByText("Initial sync needs attention")).not.toBeInTheDocument();
  });

  it("normalizes and sends a real template only after explicit password authorization", async () => {
    mockFetchStatus.mockResolvedValue(connectedStatus);
    renderPage();
    await screen.findByText("connected");
    await screen.findByRole("textbox", { name: "Approved parameter-free template" });
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Send template message" }),
    ).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Recipient phone (E.164)"), {
      target: { value: "+48 502 484 066" },
    });
    fireEvent.change(screen.getByLabelText("Administrator password for sending"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send template message" }));

    await waitFor(() => expect(mockSendTemplate).toHaveBeenCalledWith({
      password: "admin-password",
      recipient: "+48502484066",
      templateName: "hello_world",
      languageCode: "en_US",
    }));
    expect(screen.getByLabelText("Recipient phone (E.164)")).toHaveValue("+48502484066");
    expect(screen.getByLabelText("Administrator password for sending")).toHaveValue("");
    expect(await screen.findByText(/Meta accepted the WhatsApp message for delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/not yet a delivery confirmation/i)).toBeInTheDocument();
  });

  it("does not enable outbound sending when the coexistence connection is unavailable", async () => {
    renderPage();
    await screen.findByText("unavailable");

    expect(screen.getByRole("button", { name: "Send template message" })).toBeDisabled();
    expect(screen.getByText("WhatsApp connection required")).toBeInTheDocument();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("repairs a missing webhook subscription with explicit administrator confirmation", async () => {
    const missingSubscriptionStatus: WhatsAppAdminStatus = {
      ...connectedStatus,
      webhookSubscriptionStatus: "missing",
    };
    mockFetchStatus
      .mockResolvedValueOnce(missingSubscriptionStatus)
      .mockResolvedValue(connectedStatus);

    renderPage();

    expect(await screen.findByText("Webhook subscription missing")).toBeInTheDocument();
    expect(screen.getByText("Not subscribed")).toBeInTheDocument();
    expect(screen.queryByText(/re-onboard/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repair subscription" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Administrator password for webhook repair"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Repair subscription" }));

    await waitFor(() => expect(mockRepairSubscription).toHaveBeenCalledWith("admin-password"));
    expect(await screen.findByText("Webhook subscription healthy")).toBeInTheDocument();
    expect(screen.queryByLabelText("Administrator password for webhook repair")).not.toBeInTheDocument();
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalledTimes(2));
  });

  it("reports an unknown subscription separately from a disconnected connection and allows retry", async () => {
    mockFetchStatus.mockResolvedValue({
      ...connectedStatus,
      webhookSubscriptionStatus: "unknown",
    });

    renderPage();

    expect(await screen.findByText("Webhook subscription could not be verified")).toBeInTheDocument();
    expect(screen.getByText(/does not mean the WhatsApp connection is disconnected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repair subscription" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry verification" }));
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalledTimes(2));
  });

  it("shows a webhook repair failure and clears the submitted password", async () => {
    mockFetchStatus.mockResolvedValue({
      ...connectedStatus,
      webhookSubscriptionStatus: "missing",
    });
    mockRepairSubscription.mockRejectedValue({
      response: { data: { message: "Administrator password is incorrect." } },
    });

    renderPage();
    await screen.findByText("Webhook subscription missing");
    const passwordInput = screen.getByLabelText("Administrator password for webhook repair");
    fireEvent.change(passwordInput, { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Repair subscription" }));

    expect(await screen.findByText("Administrator password is incorrect.")).toBeInTheDocument();
    expect(passwordInput).toHaveValue("");
    expect(screen.getByText("Not subscribed")).toBeInTheDocument();
  });
});
