import axiosInstance from "../utils/axiosInstance";
import {
  updateSocialMediaPublicationDate,
  updateSocialMediaAttribution,
  type SocialMediaContentItem,
  type SocialMediaPublicationDateResult,
} from "./socialMedia";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: { patch: jest.fn() },
}));

const mockPatch = axiosInstance.patch as jest.MockedFunction<typeof axiosInstance.patch>;

describe("Social Media publication date API", () => {
  afterEach(() => jest.clearAllMocks());

  it("sends the chosen calendar date and original timestamp without client timezone conversion", async () => {
    const result: SocialMediaPublicationDateResult = {
      item: { id: 42, status: "published", publishedTaskLogId: 21 } as SocialMediaContentItem,
      previousTaskLogId: 20,
      taskCompletion: null,
    };
    mockPatch.mockResolvedValue({ data: result });

    await expect(updateSocialMediaPublicationDate({
      id: 42,
      publishedDate: "2026-09-03",
      expectedPublishedAt: "2026-09-04T22:30:00.000Z",
    })).resolves.toBe(result);
    expect(mockPatch).toHaveBeenCalledWith("/social-media/content/42/publication-date", {
      publishedDate: "2026-09-03",
      expectedPublishedAt: "2026-09-04T22:30:00.000Z",
    });
  });

  it("preserves the server conflict so the modal can explain a missing or occupied matching task", async () => {
    const conflict = {
      response: { status: 409, data: { message: "No matching task exists for this person on that date." } },
    };
    mockPatch.mockRejectedValue(conflict);

    await expect(updateSocialMediaPublicationDate({
      id: 42,
      publishedDate: "2026-09-03",
      expectedPublishedAt: "2026-09-04T22:30:00.000Z",
    })).rejects.toBe(conflict);
  });

  it("sends changed contributor IDs with the captured version and preserves an explicitly cleared producer", async () => {
    const item = { id: 42, createdBy: 7, producedBy: null } as SocialMediaContentItem;
    mockPatch.mockResolvedValue({ data: { item } });

    await expect(updateSocialMediaAttribution({
      id: 42,
      createdBy: 7,
      producedBy: null,
      expectedUpdatedAt: "2026-09-04T22:30:00.000Z",
    })).resolves.toBe(item);
    expect(mockPatch).toHaveBeenCalledWith("/social-media/content/42/attribution", {
      createdBy: 7,
      producedBy: null,
      expectedUpdatedAt: "2026-09-04T22:30:00.000Z",
    });
  });
});
