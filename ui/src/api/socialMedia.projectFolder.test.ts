import axiosInstance from "../utils/axiosInstance";
import {
  checkSocialMediaProjectFolder,
  type SocialMediaContentItem,
  type SocialMediaProjectFolderCheckResult,
} from "./socialMedia";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

const mockPost = axiosInstance.post as jest.MockedFunction<typeof axiosInstance.post>;

describe("Social Media project-folder API", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("requests a server-side Drive folder check and returns its recovery result", async () => {
    const result: SocialMediaProjectFolderCheckResult = {
      item: {
        id: 42,
        status: "planned",
      } as SocialMediaContentItem,
      folderAvailable: false,
      reset: true,
    };
    mockPost.mockResolvedValue({ data: result });

    await expect(checkSocialMediaProjectFolder(42)).resolves.toBe(result);
    expect(mockPost).toHaveBeenCalledWith(
      "/social-media/content/42/project-folder/check",
    );
  });
});
