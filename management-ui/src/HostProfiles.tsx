import { useEffect, useMemo, useRef, useState } from "react";
type Identity = {
  username: string;
  credentialId: string;
  fileUsername?: string;
  fileCredentialId?: string;
};
type Root = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
  managed: boolean;
};
type Profile = {
  id: string;
  name: string;
  environment: string;
  hostname: string;
  port: number;
  addresses: string[];
  fingerprints: string[];
  enabled: boolean;
  managed: boolean;
  identities: Record<string, Identity>;
  roots: Root[];
  services: string[];
};
export function HostProfiles({
  value,
  onChange,
  onSave,
  onTest,
  busy = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: (profiles: Profile[], reason: string) => void;
  onTest: (hostId: string) => void;
  busy?: boolean;
}) {
  const profiles = useMemo(() => {
    try {
      const parsed = JSON.parse(value);
      const valid =
        Array.isArray(parsed) &&
        parsed.every(
          (p) =>
            p &&
            typeof p === "object" &&
            ["id", "name", "hostname", "environment"].every(
              (key) => typeof p[key] === "string",
            ) &&
            typeof p.port === "number" &&
            typeof p.enabled === "boolean" &&
            typeof p.managed === "boolean" &&
            ["addresses", "fingerprints", "services"].every(
              (key) =>
                Array.isArray(p[key]) &&
                p[key].every((s: unknown) => typeof s === "string"),
            ) &&
            Array.isArray(p.roots) &&
            p.roots.every(
              (r: any) =>
                r &&
                ["id", "name", "path"].every(
                  (key) => typeof r[key] === "string",
                ) &&
                typeof r.writable === "boolean" &&
                typeof r.managed === "boolean",
            ) &&
            p.identities &&
            typeof p.identities === "object" &&
            Object.values(p.identities).every(
              (i: any) =>
                i &&
                typeof i.username === "string" &&
                typeof i.credentialId === "string",
            ),
        );
      return valid ? (parsed as Profile[]) : null;
    } catch {
      return null;
    }
  }, [value]);
  const [selected, setSelected] = useState(""),
    [reason, setReason] = useState(""),
    [verified, setVerified] = useState(false),
    [actor, setActor] = useState(""),
    [error, setError] = useState("");
  const [rawFields, setRawFields] = useState<Record<string, string>>({});
  const baseline = useRef(new Map<string, string>()),
    initialized = useRef(false);
  useEffect(() => {
    if (profiles && !initialized.current && value) {
      for (const profile of profiles)
        baseline.current.set(profile.id, profile.fingerprints.join("\n"));
      initialized.current = true;
    }
  }, [profiles, value]);
  const profile = profiles?.find((p) => p.id === selected) || profiles?.[0];
  const write = (items: Profile[]) => onChange(JSON.stringify(items, null, 2));
  const update = (patch: Partial<Profile>) => {
    if (profile && profiles) {
      write(
        profiles.map((item) =>
          item.id === profile.id ? { ...item, ...patch } : item,
        ),
      );
      if ("fingerprints" in patch) setVerified(false);
    }
  };
  const updateIdentity = (id: string, patch: Partial<Identity>) => {
    if (profile)
      update({
        identities: {
          ...profile.identities,
          [id]: { ...profile.identities[id], ...patch },
        },
      });
  };
  const updateRoot = (index: number, patch: Partial<Root>) => {
    if (profile)
      update({
        roots: profile.roots.map((root, i) =>
          i === index ? { ...root, ...patch } : root,
        ),
      });
  };
  const needsVerification = Boolean(
    profiles?.some(
      (item) => baseline.current.get(item.id) !== item.fingerprints.join("\n"),
    ),
  );
  return (
    <article className="card host-profiles">
      <div className="section-heading">
        <div>
          <h3>Server profiles</h3>
          <p className="muted">
            Enroll a restricted SSH account and verify its host key using a
            trusted source.
          </p>
        </div>
        <button
          type="button"
          disabled={!profiles || busy}
          onClick={() => {
            if (!profiles) return;
            const id = "server-" + crypto.randomUUID().slice(0, 8);
            write([
              ...profiles,
              {
                id,
                name: "New server",
                environment: "staging",
                hostname: "",
                port: 22,
                addresses: [],
                fingerprints: [],
                enabled: false,
                managed: false,
                identities: {},
                roots: [],
                services: [],
              },
            ]);
            setSelected(id);
            setVerified(false);
          }}
        >
          Add server
        </button>
      </div>
      {profiles && profiles.length > 0 && (
        <>
          <label>
            Server
            <select
              value={profile?.id}
              onChange={(event) => {
                setSelected(event.target.value);
                setRawFields({});
                setVerified(false);
                setError("");
              }}
            >
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </label>
          {profile && (
            <div className="form-stack">
              <div className="form-grid">
                <label>
                  Name
                  <input
                    required
                    value={profile.name}
                    maxLength={100}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <label>
                  Environment
                  <select
                    value={profile.environment}
                    onChange={(event) =>
                      update({ environment: event.target.value })
                    }
                  >
                    {["production", "staging", "development"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Hostname or IP
                  <input
                    value={profile.hostname}
                    required
                    autoComplete="off"
                    onChange={(event) =>
                      update({ hostname: event.target.value })
                    }
                  />
                </label>
                <label>
                  SSH port
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={profile.port}
                    onChange={(event) =>
                      update({ port: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Permitted IP addresses
                  <textarea
                    rows={3}
                    value={rawFields.addresses ?? profile.addresses.join("\n")}
                    onChange={(event) => {
                      setRawFields((current) => ({
                        ...current,
                        addresses: event.target.value,
                      }));
                      update({
                        addresses: event.target.value
                          .split(/[\n,]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder={"One IP per line\n203.0.113.10"}
                  />
                  <small className="muted">
                    Every DNS answer must match an enrolled address.
                  </small>
                </label>
                <label>
                  Trusted host-key fingerprints
                  <textarea
                    rows={3}
                    value={
                      rawFields.fingerprints ?? profile.fingerprints.join("\n")
                    }
                    onChange={(event) => {
                      setRawFields((current) => ({
                        ...current,
                        fingerprints: event.target.value,
                      }));
                      update({
                        fingerprints: event.target.value
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="SHA256:..."
                  />
                  <small className="muted">
                    Copy the SHA256 fingerprint from the server or provider
                    console.
                  </small>
                </label>
              </div>
              {needsVerification && (
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={verified}
                    onChange={(event) => setVerified(event.target.checked)}
                  />
                  I independently verified all changed host-key fingerprints.
                </label>
              )}
              <div className="inline-options">
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={profile.enabled}
                    onChange={(event) =>
                      update({ enabled: event.target.checked })
                    }
                  />
                  Enabled
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={profile.managed}
                    onChange={(event) =>
                      update({ managed: event.target.checked })
                    }
                  />
                  Managed Linux adapter installed
                </label>
              </div>
              {!profile.managed && (
                <p className="muted">
                  Generic servers use their remote account's OS permissions.
                  Uploads also require capacity reporting; managed trash and
                  service actions require the Linux adapter.
                </p>
              )}
              <details>
                <summary>
                  Administrator identity bindings (
                  {Object.keys(profile.identities).length})
                </summary>
                <div className="binding-list">
                  {Object.entries(profile.identities).map(([id, identity]) => (
                    <fieldset key={id}>
                      <legend>Administrator #{id}</legend>
                      <div className="form-grid">
                        <label>
                          SSH username
                          <input
                            value={identity.username}
                            onChange={(event) =>
                              updateIdentity(id, {
                                username: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          SSH credential ID
                          <input
                            value={identity.credentialId}
                            onChange={(event) =>
                              updateIdentity(id, {
                                credentialId: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          SFTP username (optional)
                          <input
                            value={identity.fileUsername || ""}
                            onChange={(event) =>
                              updateIdentity(id, {
                                fileUsername: event.target.value || undefined,
                              })
                            }
                          />
                        </label>
                        <label>
                          SFTP credential ID (optional)
                          <input
                            value={identity.fileCredentialId || ""}
                            onChange={(event) =>
                              updateIdentity(id, {
                                fileCredentialId:
                                  event.target.value || undefined,
                              })
                            }
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          const identities = { ...profile.identities };
                          delete identities[id];
                          update({ identities });
                        }}
                      >
                        Remove binding
                      </button>
                    </fieldset>
                  ))}
                </div>
                <div className="inline-options">
                  <input
                    aria-label="New administrator ID"
                    placeholder="Administrator user ID"
                    inputMode="numeric"
                    value={actor}
                    onChange={(event) => setActor(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !/^[1-9][0-9]*$/.test(actor) ||
                        profile.identities[actor]
                      ) {
                        setError(
                          "Choose a new positive administrator user ID.",
                        );
                        return;
                      }
                      update({
                        identities: {
                          ...profile.identities,
                          [actor]: { username: "", credentialId: "" },
                        },
                      });
                      setActor("");
                      setError("");
                    }}
                  >
                    Add binding
                  </button>
                </div>
                <p className="muted">
                  Host action grants are managed in Control Panel. Managed
                  identities must also be provisioned in the root-owned host
                  policy.
                </p>
              </details>
              <details>
                <summary>Approved file roots ({profile.roots.length})</summary>
                <div className="binding-list">
                  {profile.roots.map((root, index) => (
                    <fieldset key={index}>
                      <div className="form-grid">
                        <label>
                          Root ID
                          <input
                            value={root.id}
                            onChange={(event) =>
                              updateRoot(index, { id: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Label
                          <input
                            value={root.name}
                            onChange={(event) =>
                              updateRoot(index, { name: event.target.value })
                            }
                          />
                        </label>
                        <label className="span-all">
                          Absolute path in this SFTP account
                          <input
                            value={root.path}
                            onChange={(event) =>
                              updateRoot(index, { path: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <div className="inline-options">
                        <label className="check-line">
                          <input
                            type="checkbox"
                            checked={root.writable}
                            onChange={(event) =>
                              updateRoot(index, {
                                writable: event.target.checked,
                              })
                            }
                          />
                          Writable
                        </label>
                        <label className="check-line">
                          <input
                            type="checkbox"
                            checked={root.managed}
                            onChange={(event) =>
                              updateRoot(index, {
                                managed: event.target.checked,
                              })
                            }
                          />
                          Managed root
                        </label>
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            update({
                              roots: profile.roots.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          Remove root
                        </button>
                      </div>
                    </fieldset>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    update({
                      roots: [
                        ...profile.roots,
                        {
                          id: "root-" + (profile.roots.length + 1),
                          name: "Work files",
                          path: "/work",
                          writable: false,
                          managed: profile.managed,
                        },
                      ],
                    })
                  }
                >
                  Add file root
                </button>
              </details>
              <label>
                Approved service IDs
                <input
                  value={rawFields.services ?? profile.services.join(", ")}
                  placeholder="backend, ui"
                  onChange={(event) => {
                    setRawFields((current) => ({
                      ...current,
                      services: event.target.value,
                    }));
                    update({
                      services: event.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                  }}
                />
              </label>
              <div className="inline-options">
                <button type="button" onClick={() => onTest(profile.id)}>
                  Test saved connection
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    write(profiles.filter((item) => item.id !== profile.id));
                    setSelected("");
                  }}
                >
                  Remove profile from draft
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {profiles?.length === 0 && (
        <p>No server profiles. Add a server to begin.</p>
      )}
      <details className="advanced-profile">
        <summary>Advanced profile JSON</summary>
        <textarea
          className="json-editor"
          aria-label="Server profile JSON"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setRawFields({});
            setVerified(false);
          }}
          spellCheck={false}
        />
      </details>
      <label>
        Reason for saving
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Describe the enrollment or configuration change"
          maxLength={500}
        />
      </label>
      {(!profiles || error) && (
        <div role="alert" className="alert">
          {error || "The profile JSON must be an array of server profiles."}
        </div>
      )}
      <button
        className="primary"
        disabled={
          busy ||
          !profiles ||
          reason.trim().length < 3 ||
          (needsVerification && !verified)
        }
        onClick={() => {
          if (profiles) onSave(profiles, reason.trim());
        }}
      >
        Save server profiles
      </button>
    </article>
  );
}
