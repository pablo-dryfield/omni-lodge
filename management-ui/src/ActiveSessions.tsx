import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Dialog } from "./Dialog";
type Active = {
  id: string;
  actorId: number;
  hostId: string;
  managed: boolean;
  attached: boolean;
  expiresAt: string;
};
export function ActiveSessions({
  actorId,
  hostId,
  onAttach,
  onError,
}: {
  actorId: number;
  hostId: string;
  onAttach: (s: Active) => void;
  onError: (e: unknown) => void;
}) {
  const [items, setItems] = useState<Active[]>([]),
    [target, setTarget] = useState<Active | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => api("/sessions").then((r) => setItems(r.sessions));
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api("/sessions")
        .then((r) => {
          if (alive) setItems(r.sessions);
        })
        .catch((e) => {
          if (alive) onError(e);
        });
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [actorId, hostId]);
  const terminate = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api(`/terminals/${target.id}/terminate`, { reason });
      setTarget(null);
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="card active-sessions">
      <div className="section-heading">
        <h3>Active terminals</h3>
        <button onClick={() => void refresh().catch(onError)}>Refresh</button>
      </div>
      {items.filter((x) => x.hostId === hostId).length ? (
        items
          .filter((x) => x.hostId === hostId)
          .map((item) => (
            <div className="session-row" key={item.id}>
              <div>
                <strong>
                  {item.actorId === actorId
                    ? "Your session"
                    : `Administrator #${item.actorId}`}
                </strong>
                <small>
                  {item.attached ? "Connected" : "Retained, disconnected"} -
                  expires {new Date(item.expiresAt).toLocaleTimeString()}
                </small>
                <small className="mono">{item.id}</small>
              </div>
              {item.actorId === actorId && (
                <button onClick={() => onAttach(item)}>Open terminal</button>
              )}
              <button
                className="danger"
                onClick={() => {
                  setTarget(item);
                  setReason("");
                }}
              >
                End session
              </button>
            </div>
          ))
      ) : (
        <p className="muted">No active terminals on this server.</p>
      )}
      {target && (
        <Dialog title="End terminal session" onClose={() => setTarget(null)}>
          <p>
            {target.managed
              ? "The managed process group will be stopped; its watchdog also bounds orphan lifetime."
              : "The SSH connection will close. Processes detached on a generic server may continue."}
          </p>
          <label>
            Recorded reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </label>
          <div className="dialog-actions">
            <button onClick={() => setTarget(null)}>Cancel</button>
            <button
              disabled={busy || reason.trim().length < 3}
              className="danger"
              onClick={() => void terminate()}
            >
              End session
            </button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
