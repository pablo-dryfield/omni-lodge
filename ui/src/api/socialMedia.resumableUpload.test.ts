import axiosInstance from "../utils/axiosInstance";
import {
  ResumableDriveUploadCompletionUncertainError,
  uploadFileToResumableDriveSession,
} from "../utils/resumableDriveUpload";
import {
  type SocialMediaContentItem,
  uploadSocialMediaAsset,
} from "./socialMedia";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock("../utils/resumableDriveUpload", () => {
  const actual = jest.requireActual("../utils/resumableDriveUpload");
  return {
    ...actual,
    uploadFileToResumableDriveSession: jest.fn(),
  };
});

const mockPost = axiosInstance.post as jest.MockedFunction<typeof axiosInstance.post>;
const mockDriveUpload = uploadFileToResumableDriveSession as jest.MockedFunction<
  typeof uploadFileToResumableDriveSession
>;

const item = {
  id: 42,
  status: "in_production",
} as SocialMediaContentItem;

const file = new File([new Uint8Array(1_000)], "final-video.mp4", {
  type: "video/mp4",
});

const session = {
  uploadUrl: "https://www.googleapis.com/upload/session-42",
  uploadToken: "private-token-42",
  chunkSizeBytes: 256 * 1024,
};

describe("Social Media resumable asset upload", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("asks the backend to reconcile by token when Google's final response is ambiguous", async () => {
    mockPost
      .mockResolvedValueOnce({ data: session })
      .mockResolvedValueOnce({ data: { item } });
    mockDriveUpload.mockRejectedValueOnce(
      new ResumableDriveUploadCompletionUncertainError(),
    );
    const onProgress = jest.fn();

    await expect(uploadSocialMediaAsset({
      id: 42,
      assetType: "final_video",
      file,
      onProgress,
    })).resolves.toBe(item);

    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      "/social-media/content/42/assets/resumable-complete",
      expect.not.objectContaining({ driveFileId: expect.anything() }),
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        assetType: "final_video",
        uploadToken: "private-token-42",
      }),
    );
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: file.size, total: file.size, percent: 100 });
  });

  it("includes the Drive file ID when Google returns a normal completion response", async () => {
    mockPost
      .mockResolvedValueOnce({ data: session })
      .mockResolvedValueOnce({ data: { item } });
    mockDriveUpload.mockResolvedValueOnce({ id: "drive-file-42" });

    await expect(uploadSocialMediaAsset({
      id: 42,
      assetType: "final_video",
      file,
    })).resolves.toBe(item);

    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      "/social-media/content/42/assets/resumable-complete",
      expect.objectContaining({ driveFileId: "drive-file-42" }),
    );
  });

  it("uses a server-recovered upload without sending the file again", async () => {
    mockPost.mockResolvedValueOnce({
      data: { item, recoveredUpload: true },
    });
    const onProgress = jest.fn();

    await expect(uploadSocialMediaAsset({
      id: 42,
      assetType: "final_video",
      file,
      onProgress,
    })).resolves.toBe(item);

    expect(mockDriveUpload).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: file.size, total: file.size, percent: 100 });
  });

  it("retries token reconciliation while the completed Drive file becomes visible", async () => {
    mockPost
      .mockResolvedValueOnce({ data: session })
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce({ data: { item } });
    mockDriveUpload.mockRejectedValueOnce(
      new ResumableDriveUploadCompletionUncertainError(),
    );

    await expect(uploadSocialMediaAsset({
      id: 42,
      assetType: "final_video",
      file,
    })).resolves.toBe(item);

    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(mockPost).toHaveBeenLastCalledWith(
      "/social-media/content/42/assets/resumable-complete",
      expect.not.objectContaining({ driveFileId: expect.anything() }),
    );
  });

  it("explains how to avoid a duplicate if reconciliation cannot register the file", async () => {
    mockPost
      .mockResolvedValueOnce({ data: session })
      .mockRejectedValueOnce({ response: { status: 400 } });
    mockDriveUpload.mockRejectedValueOnce(
      new ResumableDriveUploadCompletionUncertainError(),
    );

    await expect(uploadSocialMediaAsset({
      id: 42,
      assetType: "final_video",
      file,
    })).rejects.toThrow("Refresh this item before uploading again");
  });
});
