import axiosInstance from "../utils/axiosInstance";
import {
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  fetchWhatsAppTemplates,
  previewWhatsAppTemplate,
  searchWhatsAppTemplateBookings,
  sendManagedWhatsAppTemplate,
  syncWhatsAppTemplates,
  type WhatsAppTemplateDefinition,
} from "./whatsappTemplates";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockGet = axiosInstance.get as jest.MockedFunction<typeof axiosInstance.get>;
const mockPost = axiosInstance.post as jest.MockedFunction<typeof axiosInstance.post>;
const mockDelete = axiosInstance.delete as jest.MockedFunction<typeof axiosInstance.delete>;

const definition: WhatsAppTemplateDefinition = {
  name: "booking_confirmation",
  language: "en_US",
  category: "UTILITY",
  parameterFormat: "NAMED",
  messageSendTtlSeconds: 43_200,
  components: [{ type: "BODY", text: "Hi {{guest_first_name}}" }],
};

const template = {
  ...definition,
  id: 1,
  metaTemplateId: "123456789",
  status: "PENDING",
  qualityScore: "UNKNOWN",
  rejectedReason: null,
  reasonInfo: null,
  recommendationInfo: null,
  lastSyncedAt: "2026-09-28T12:00:00.000Z",
  bookingPreviewSupported: true,
  bookingSendSupported: true,
  bookingSupportReason: null,
};

describe("WhatsApp template management API", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads the managed template envelope", async () => {
    mockGet.mockResolvedValue({ data: { templates: [template] } });

    await expect(fetchWhatsAppTemplates()).resolves.toEqual([template]);
    expect(mockGet).toHaveBeenCalledWith("/integrations/whatsapp/admin/templates");
  });

  it("password-gates synchronization", async () => {
    mockPost.mockResolvedValue({ data: { templates: [template] } });

    await expect(syncWhatsAppTemplates("admin-password")).resolves.toEqual([template]);
    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/templates/sync",
      { password: "admin-password" },
    );
  });

  it("submits the full named-component definition for creation", async () => {
    mockPost.mockResolvedValue({ data: { template } });

    await expect(createWhatsAppTemplate({ ...definition, password: "admin-password" })).resolves.toEqual(template);
    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/templates",
      { ...definition, password: "admin-password" },
    );
  });

  it("uses the template id and exact name for safe deletion", async () => {
    mockDelete.mockResolvedValue({ data: { deleted: true } });

    await deleteWhatsAppTemplate("123456789", "booking_confirmation", "admin-password");
    expect(mockDelete).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/templates/123456789",
      { data: { name: "booking_confirmation", password: "admin-password" } },
    );
  });

  it("renders a server-owned booking preview without sending", async () => {
    const preview = {
      header: null,
      body: "Hi Alex",
      footer: null,
      buttons: [],
      variables: [],
      missingVariables: [],
    };
    mockPost.mockResolvedValue({ data: { preview } });

    await expect(previewWhatsAppTemplate({ metaTemplateId: "123456789", bookingId: 42 })).resolves.toEqual(preview);
    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/templates/preview",
      { metaTemplateId: "123456789", bookingId: 42 },
    );
  });

  it("keeps booking search terms out of request URLs", async () => {
    mockPost.mockResolvedValue({ data: { bookings: [] } });

    await expect(searchWhatsAppTemplateBookings("Alex Guest")).resolves.toEqual([]);
    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/templates/bookings/search",
      { q: "Alex Guest" },
    );
  });

  it("sends only a booking reference and optional recipient override", async () => {
    mockPost.mockResolvedValue({ data: { messageId: "wamid.accepted-1" } });

    await expect(sendManagedWhatsAppTemplate("123456789", {
      password: "admin-password",
      bookingId: 42,
    })).resolves.toEqual({ messageId: "wamid.accepted-1" });
    expect(mockPost).toHaveBeenCalledWith(
      "/integrations/whatsapp/admin/templates/123456789/send",
      { password: "admin-password", bookingId: 42 },
    );
  });
});
