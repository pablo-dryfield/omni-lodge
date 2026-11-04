import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Dialog } from "./Dialog";
type Metadata = {
  id: string;
  type: string;
  references: { hostId: string; actorId: number }[];
};
export function Credentials({
  revision,
  onSaved,
  onError,
}: {
  revision: string;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [items, setItems] = useState<Metadata[]>([]),
    [id, setId] = useState(""),
    [type, setType] = useState("privateKey"),
    [secret, setSecret] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Metadata | null>(null);
  useEffect(() => {
    let done = false;
    void api("/credential-metadata")
      .then((r) => {
        if (!done) setItems(r.credentials);
      })
      .catch(onError);
    return () => {
      done = true;
    };
  }, [revision]);
  const save = async (deleting = false) => {
    setBusy(true);
    try {
      await api("/credentials", {
        id: deleting ? remove?.id : id,
        ...(deleting
          ? { remove: true }
          : {
              value:
                type === "privateKey"
                  ? {
                      privateKey: secret,
                      passphrase,
                      revision: crypto.randomUUID(),
                    }
                  : { password: secret, revision: crypto.randomUUID() },
            }),
        revision,
        reason,
      });
      setSecret("");
      setPassphrase("");
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="card">
      <h3>SSH credentials</h3>
      <p className="muted">
        Encrypted and write-only. A replacement or revocation closes existing
        console authority. It does not remove a key from the remote server.
      </p>
      <div className="credential-list">
        {items.map((item) => (
          <div key={item.id}>
            <strong>{item.id}</strong>
            <small>
              {item.type === "privateKey" ? "SSH key" : "Password"} -{" "}
              {item.references
                .map((r) => `${r.hostId} / actor ${r.actorId}`)
                .join(", ") || "Not assigned"}
            </small>
            <button
              onClick={() => {
                setId(item.id);
                setType(item.type);
                setSecret("");
                setPassphrase("");
              }}
            >
              Replace
            </button>
            <button
              className="danger"
              onClick={() => {
                setRemove(item);
                setReason("");
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Credential ID
          <input
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Authentication
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setSecret("");
            }}
          >
            <option value="privateKey">SSH private key</option>
            <option value="password">Password</option>
          </select>
        </label>
        <label>
          {type === "privateKey" ? "Private key" : "SSH password"}
          {type === "privateKey" ? (
            <textarea
              required
              rows={7}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          ) : (
            <input
              required
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          )}
        </label>
        {type === "privateKey" && (
          <label>
            Key passphrase (if encrypted)
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </label>
        )}
        <label>
          Recorded reason
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Saving..." : "Save encrypted credential"}
        </button>
      </form>
      {remove && (
        <Dialog title={`Revoke ${remove.id}`} onClose={() => setRemove(null)}>
          <p>
            This credential will no longer be usable by the console.{" "}
            {remove.references.length} identity mappings refer to it.
          </p>
          <label>
            Recorded reason
            <textarea
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button onClick={() => setRemove(null)}>Cancel</button>
            <button
              className="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void save(true)}
            >
              Revoke credential
            </button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
