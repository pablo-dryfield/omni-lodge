import { useState } from "react";
import { Dialog } from "./Dialog";
import { api, ApiError } from "./api";
export type FileOperationSelection = {
  operation: string;
  entries: { path: string; version?: string; mode?: number }[];
};
const names: Record<string, string> = {
  mkdir: "Create folder",
  rename: "Move or rename",
  copy: "Copy file",
  chmod: "Change permissions",
  trash: "Move to trash",
  delete: "Permanently delete",
};
export function FileOperationDialog({
  selection,
  hostId,
  rootId,
  onClose,
  onChanged,
  onError,
}: {
  selection: FileOperationSelection;
  hostId: string;
  rootId: string;
  onClose: () => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const { operation, entries } = selection,
    destructive = ["delete", "trash"].includes(operation);
  const [target, setTarget] = useState(
      operation === "mkdir" ? "" : entries[0]?.path || "",
    ),
    [overwrite, setOverwrite] = useState(false),
    [mode, setMode] = useState(((entries[0]?.mode || 0) & 0o777).toString(8)),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [reviews, setReviews] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [completed, setCompleted] = useState(0);
  const invalidate = () => {
    setReviews(null);
    setConfirmation("");
  };
  const review = async () => {
    setBusy(true);
    setError("");
    try {
      const result = [];
      for (const entry of entries) {
        result.push(
          await api("/file-operations/review", {
            hostId,
            rootId,
            operation,
            path:
              operation === "mkdir"
                ? entry.path === "."
                  ? target
                  : `${entry.path}/${target}`
                : entry.path,
            version: entry.version,
            target: ["rename", "copy"].includes(operation) ? target : undefined,
            overwrite,
            mode: operation === "chmod" ? parseInt(mode, 8) : undefined,
            reason: reason.trim() || names[operation],
          }),
        );
      }
      setReviews(result);
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        ["STEP_UP_REQUIRED", "SESSION_EXPIRED", "POLICY_CHANGED"].includes(
          e.code,
        )
      ) {
        onClose();
        onError(e);
      }
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!reviews) return;
    setBusy(true);
    setError("");
    let count = 0;
    try {
      for (const review of reviews) {
        await api("/file-operations/execute", { id: review.id });
        count++;
        setCompleted(count);
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(
        `${count ? `${count} item${count === 1 ? "" : "s"} completed. ` : ""}${(e as Error).message} Remaining items were not submitted.`,
      );
      onChanged();
      if (
        e instanceof ApiError &&
        ["STEP_UP_REQUIRED", "SESSION_EXPIRED", "POLICY_CHANGED"].includes(
          e.code,
        )
      ) {
        onClose();
        onError(e);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={names[operation] || operation} onClose={onClose}>
      <div className="form-stack">
        <p className="muted">
          {hostId} / {rootId} ·{" "}
          {entries.length === 1
            ? entries[0].path
            : `${entries.length} selected items`}
        </p>
        {entries.length > 1 && (
          <ul className="scope-list">
            {entries.map((entry) => (
              <li key={entry.path}>{entry.path}</li>
            ))}
          </ul>
        )}
        {["mkdir", "rename", "copy"].includes(operation) && (
          <label>
            {operation === "mkdir" ? "Folder name" : "Destination path"}
            <input
              autoFocus
              value={target}
              disabled={busy}
              onChange={(event) => {
                setTarget(event.target.value);
                invalidate();
              }}
              placeholder={
                operation === "mkdir"
                  ? "New folder"
                  : "Relative path inside this root"
              }
            />
          </label>
        )}
        {operation === "copy" && (
          <label className="check-line">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(event) => {
                setOverwrite(event.target.checked);
                invalidate();
              }}
            />
            Allow replacing the destination after checking its current identity
            and checksum
          </label>
        )}
        {operation === "chmod" && (
          <label>
            Permission bits (octal)
            <input
              autoFocus
              inputMode="numeric"
              value={mode}
              disabled={busy}
              onChange={(event) => {
                setMode(event.target.value);
                invalidate();
              }}
              pattern="[0-7]{3}"
            />
            <small className="muted">
              Special permission bits and owner changes are not available.
            </small>
          </label>
        )}
        <label>
          {destructive ? "Reason" : "Note for activity history"}
          <input
            autoFocus={destructive}
            value={reason}
            disabled={busy}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              invalidate();
            }}
            placeholder={
              destructive
                ? "Why should these items be removed?"
                : "Optional context"
            }
          />
        </label>
        {reviews && (
          <div role="status" className="review-summary">
            <strong>Ready for confirmation</strong>
            <p>
              {operation === "delete"
                ? "This permanently removes the selected files. It cannot be undone."
                : operation === "trash"
                  ? "Items remain recoverable in this root until their retention expires."
                  : "The reviewed source and destination will be checked again before execution."}
            </p>
            {reviews.some((r) => r.affectedEntries !== undefined) && (
              <p>
                {reviews.reduce(
                  (sum, r) => sum + Number(r.affectedEntries || 0),
                  0,
                )}{" "}
                nested entries included.
              </p>
            )}
            <small>
              Review expires in one minute. Changes invalidate this review.
            </small>
          </div>
        )}
        {reviews && operation === "delete" && (
          <label>
            Type DELETE to confirm
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
        )}
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        {busy && (
          <p role="status" className="muted">
            Submitted operations continue if you close this dialog. Follow them
            in Transfers.
          </p>
        )}
        <footer className="dialog-actions">
          <button onClick={onClose}>
            {busy ? "Continue in Transfers" : completed ? "Close" : "Cancel"}
          </button>
          {!reviews ? (
            <button
              className="primary"
              disabled={
                busy ||
                (destructive && reason.trim().length < 3) ||
                (["mkdir", "rename", "copy"].includes(operation) &&
                  !target.trim()) ||
                (operation === "chmod" && !/^[0-7]{3}$/.test(mode))
              }
              onClick={() => void review()}
            >
              {busy ? "Checking…" : "Review change"}
            </button>
          ) : (
            <button
              className={destructive ? "danger" : "primary"}
              disabled={
                busy ||
                completed > 0 ||
                (operation === "delete" && confirmation !== "DELETE")
              }
              onClick={() => void execute()}
            >
              {busy
                ? `Processing ${completed}/${reviews.length}…`
                : names[operation]}
            </button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}
