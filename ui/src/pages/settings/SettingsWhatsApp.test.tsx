import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  completeWhatsAppEmbeddedSignup,
  fetchWhatsAppAdminStatus,
  prepareWhatsAppEmbeddedSignup,
  type WhatsAppAdminStatus,
} from "../../api/whatsappAdmin";
import {
  loadMetaFacebookSdk,
  META_WHATSAPP_SESSION_INFO_VERSION,
  META_WHATSAPP_SIGNUP_FEATURE,
  META_WHATSAPP_SIGNUP_FINISH_EVENT,
  META_WHATSAPP_SIGNUP_TYPE,
} from "../../utils/metaWhatsAppSignup";
import SettingsWhatsApp from "./SettingsWhatsApp";

jest.mock("../../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../../api/whatsappAdmin", () => ({
  WHATSAPP_ADMIN_STATUS_QUERY_KEY: ["whatsapp-admin-status"],
  fetchWhatsAppAdminStatus: jest.fn(),
  prepareWhatsAppEmbeddedSignup: jest.fn(),
  completeWhatsAppEmbeddedSignup: jest.fn(),
}));

jest.mock("../../utils/metaWhatsAppSignup", () => {
  const actual = jest.requireActual("../../utils/metaWhatsAppSignup");
  return {
    ...actual,
    loadMetaFacebookSdk: jest.fn(),
  };
});

const mockFetchStatus = fetchWhatsAppAdminStatus as jest.MockedFunction<typeof fetchWhatsAppAdminStatus>;
const mockPrepare = prepareWhatsAppEmbeddedSignup as jest.MockedFunction<typeof prepareWhatsAppEmbeddedSignup>;
const mockComplete = completeWhatsAppEmbeddedSignup as jest.MockedFunction<typeof completeWhatsAppEmbeddedSignup>;
const mockLoadSdk = loadMetaFacebookSdk as jest.MockedFunction<typeof loadMetaFacebookSdk>;

const unavailableStatus: WhatsAppAdminStatus = {
  available: false,
  connectionStatus: "unavailable",
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

    await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("admin-password"));
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
        sessionInfoVersion: META_WHATSAPP_SESSION_INFO_VERSION,
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
});
