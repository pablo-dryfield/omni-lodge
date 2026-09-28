import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  fetchWhatsAppTemplateVariables,
  fetchWhatsAppTemplates,
  previewWhatsAppTemplate,
  searchWhatsAppTemplateBookings,
  sendManagedWhatsAppTemplate,
  syncWhatsAppTemplates,
  type WhatsAppManagedTemplate,
} from "../../api/whatsappTemplates";
import SettingsWhatsAppTemplates from "./SettingsWhatsAppTemplates";

jest.setTimeout(15_000);

jest.mock("@mantine/hooks", () => ({
  ...jest.requireActual("@mantine/hooks"),
  useDebouncedValue: (value: unknown) => [value],
}));

jest.mock("../../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../../api/whatsappTemplates", () => ({
  WHATSAPP_TEMPLATES_QUERY_KEY: ["whatsapp-templates"],
  WHATSAPP_TEMPLATE_VARIABLES_QUERY_KEY: ["whatsapp-template-variables"],
  fetchWhatsAppTemplates: jest.fn(),
  fetchWhatsAppTemplateVariables: jest.fn(),
  previewWhatsAppTemplate: jest.fn(),
  searchWhatsAppTemplateBookings: jest.fn(),
  fetchWhatsAppTemplateEvents: jest.fn(),
  createWhatsAppTemplate: jest.fn(),
  updateWhatsAppTemplate: jest.fn(),
  deleteWhatsAppTemplate: jest.fn(),
  syncWhatsAppTemplates: jest.fn(),
  archiveWhatsAppTemplates: jest.fn(),
  unarchiveWhatsAppTemplates: jest.fn(),
  unpauseWhatsAppTemplate: jest.fn(),
  sendManagedWhatsAppTemplate: jest.fn(),
}));

const mockFetchTemplates = fetchWhatsAppTemplates as jest.MockedFunction<typeof fetchWhatsAppTemplates>;
const mockFetchVariables = fetchWhatsAppTemplateVariables as jest.MockedFunction<typeof fetchWhatsAppTemplateVariables>;
const mockPreview = previewWhatsAppTemplate as jest.MockedFunction<typeof previewWhatsAppTemplate>;
const mockSearchBookings = searchWhatsAppTemplateBookings as jest.MockedFunction<typeof searchWhatsAppTemplateBookings>;
const mockSend = sendManagedWhatsAppTemplate as jest.MockedFunction<typeof sendManagedWhatsAppTemplate>;
const mockSync = syncWhatsAppTemplates as jest.MockedFunction<typeof syncWhatsAppTemplates>;

const template: WhatsAppManagedTemplate = {
  id: 1,
  metaTemplateId: "123456789",
  name: "booking_confirmation",
  language: "en_US",
  category: "UTILITY",
  status: "APPROVED",
  qualityScore: "GREEN",
  parameterFormat: "NAMED",
  messageSendTtlSeconds: null,
  components: [{ type: "BODY", text: "Hi {{guest_first_name}}" }],
  rejectedReason: null,
  reasonInfo: null,
  recommendationInfo: null,
  lastSyncedAt: "2026-09-28T12:00:00.000Z",
  bookingPreviewSupported: true,
  bookingSendSupported: true,
  bookingSupportReason: null,
  bookingBindings: {},
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={["/settings/whatsapp/templates"]}>
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <SettingsWhatsAppTemplates />
        </MantineProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("SettingsWhatsAppTemplates", () => {
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
    mockFetchTemplates.mockResolvedValue([template]);
    mockFetchVariables.mockResolvedValue([]);
    mockSearchBookings.mockResolvedValue([{
      id: 42,
      reference: "GYG-42",
      guestName: "Alex Guest",
      productName: "Old Town Tour",
      experienceAt: "2026-10-03T18:00:00.000Z",
      phoneSuffix: "3987",
    }]);
    mockSend.mockResolvedValue({ messageId: "wamid.test-42" });
    mockSync.mockResolvedValue([template]);
    mockPreview.mockResolvedValue({
      header: null,
      body: "Hi Alex",
      footer: null,
      buttons: [],
      variables: [],
      missingVariables: [],
    });
  });

  afterEach(() => jest.clearAllMocks());

  it("shows managed status and renders a non-sending sample preview", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "WhatsApp templates" })).toBeInTheDocument();
    await screen.findByText("booking_confirmation");
    await screen.findByText("Hi Alex");

    expect(screen.getByRole("button", { name: "Send with booking" })).toBeEnabled();
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith({
      metaTemplateId: "123456789",
      bookingId: null,
    }));
  });

  it("keeps category immutable when editing an approved template", async () => {
    renderPage();
    await screen.findByText("booking_confirmation");

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const categoryControls = await screen.findAllByLabelText("Category");
    expect(categoryControls.find((element) => element.tagName === "INPUT")).toBeDisabled();
  });

  it("requires and displays the exact booking preview before enabling a real send", async () => {
    renderPage();
    await screen.findByText("booking_confirmation");
    fireEvent.click(await screen.findByRole("button", { name: "Send with booking" }));

    const sendButton = await screen.findByRole("button", { name: "Send message now" });
    expect(sendButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Booking"), { target: { value: "GY" } });
    fireEvent.click(await screen.findByText("GYG-42 · Alex Guest"));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith({
      metaTemplateId: "123456789",
      bookingId: 42,
    }));
    expect(await screen.findByText("This preview is bound to GYG-42 and is ready to send.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "confirmed-password" },
    });
    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith("123456789", {
      password: "confirmed-password",
      bookingId: 42,
    }));
  });

  it("warns not to retry when Meta's write outcome needs reconciliation", async () => {
    mockSync.mockRejectedValueOnce({
      response: {
        data: [{
          message: "Meta could not synchronize the WhatsApp template.",
          details: { ambiguous: true },
        }],
      },
    });
    renderPage();
    await screen.findByText("booking_confirmation");
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    fireEvent.change(await screen.findByLabelText("Administrator password"), {
      target: { value: "confirmed-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm sync" }));

    expect(await screen.findByText(/Do not retry this operation yet/)).toBeInTheDocument();
  });

  it("preserves a dynamic URL booking mapping across visual and JSON modes", async () => {
    const dynamicTemplate: WhatsAppManagedTemplate = {
      ...template,
      components: [
        { type: "BODY", text: "Hi {{guest_first_name}}" },
        {
          type: "BUTTONS",
          buttons: [{
            type: "URL",
            text: "View booking",
            url: "https://example.test/bookings/{{1}}",
          }],
        },
      ],
      bookingBindings: { buttons: { 0: ["booking_reference"] } },
    };
    mockFetchTemplates.mockResolvedValue([dynamicTemplate]);
    renderPage();
    await screen.findByText("booking_confirmation");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByText("Advanced JSON"));
    fireEvent.click(await screen.findByText("Common components"));
    mockPreview.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Render preview" }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith({
      definition: expect.objectContaining({
        bookingBindings: { buttons: { 0: ["booking_reference"] } },
      }),
      bookingId: null,
    }));
  });

  it("keeps an imported authentication template editable and accepts its Meta-managed body", async () => {
    const authenticationTemplate: WhatsAppManagedTemplate = {
      ...template,
      metaTemplateId: "987654321",
      name: "login_code",
      category: "AUTHENTICATION",
      parameterFormat: "POSITIONAL",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        {
          type: "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }],
        },
      ],
      bookingPreviewSupported: false,
      bookingSendSupported: false,
      bookingSupportReason: "Authentication codes cannot use booking data.",
    };
    mockFetchTemplates.mockResolvedValue([authenticationTemplate]);

    renderPage();
    await screen.findByText("login_code");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(await screen.findByLabelText("Components JSON")).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Submit update" })).toBeEnabled();

    mockPreview.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Render preview" }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith({
      definition: {
        name: "login_code",
        language: "en_US",
        category: "AUTHENTICATION",
        parameterFormat: "POSITIONAL",
        messageSendTtlSeconds: null,
        components: authenticationTemplate.components,
        bookingBindings: {},
      },
      bookingId: null,
    }));
    expect(screen.queryByText("The template needs exactly one non-empty body component.")).not.toBeInTheDocument();
  });

  it("rejects custom authentication body text before requesting a preview", async () => {
    const authenticationTemplate: WhatsAppManagedTemplate = {
      ...template,
      metaTemplateId: "987654321",
      name: "login_code",
      category: "AUTHENTICATION",
      parameterFormat: "POSITIONAL",
      components: [
        { type: "BODY", add_security_recommendation: false },
        {
          type: "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE" }],
        },
      ],
      bookingPreviewSupported: false,
      bookingSendSupported: false,
      bookingSupportReason: "Authentication codes cannot use booking data.",
    };
    mockFetchTemplates.mockResolvedValue([authenticationTemplate]);

    renderPage();
    await screen.findByText("login_code");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const components = await screen.findByLabelText("Components JSON");
    fireEvent.change(components, {
      target: { value: JSON.stringify([{ type: "BODY", text: "Use {{1}} to sign in." }]) },
    });
    mockPreview.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Render preview" }));

    expect(await screen.findByText(
      "Authentication template bodies use Meta preset text and cannot define custom text.",
    )).toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it("rejects custom authentication footer text before requesting a preview", async () => {
    const authenticationTemplate: WhatsAppManagedTemplate = {
      ...template,
      metaTemplateId: "987654321",
      name: "login_code",
      category: "AUTHENTICATION",
      parameterFormat: "POSITIONAL",
      components: [
        { type: "BODY" },
        { type: "FOOTER", code_expiration_minutes: 10 },
      ],
      bookingPreviewSupported: false,
      bookingSendSupported: false,
      bookingSupportReason: "Authentication codes cannot use booking data.",
    };
    mockFetchTemplates.mockResolvedValue([authenticationTemplate]);

    renderPage();
    await screen.findByText("login_code");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const components = await screen.findByLabelText("Components JSON");
    fireEvent.change(components, {
      target: { value: JSON.stringify([
        { type: "BODY" },
        { type: "FOOTER", text: "Custom footer" },
      ]) },
    });
    mockPreview.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Render preview" }));

    expect(await screen.findByText(
      "Authentication template footers require a code expiration between 1 and 90 minutes.",
    )).toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();
  });
});
