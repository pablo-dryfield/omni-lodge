import {
  isResumableDriveUploadCompletionUncertainError,
  uploadFileToResumableDriveSession,
} from "./resumableDriveUpload";

const response = (
  status: number,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response => new Response(body ? JSON.stringify(body) : null, {
  status,
  headers: { "Content-Type": "application/json", ...headers },
});

describe("resumable Google Drive uploads", () => {
  it("uploads aligned chunks and returns the completed Drive file", async () => {
    const chunkSize = 256 * 1024;
    const file = new File([new Uint8Array(chunkSize + 12)], "video.mp4", { type: "video/mp4" });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(308, undefined, { Range: `bytes=0-${chunkSize - 1}` }))
      .mockResolvedValueOnce(response(200, { id: "drive-file-1" }));
    const progress = jest.fn();

    await expect(uploadFileToResumableDriveSession({
      uploadUrl: "https://www.googleapis.com/upload/session-1",
      file,
      chunkSizeBytes: chunkSize,
      fetchImpl: fetchImpl as typeof fetch,
      onProgress: progress,
    })).resolves.toEqual({ id: "drive-file-1" });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({
        "Content-Range": `bytes 0-${chunkSize - 1}/${chunkSize + 12}`,
      }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({
        "Content-Range": `bytes ${chunkSize}-${chunkSize + 11}/${chunkSize + 12}`,
      }),
    }));
    expect(progress).toHaveBeenLastCalledWith({ loaded: chunkSize + 12, total: chunkSize + 12, percent: 100 });
  });

  it("probes and resumes from Google's acknowledged byte after a temporary failure", async () => {
    const chunkSize = 256 * 1024;
    const file = new File([new Uint8Array(chunkSize)], "raw.mov", { type: "video/quicktime" });
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(response(308, undefined, { Range: "bytes=0-131071" }))
      .mockResolvedValueOnce(response(200, { id: "drive-file-2" }));

    await expect(uploadFileToResumableDriveSession({
      uploadUrl: "https://www.googleapis.com/upload/session-2",
      file,
      chunkSizeBytes: chunkSize,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({ id: "drive-file-2" });

    expect(fetchImpl).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      headers: { "Content-Range": `bytes */${chunkSize}` },
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({
        "Content-Range": `bytes 131072-${chunkSize - 1}/${chunkSize}`,
      }),
    }));
  });

  it("rejects expired sessions with an actionable message", async () => {
    const file = new File(["content"], "project.zip", { type: "application/zip" });
    await expect(uploadFileToResumableDriveSession({
      uploadUrl: "https://www.googleapis.com/upload/expired",
      file,
      chunkSizeBytes: 256 * 1024,
      fetchImpl: jest.fn().mockResolvedValue(response(410)) as typeof fetch,
    })).rejects.toThrow("upload session expired");
  });

  it("does not report 100 percent until every byte is acknowledged", async () => {
    const file = new File([new Uint8Array(1_000)], "almost-done.mov", { type: "video/quicktime" });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(308, undefined, { Range: "bytes=0-998" }))
      .mockResolvedValueOnce(response(200, { id: "drive-file-3" }));
    const progress = jest.fn();

    await uploadFileToResumableDriveSession({
      uploadUrl: "https://www.googleapis.com/upload/session-3",
      file,
      chunkSizeBytes: 256 * 1024,
      fetchImpl: fetchImpl as typeof fetch,
      onProgress: progress,
    });

    expect(progress).toHaveBeenNthCalledWith(2, {
      loaded: 999,
      total: 1_000,
      percent: 99,
    });
    expect(progress).toHaveBeenLastCalledWith({ loaded: 1_000, total: 1_000, percent: 100 });
  });

  it("reports an uncertain completion when the final PUT and its status probe cannot be read", async () => {
    const file = new File([new Uint8Array(1_000)], "final-video.mp4", { type: "video/mp4" });
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let uploadError: unknown;
    try {
      await uploadFileToResumableDriveSession({
        uploadUrl: "https://www.googleapis.com/upload/final-response-blocked",
        file,
        chunkSizeBytes: 256 * 1024,
        fetchImpl: fetchImpl as typeof fetch,
      });
    } catch (error) {
      uploadError = error;
    }

    expect(isResumableDriveUploadCompletionUncertainError(uploadError)).toBe(true);
    expect(uploadError).toEqual(expect.objectContaining({
      message: expect.stringContaining("completion response could not be verified"),
      uploadMayHaveCompleted: true,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not classify an interrupted non-final chunk as a completed upload", async () => {
    const chunkSize = 256 * 1024;
    const file = new File([new Uint8Array(chunkSize + 1)], "raw-video.mov", {
      type: "video/quicktime",
    });
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let uploadError: unknown;
    try {
      await uploadFileToResumableDriveSession({
        uploadUrl: "https://www.googleapis.com/upload/non-final-response-blocked",
        file,
        chunkSizeBytes: chunkSize,
        fetchImpl: fetchImpl as typeof fetch,
      });
    } catch (error) {
      uploadError = error;
    }

    expect(uploadError).toBeInstanceOf(TypeError);
    expect(isResumableDriveUploadCompletionUncertainError(uploadError)).toBe(false);
  });
});
