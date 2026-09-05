export type ResumableDriveUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type ResumableDriveUploadResult = {
  id: string;
  [key: string]: unknown;
};

type UploadOptions = {
  uploadUrl: string;
  file: File;
  chunkSizeBytes: number;
  onProgress?: (progress: ResumableDriveUploadProgress) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/**
 * The final chunk was sent, but the browser could not read Google's response.
 * Google may already have committed the file and closed the resumable session,
 * so callers should reconcile the upload through the application backend
 * before asking the user to upload the file again.
 */
export class ResumableDriveUploadCompletionUncertainError extends Error {
  readonly uploadMayHaveCompleted = true;

  constructor() {
    super(
      "The file reached Google Drive, but its completion response could not be verified.",
    );
    this.name = "ResumableDriveUploadCompletionUncertainError";
  }
}

export const isResumableDriveUploadCompletionUncertainError = (
  error: unknown,
): error is ResumableDriveUploadCompletionUncertainError => (
  error instanceof ResumableDriveUploadCompletionUncertainError
  || (
    error !== null
    && typeof error === "object"
    && "uploadMayHaveCompleted" in error
    && (error as { uploadMayHaveCompleted?: unknown }).uploadMayHaveCompleted === true
  )
);

const MIN_DRIVE_CHUNK_SIZE = 256 * 1024;
const MAX_RETRIES = 3;

const parseAcknowledgedByte = (value: string | null): number | null => {
  if (!value) return null;
  const match = /bytes=\d+-(\d+)/iu.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const readDriveResult = async (response: Response): Promise<ResumableDriveUploadResult> => {
  const body = await response.json() as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id.trim()) {
    throw new Error("Google Drive completed the upload without returning a file ID.");
  }
  return body as ResumableDriveUploadResult;
};

const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The upload was cancelled.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("The upload was cancelled.", "AbortError"));
    }, { once: true });
  });

const reportProgress = (
  loaded: number,
  total: number,
  onProgress?: UploadOptions["onProgress"],
) => {
  if (!onProgress) return;
  const percent = total === 0 || loaded >= total
    ? 100
    : Math.min(99, Math.floor((loaded / total) * 100));
  onProgress({
    loaded,
    total,
    percent,
  });
};

type ProbeResult =
  | { complete: true; result: ResumableDriveUploadResult }
  | { complete: false; nextByte: number };

const probeUpload = async (
  fetchImpl: typeof fetch,
  uploadUrl: string,
  total: number,
  signal?: AbortSignal,
): Promise<ProbeResult> => {
  const response = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
    signal,
  });
  if (response.ok) return { complete: true, result: await readDriveResult(response) };
  if (response.status === 308) {
    const acknowledged = parseAcknowledgedByte(response.headers.get("Range"));
    return { complete: false, nextByte: acknowledged === null ? 0 : acknowledged + 1 };
  }
  if (response.status === 404 || response.status === 410) {
    throw new Error("The Google Drive upload session expired. Start the upload again.");
  }
  throw new Error(`Unable to resume the Google Drive upload (${response.status}).`);
};

/**
 * Sends a browser File directly to a server-created Google Drive resumable
 * session. Every non-final chunk is a multiple of Drive's 256 KiB boundary.
 */
export const uploadFileToResumableDriveSession = async ({
  uploadUrl,
  file,
  chunkSizeBytes,
  onProgress,
  signal,
  fetchImpl = window.fetch.bind(window),
}: UploadOptions): Promise<ResumableDriveUploadResult> => {
  let uploadHost = "";
  try {
    const parsed = new URL(uploadUrl);
    if (parsed.protocol === "https:") uploadHost = parsed.hostname.toLowerCase();
  } catch {
    uploadHost = "";
  }
  if (uploadHost !== "googleapis.com" && !uploadHost.endsWith(".googleapis.com")) {
    throw new Error("The upload session URL is invalid.");
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Choose a non-empty file.");
  if (!Number.isSafeInteger(chunkSizeBytes) || chunkSizeBytes < MIN_DRIVE_CHUNK_SIZE) {
    throw new Error("The upload chunk size is invalid.");
  }
  const alignedChunkSize = Math.floor(chunkSizeBytes / MIN_DRIVE_CHUNK_SIZE) * MIN_DRIVE_CHUNK_SIZE;
  let offset = 0;
  reportProgress(0, file.size, onProgress);

  while (offset < file.size) {
    const endExclusive = Math.min(offset + alignedChunkSize, file.size);
    const chunk = file.slice(offset, endExclusive);
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      try {
        const response = await fetchImpl(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Range": `bytes ${offset}-${endExclusive - 1}/${file.size}`,
          },
          body: chunk,
          signal,
        });

        if (response.ok) {
          const result = await readDriveResult(response);
          reportProgress(file.size, file.size, onProgress);
          return result;
        }
        if (response.status === 308) {
          const acknowledged = parseAcknowledgedByte(response.headers.get("Range"));
          if (acknowledged === null) {
            const probe = await probeUpload(fetchImpl, uploadUrl, file.size, signal);
            if (probe.complete) {
              reportProgress(file.size, file.size, onProgress);
              return probe.result;
            }
            if (probe.nextByte <= offset) {
              throw new Error("Google Drive did not report resumable upload progress.");
            }
            offset = probe.nextByte;
          } else {
            offset = acknowledged + 1;
          }
          reportProgress(offset, file.size, onProgress);
          break;
        }
        if (response.status === 404 || response.status === 410) {
          throw new Error("The Google Drive upload session expired. Start the upload again.");
        }
        if (response.status < 500) {
          const detail = (await response.text()).trim();
          throw new Error(detail || `Google Drive rejected the upload (${response.status}).`);
        }
        throw new Error(`Google Drive is temporarily unavailable (${response.status}).`);
      } catch (error) {
        if (signal?.aborted) throw error;
        const finalChunkMayHaveCompleted = endExclusive === file.size && error instanceof TypeError;
        if (attempt >= MAX_RETRIES) {
          if (finalChunkMayHaveCompleted) {
            throw new ResumableDriveUploadCompletionUncertainError();
          }
          throw error;
        }
        attempt += 1;
        await delay(500 * (2 ** attempt), signal);
        let probe: ProbeResult;
        try {
          probe = await probeUpload(fetchImpl, uploadUrl, file.size, signal);
        } catch (probeError) {
          if (finalChunkMayHaveCompleted) {
            throw new ResumableDriveUploadCompletionUncertainError();
          }
          throw probeError;
        }
        if (probe.complete) {
          reportProgress(file.size, file.size, onProgress);
          return probe.result;
        }
        const previousOffset = offset;
        offset = probe.nextByte;
        reportProgress(offset, file.size, onProgress);
        if (offset !== previousOffset) {
          // The server accepted some or all of this chunk. Re-slice from the
          // exact acknowledged byte on the next outer iteration.
          break;
        }
      }
    }
  }

  const finalProbe = await probeUpload(fetchImpl, uploadUrl, file.size, signal);
  if (finalProbe.complete) return finalProbe.result;
  throw new Error("Google Drive did not finish receiving the file.");
};
