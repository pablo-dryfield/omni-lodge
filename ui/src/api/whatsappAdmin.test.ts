import axiosInstance from "../utils/axiosInstance";
import {
  completeWhatsAppEmbeddedSignup,
  fetchWhatsAppAdminStatus,
  prepareWhatsAppEmbeddedSignup,
} from "./whatsappAdmin";
import {
  META_WHATSAPP_SESSION_INFO_VERSION,
  META_WHATSAPP_SIGNUP_FINISH_EVENT,
  META_WHATSAPP_SIGNUP_TYPE,
} from "../utils/metaWhatsAppSignup";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = axiosInstance.get as jest.MockedFunction<typeof axiosInstance.get>;
const mockPost = axiosInstance.post as jest.MockedFunction<typeof axiosInstance.post>;

const backendStatus = {
  connected: true,
  coexistenceVerified: true,
  configuration: {
    launchConfigured: true,
    webhookVerifyTokenConfigured: true,
    metaAppSecretConfigured: true,
    businessAccessTokenConfigured: true,
  },
  wabaId: "123456789012345",
  phoneNumberId: "987654321098765",
  onboardingGeneration: "generation-2",
  latestAttempt: {
    id: "attempt-1",
    status: "completed",
    expiresAt: "2026-08-27T08:00:00.000Z",
    wabaId: "123456789012345",
    phoneNumberId: "987654321098765",
    onboardingGeneration: "generation-2",
    subscriptionStatus: "succeeded",
    appStateSyncStatus: "succeeded",
    historySyncStatus: "succeeded",
    errorCode: null,
    recoveryRequired: false,
    completedAt: "2026-08-27T07:35:00.000Z",
    createdAt: "2026-08-27T07:30:00.000Z",
  },
  source: {
    status: "connected",
    available: true,
    historySyncStatus: "in_progress",
  },
};

describe("WhatsApp admin API", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes the backend's redacted status contract", async () => {
    mockGet.mockResolvedValue({ data: { status: backendStatus } });

    await expect(fetchWhatsAppAdminStatus()).resolves.toEqual({
      available: true,
      connectionStatus: "connected",
      coexistenceVerified: true,
      launchConfigured: true,
      webhookVerifyTokenConfigured: true,
      metaAppSecretConfigured: true,
      tokenConfigured: true,
      wabaConfigured: true,
      phoneNumberConfigured: true,
      wabaId: "123456789012345",
      phoneNumberId: "987654321098765",
      latestAttemptId: "attempt-1",
      onboardingStatus: "completed",
      appStateSyncStatus: "succeeded",
      historyDispatchStatus: "succeeded",
      historySyncStatus: "in_progress",
      recoveryRequired: false,
      lastErrorCode: null,
      updatedAt: "2026-08-27T07:35:00.000Z",
    });
    expect(mockGet).toHaveBeenCalledWith("/integrations/whatsapp/admin/status");
  });

  it("prepares an admin-bound launch attempt with password confirmation", async () => {
    mockPost.mockResolvedValue({
      data: {
        attempt: {
          id: "attempt-1",
          nonce: "nonce-1",
          expiresAt: "2026-08-27T08:00:00.000Z",
        },
        launch: {
          appId: "111222333",
          configId: "444555666",
          graphApiVersion: "v25.0",
        },
      },
    });

    await expect(prepareWhatsAppEmbeddedSignup("admin-password")).resolves.toEqual({
      id: "attempt-1",
      nonce: "nonce-1",
      expiresAt: "2026-08-27T08:00:00.000Z",
      launch: {
        appId: "111222333",
        configId: "444555666",
        graphApiVersion: "v25.0",
      },
    });
    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/embedded-signup/attempts",
      { password: "admin-password" },
    );
  });

  it("posts only the nonce, code, and allowlisted completion session", async () => {
    mockPost.mockResolvedValue({ data: { status: backendStatus } });
    const session = {
      type: META_WHATSAPP_SIGNUP_TYPE,
      event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
      version: META_WHATSAPP_SESSION_INFO_VERSION,
      data: { waba_id: "123456789012345" },
    } as const;

    await completeWhatsAppEmbeddedSignup("attempt-1", {
      nonce: "nonce-1",
      code: "single-use-code",
      session,
    });

    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/embedded-signup/attempts/attempt-1/complete",
      { nonce: "nonce-1", code: "single-use-code", session },
    );
  });
});
