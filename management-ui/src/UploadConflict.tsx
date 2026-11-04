import { useState } from "react";
import { Dialog } from "./Dialog";
export type ConflictChoice = {
  choice: "overwrite" | "rename" | "skip" | "cancel";
  path?: string;
};
export function UploadConflict({
  path,
  size,
  onChoose,
}: {
  path: string;
  size: number;
  onChoose: (v: ConflictChoice) => void;
}) {
  const [name, setName] = useState(path),
    [confirm, setConfirm] = useState(false);
  return (
    <Dialog
      title="Destination already exists"
      onClose={() => onChoose({ choice: "cancel" })}
    >
      <p className="mono">{path}</p>
      <p>
        The existing file is {size.toLocaleString()} bytes. Replacement is
        checked again before publication. External processes on generic servers
        can still race with that check.
      </p>
      <label className="check-line">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        I intend to replace the reviewed file
      </label>
      <button
        disabled={!confirm}
        className="danger"
        onClick={() => onChoose({ choice: "overwrite" })}
      >
        Replace existing file
      </button>
      <hr />
      <label>
        Choose a different relative path
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button
          disabled={!name.trim() || name === path}
          onClick={() => onChoose({ choice: "rename", path: name })}
        >
          Use new name
        </button>
        <button onClick={() => onChoose({ choice: "skip" })}>Skip file</button>
        <button onClick={() => onChoose({ choice: "cancel" })}>
          Cancel queue
        </button>
      </div>
    </Dialog>
  );
}
