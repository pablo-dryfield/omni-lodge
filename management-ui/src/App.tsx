import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  IconTerminal2,
  IconFolder,
  IconArrowsTransferUp,
  IconActivity,
  IconServer,
  IconSettings,
  IconPlus,
  IconRefresh,
  IconArrowUp,
  IconUpload,
  IconDownload,
  IconSearch,
  IconX,
  IconShieldLock,
  IconLogout,
} from "@tabler/icons-react";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  api,
  ApiError,
  query,
  setCsrf,
  uploadChunk,
  type Session,
  type Host,
} from "./api";
import { TerminalPane, type TerminalTab } from "./TerminalPane";
import { TextEditor, type Document } from "./TextEditor";
import "./styles.css";

type Entry = {
  name: string;
  path: string;
  size: string;
  mtime: number;
  mode: number;
  type: string;
  version: string;
  uid: number;
  gid: number;
};
type Job = {
  id: string;
  hostId: string;
  kind: string;
  state: string;
  data: Record<string, any>;
  updatedAt: string;
};
type Section =
  | "overview"
  | "terminal"
  | "files"
  | "transfers"
  | "services"
  | "activity"
  | "settings";
const sections: { id: Section; name: string; icon: React.ElementType }[] = [
  { id: "overview", name: "Overview", icon: IconServer },
  { id: "terminal", name: "Terminal", icon: IconTerminal2 },
  { id: "files", name: "Files", icon: IconFolder },
  { id: "transfers", name: "Transfers", icon: IconArrowsTransferUp },
  { id: "services", name: "Services & logs", icon: IconSettings },
  { id: "activity", name: "Activity", icon: IconActivity },
];
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : value < 1073741824
        ? `${(value / 1048576).toFixed(1)} MB`
        : `${(value / 1073741824).toFixed(2)} GB`;
const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [section, setSection] = useState<Section>("overview"),
    [hostId, setHostId] = useState(""),
    [rootId, setRootId] = useState("");
  const [stepUp, setStepUp] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [tabs, setTabs] = useState<TerminalTab[]>([]),
    [activeTab, setActiveTab] = useState(""),
    [split, setSplit] = useState(false);
  const [currentPath, setCurrentPath] = useState("."),
    [pathInput, setPathInput] = useState("."),
    [entries, setEntries] = useState<Entry[]>([]),
    [complete, setComplete] = useState(true),
    [filter, setFilter] = useState(""),
    [hidden, setHidden] = useState(false),
    [sort, setSort] = useState("name"),
    [descending, setDescending] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0);
  const [recordingList,setRecordingList]=useState<any[]|null>(null),[recordingPreview,setRecordingPreview]=useState<any>(null);
  const [comparison, setComparison] = useState<any>(null),
    [trashEntries, setTrashEntries] = useState<any[] | null>(null);
  const [document, setDocument] = useState<Document | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [activity, setActivity] = useState<any[]>([]),
    [overview, setOverview] = useState<any>(null),
    [services, setServices] = useState<any[]>([]),
    [serviceId, setServiceId] = useState(""),
    [logs, setLogs] = useState(""),
    [following, setFollowing] = useState(false);
  const [hostDraft, setHostDraft] = useState(""),
    [credentialId, setCredentialId] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [passphrase, setPassphrase] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
      name: string;
      done: number;
      total: number;
    } | null>(null),
    [searchPath, setSearchPath] = useState("");
  const pendingResume = useRef<Job | null>(null);
  const abortUpload = useRef(false),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null);
  const host = session?.hosts.find((h) => h.id === hostId),
    root = host?.roots.find((r) => r.id === rootId);
  useEffect(()=>{if(!session)return;let last=0;const touch=()=>{if(Date.now()-last<15000)return;last=Date.now();void api('/session/touch',{}).catch(()=>{});};window.addEventListener('pointerdown',touch);window.addEventListener('keydown',touch);return()=>{window.removeEventListener('pointerdown',touch);window.removeEventListener('keydown',touch);};},[session?.actorId]);
  const onError = useCallback((value: unknown) => {
    const e = value as Error;
    setError(e.message || "Operation failed.");
    if (value instanceof ApiError && value.code === "STEP_UP_REQUIRED")
      setStepUp(true);
    if (
      value instanceof ApiError &&
      ["SESSION_EXPIRED", "POLICY_CHANGED","CSRF_REJECTED"].includes(value.code)
    ) {
      setDocument(null);
      setTabs([]);
      setSession(null);
    }
  }, []);
  const refresh = useCallback(async () => {
    const result = await api<Session>("/session");
    setCsrf(result.csrf);
    setSession(result);
    setHostId((previous) =>
      result.hosts.some((h) => h.id === previous)
        ? previous
        : result.hosts[0]?.id || "",
    );
    return result;
  }, []);
  useEffect(() => {
    let done = false;
    const init = async () => {
      try {
        const result = await refresh();
        if (!result.stepUpUntil || Date.parse(result.stepUpUntil) < Date.now())
          setStepUp(true);
        return true;
      } catch (e) {
        if (!done) setError((e as Error).message);
        return false;
      } finally {
        if (!done) setLoading(false);
      }
    };
    const receive = async (e: MessageEvent) => {
      const expected =
        location.hostname === "localhost"
          ? "http://localhost:3000"
          : "https://omni-lodge.com";
      if (
        e.origin !== expected ||
        e.source !== window.parent ||
        e.data?.type !== "omnilodge-management-launch" ||
        typeof e.data?.grant !== "string" ||
        typeof e.data?.nonce !== "string"
      )
        return;
      try {
        await api("/session/redeem", { grant: e.data.grant });
        await init();
        window.parent.postMessage(
          { type: "omnilodge-management-launched", nonce: e.data.nonce },
          expected,
        );
      } catch (error) {
        onError(error);
      }
    };
    window.addEventListener("message", receive);
    void init().then(valid=>{if(!valid&&window.parent!==window)window.parent.postMessage({type:'omnilodge-management-ready'},location.hostname==='localhost'?'http://localhost:3000':'https://omni-lodge.com');});
    return () => {
      done = true;
      window.removeEventListener("message", receive);
    };
  }, [refresh, onError]);
  useEffect(() => {
    setRootId(host?.roots[0]?.id || "");
    setCurrentPath(".");
    setPathInput(".");
    setEntries([]);
    setSelected([]);
    setOverview(null);
    setServices([]);
    setServiceId(host?.services[0] || "");
  }, [hostId]);
  const loadFiles = useCallback(
    async (path = currentPath) => {
      if (!hostId || !rootId) return;
      setBusy(true);
      try {
        const result = await api(
          `/files/list?${query({ hostId, rootId, path })}`,
        );
        setEntries(result.entries);
        setComplete(result.complete);
        setCurrentPath(result.path);
        setPathInput(result.path);
        setSelected([]);
        setPage(0);
      } catch (e) {
        onError(e);
      } finally {
        setBusy(false);
      }
    },
    [hostId, rootId, currentPath, onError],
  );
  useEffect(() => {
    if (section === "files" && rootId) void loadFiles(".");
  }, [section, hostId, rootId]);
  const loadJobs = useCallback(async () => {
    try {
      setJobs((await api("/jobs")).jobs);
    } catch (e) {
      onError(e);
    }
  }, [onError]);
  useEffect(() => {
    if (!session) return;
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 5000);
    return () => clearInterval(timer);
  }, [session?.actorId, loadJobs]);
  useEffect(() => {
    if (!hostId || !session) return;
    if (section === "overview")
      void api(`/overview?${query({ hostId })}`)
        .then(setOverview)
        .catch(onError);
    if (section === "services")
      void api(`/services?${query({ hostId })}`)
        .then((result) => setServices(result.services || []))
        .catch(onError);
    if (section === "activity")
      void api("/activity")
        .then((result) => setActivity(result.events))
        .catch(onError);
  }, [section, hostId, session?.actorId]);
  useEffect(() => {
    if (!following || !serviceId) return;
    const timer = setInterval(
      () =>
        void api(`/logs?${query({ hostId, serviceId })}`)
          .then((result) => setLogs(result.output || ""))
          .catch(onError),
      3000,
    );
    return () => clearInterval(timer);
  }, [following, hostId, serviceId]);
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/session/step-up", { password });
      setPassword("");
      setStepUp(false);
      await refresh();
      setError("");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const openTerminal = async () => {
    setBusy(true);
    try {
      const result = await api("/terminals", { hostId });
      const tab = {
        ...result,
        title: `${host?.name} · ${tabs.filter((t) => t.hostId === hostId).length + 1}`,
      };
      setTabs((t) => [...t, tab]);
      setActiveTab(tab.id);
      setSection("terminal");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const fileAction = async (operation: string, entry?: Entry) => {
    if (!hostId || !rootId) return;
    const input: Record<string, unknown> = {
      hostId,
      rootId,
      operation,
      path: entry?.path || currentPath,
      version: entry?.version,
    };
    if (operation === "mkdir") {
      const name = prompt("New folder name");
      if (!name) return;
      input.path = currentPath === "." ? name : `${currentPath}/${name}`;
    }
    if (["rename", "copy"].includes(operation)) {
      const target = prompt("Destination relative path", entry?.path);
      if (!target) return;
      input.target = target;
    }
    if (operation === "chmod") {
      const mode = prompt(
        "Permissions (octal, e.g. 644)",
        ((entry?.mode || 0) & 0o777).toString(8),
      );
      if (!mode) return;
      input.mode = parseInt(mode, 8);
    }
    try {
      const review = await api("/file-operations/review", input);
      if (
        !confirm(
          `${operation === "delete" ? "Permanently delete" : operation} ${input.path}${input.target ? ` → ${input.target}` : ""}?${review.warning ? `\n${review.warning}` : ""}`,
        )
      )
        return;
      await api("/file-operations/execute", { id: review.id });
      await loadFiles();
      setNotice("File operation completed.");
    } catch (e) {
      onError(e);
    }
  };
  const openFile = async (entry: Entry) => {
    if (entry.type === "directory") {
      void loadFiles(entry.path);
      return;
    }
    if (entry.type !== "file") {
      setNotice(
        "Links and special files can be inspected but are not followed.",
      );
      return;
    }
    try {
      setDocument(
        await api(
          `/files/content?${query({ hostId, rootId, path: entry.path })}`,
        ),
      );
    } catch (e) {
      onError(e);
    }
  };
  const download = async (entry: Entry) => {
    try {
      const route = `/download${entry.type === "directory" ? "-folder" : ""}?${query({ hostId, rootId, path: entry.path })}`;
      const response = await fetch(`/management${route}`);
      if (!response.ok) {
        const result = await response.json();
        throw new ApiError(result.code, result.message);
      }
      const picker = (window as any).showSaveFilePicker;
      if (picker) {
        const handle = await picker({
            suggestedName:
              entry.name + (entry.type === "directory" ? ".zip" : ""),
          }),
          writer = await handle.createWritable(),
          reader = response.body!.getReader();
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            await writer.write(part.value);
          }
          await writer.close();
          setNotice(`Saved ${entry.name}.`);
        } catch (e) {
          await writer.abort();
          throw e;
        }
      } else {
        await response.body?.cancel();
        const link = documentGlobal.createElement("a");
        link.href = `/management${route}`;
        link.download = entry.name;
        link.click();
        setNotice(
          "Download handed to browser. Check its download manager for completion.",
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") onError(e);
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    abortUpload.current = false;
    try {
      for (const file of Array.from(files)) {
        if (abortUpload.current) break;
        const relative =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        const destination =
          currentPath === "." ? relative : `${currentPath}/${relative}`;
        setUploadProgress({
          name: `Checking ${relative}`,
          done: 0,
          total: file.size,
        });
        const hash = sha256.create(),
          reader = file.stream().getReader();
        let hashed = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          hash.update(part.value);
          hashed += part.value.length;
          setUploadProgress({
            name: `Checking ${relative}`,
            done: hashed,
            total: file.size,
          });
          if (abortUpload.current) {
            await reader.cancel();
            break;
          }
        }
        if (abortUpload.current) break;
        const sourceHash = hex(hash.digest());
        const resume = pendingResume.current;
        if (
          resume &&
          (resume.data.sha256 !== sourceHash ||
            Number(resume.data.size) !== file.size)
        ) {
          throw new Error(
            "This is not the original source file. Its complete checksum differs.",
          );
        }
        const job = resume
          ? await api(`/transfers/${resume.id}/resume`, { sha256: sourceHash })
          : await api("/transfers", {
              hostId,
              rootId,
              path: destination,
              size: file.size,
              sha256: sourceHash,
              createParents: relative.includes("/"),
              idempotencyKey: crypto.randomUUID(),
            });
        pendingResume.current = null;
        for (let offset = Number(job.data.offset) || 0; offset < file.size; ) {
          if (abortUpload.current) {
            await api(`/transfers/${job.id}/cancel`, {});
            break;
          }
          const chunk = new Uint8Array(
            await file.slice(offset, offset + Number((session?.limits.SYSTEM_MANAGEMENT_TRANSFER_LIMITS as {chunkBytes?:number})?.chunkBytes||4194304)).arrayBuffer(),
          );
          await uploadChunk(job.id, offset, chunk, hex(sha256(chunk)));
          offset += chunk.length;
          setUploadProgress({ name: relative, done: offset, total: file.size });
        }
        if (!abortUpload.current) await api(`/transfers/${job.id}/publish`, {});
        await loadJobs();
      }
      await loadFiles();
      setNotice(
        abortUpload.current
          ? "Upload paused or cancellation requested. Check Transfers."
          : "Uploads verified and published.",
      );
    } catch (e) {
      onError(e);
      setNotice("Upload stopped. Check Transfers before retrying.");
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  };
  const selectedEntries = entries.filter((e) => selected.includes(e.path));
  const visible = entries
    .filter(
      (e) =>
        (hidden || !e.name.startsWith(".")) &&
        e.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    )
    .sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (b.type === "directory" && a.type !== "directory") return 1;
      const value =
        sort === "size"
          ? Number(a.size) - Number(b.size)
          : sort === "mtime"
            ? a.mtime - b.mtime
            : a.name.localeCompare(b.name);
      return descending ? -value : value;
    });
  if (loading)
    return (
      <main className="launch-state">
        <div className="brand-mark">OL</div>
        <h1>Opening System Management</h1>
        <p>Checking your administration session…</p>
      </main>
    );
  if (!session)
    return (
      <main className="launch-state">
        <div className="brand-mark">OL</div>
        <h1>System Management</h1>
        <p>{error || "Open this workspace from Settings in OmniLodge."}</p>
        <a
          className="button primary"
          href={
            location.hostname === "localhost"
              ? "http://localhost:3000/settings/system-management"
              : "https://omni-lodge.com/settings/system-management"
          }
          target="_top"
        >
          Open Settings
        </a>
      </main>
    );
  return (
    <div className="workspace">
      <header className="workspace-header">
        <div className="brand-mark">OL</div>
        <div className="workspace-title">
          <span className="eyebrow">OmniLodge</span>
          <h1>System Management</h1>
        </div>
        <div className="spacer" />
        <span className={`environment ${host?.environment || ""}`}>
          {host?.environment || "No server"}
        </span>
        <button
          className="icon-button"
          title="Confirm administrator access"
          aria-label="Confirm administrator access"
          onClick={() => setStepUp(true)}
        >
          <IconShieldLock size={20} />
        </button>
        <button
          className="icon-button"
          title="Sign out of console"
          aria-label="Sign out of console"
          onClick={() =>
            void api("/session/logout", {})
              .then(() => {
                setTabs([]);
                setDocument(null);
                setSession(null);
              })
              .catch(onError)
          }
        >
          <IconLogout size={20} />
        </button>
      </header>
      <div className="identity-bar">
        <label>
          Server
          <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
            {session.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
            {!session.hosts.length && (
              <option value="">No servers enrolled</option>
            )}
          </select>
        </label>
        <div className="identity-detail">
          <span className="muted">Remote identity</span>
          <strong>{host?.username || "—"}</strong>
        </div>
        <div className="identity-detail">
          <span className="muted">Host</span>
          <strong>{host ? `${host.hostname}:${host.port}` : "—"}</strong>
        </div>
        <div className="spacer" />
        <button
          disabled={!host || busy}
          className="primary"
          onClick={() => void openTerminal()}
        >
          <IconTerminal2 size={18} />
          New terminal
        </button>
        <button
          onClick={() => {
            void api("/profiles")
              .then((result) =>
                setHostDraft(JSON.stringify(result.hosts, null, 2)),
              )
              .catch(onError);
            setSection("settings");
          }}
        >
          Manage servers
        </button>
      </div>
      <nav className="workspace-tabs" aria-label="System workspace">
        {sections.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? "active" : ""}
            onClick={() => setSection(s.id)}
          >
            <s.icon size={18} />
            <span>{s.name}</span>
            {s.id === "transfers" &&
              jobs.filter((j) =>
                ["paused", "transferring", "publishing"].includes(j.state),
              ).length > 0 && (
                <span className="count">
                  {
                    jobs.filter((j) =>
                      ["paused", "transferring", "publishing"].includes(
                        j.state,
                      ),
                    ).length
                  }
                </span>
              )}
          </button>
        ))}
      </nav>
      {error && (
        <div role="alert" className="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <IconX size={18} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <IconX size={16} />
          </button>
        </div>
      )}
      <main className="workspace-main">
        {section === "overview" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Infrastructure</span>
                <h2>{host?.name || "Your servers"}</h2>
                <p className="muted">
                  Live host health and administration activity.
                </p>
              </div>
              <button
                onClick={() =>
                  void api(`/overview?${query({ hostId })}`)
                    .then(setOverview)
                    .catch(onError)
                }
                disabled={!host}
              >
                <IconRefresh size={18} />
                Refresh
              </button>
            </div>
            {!host ? (
              <div className="empty-state">
                <IconServer size={42} />
                <h3>Enroll your first server</h3>
                <p>
                  Add its SSH details, verify its fingerprint, and assign an
                  operational identity.
                </p>
                <button onClick={() => setSection("settings")}>
                  Manage servers
                </button>
              </div>
            ) : (
              <>
                <div className="metric-grid">
                  {[
                    [
                      "CPU",
                      overview?.cpuPercent == null
                        ? "Unavailable"
                        : `${overview.cpuPercent}%`,
                    ],
                    [
                      "Memory",
                      overview?.memoryUsedBytes === undefined
                        ? "Unavailable"
                        : bytes(Number(overview.memoryUsedBytes)),
                    ],
                    [
                      "Disk free",
                      overview?.diskFreeBytes === undefined
                        ? "Unavailable"
                        : bytes(Number(overview.diskFreeBytes)),
                    ],
                    [
                      "Uptime",
                      overview?.uptimeSeconds === undefined
                        ? "Unavailable"
                        : `${Math.floor(Number(overview.uptimeSeconds) / 3600)}h ${Math.floor((Number(overview.uptimeSeconds) % 3600) / 60)}m`,
                    ],
                  ].map(([label, value]) => (
                    <article className="metric" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </article>
                  ))}
                </div>
                <div className="overview-grid">
                  <article className="card">
                    <h3>Server identity</h3>
                    <dl>
                      <dt>Connection</dt>
                      <dd>
                        {host.hostname}:{host.port}
                      </dd>
                      <dt>Host fingerprint</dt>
                      <dd className="mono">{host.fingerprints.join("\n")}</dd>
                      <dt>Administration</dt>
                      <dd>
                        {host.managed
                          ? "Managed Linux host"
                          : "Generic SSH / SFTP"}
                      </dd>
                      <dt>Sampled at</dt>
                      <dd>{overview?.sampledAt || "Unavailable"}</dd>
                      <dt>Current release</dt>
                      <dd className="mono">
                        {overview?.release || "Unavailable"}
                      </dd>
                    </dl>
                  </article>
                  <article className="card">
                    <h3>Related administration</h3>
                    <a
                      target="_top"
                      href={`${location.hostname === "localhost" ? "http://localhost:3000" : "https://omni-lodge.com"}/settings/sql-helper`}
                    >
                      Database Workspace & backups →
                    </a>
                    <a
                      target="_top"
                      href={`${location.hostname === "localhost" ? "http://localhost:3000" : "https://omni-lodge.com"}/settings/maintenance`}
                    >
                      Release maintenance →
                    </a>
                    <p className="muted">
                      Application deployments and rollback use the trusted
                      release workflow.
                    </p>
                  </article>
                </div>
              </>
            )}
          </>
        )}
        <div hidden={section !== "terminal"} className="terminal-workspace">
          <div className="terminal-tabbar">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={activeTab === tab.id ? "selected" : ""}
              >
                <button onClick={() => setActiveTab(tab.id)}>
                  {tab.title}
                </button>
                <button
                  aria-label={`Close ${tab.title}`}
                  onClick={() => {
                    if (!confirm("Terminate this terminal session?")) return;
                    void api(`/terminals/${tab.id}/terminate`, {})
                      .then(() => {
                        setTabs((t) => t.filter((x) => x.id !== tab.id));
                        setActiveTab(
                          tabs.find((x) => x.id !== tab.id)?.id || "",
                        );
                      })
                      .catch(onError);
                  }}
                >
                  <IconX size={16} />
                </button>
              </div>
            ))}
            <button onClick={() => void openTerminal()} disabled={!host}>
              <IconPlus size={18} />
              Terminal
            </button>
            <div className="spacer" />
            <button onClick={() => setSplit(!split)}>
              {split ? "Single pane" : "Split view"}
            </button>
          </div>
          {!tabs.length && (
            <div className="empty-state">
              <IconTerminal2 size={42} />
              <h3>Your server, at your command</h3>
              <p>
                Open a terminal to connect with your assigned operating-system
                identity.
              </p>
              <button
                className="primary"
                disabled={!host}
                onClick={() => void openTerminal()}
              >
                Connect with SSH
              </button>
            </div>
          )}
          <div className={`terminal-panes ${split ? "split" : ""}`}>
            {tabs.map((tab, index) => (
              <div
                className="terminal-tab-content"
                key={tab.id}
                hidden={
                  tab.id !== activeTab &&
                  !(
                    split &&
                    index === tabs.findIndex((t) => t.id === activeTab) + 1
                  )
                }
              >
                <div className="pane-identity">
                  {tab.title} ·{" "}
                  {session.hosts.find((h) => h.id === tab.hostId)?.username}
                </div>
                <TerminalPane tab={tab} onError={onError} />
              </div>
            ))}
          </div>
        </div>
        {section === "files" && (
          <div className="files-workspace">
            <aside className="roots">
              <span className="eyebrow">Approved roots</span>
              {host?.roots.map((r) => (
                <button
                  className={rootId === r.id ? "active" : ""}
                  key={r.id}
                  onClick={() => setRootId(r.id)}
                >
                  <IconFolder size={18} />
                  {r.name}
                  <span>{r.writable ? "" : "Read only"}</span>
                </button>
              ))}
              <div className="root-detail">
                <p className="muted">
                  {root?.managed
                    ? "Managed publication and recoverable trash."
                    : "Permissions and confinement are enforced by the remote account."}
                </p>
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={!root?.writable}
                >
                  <IconUpload size={18} />
                  Choose local files
                </button>
              </div>
            </aside>
            <section className="file-panel">
              <div className="file-toolbar">
                <button
                  aria-label="Parent directory"
                  onClick={() =>
                    void loadFiles(
                      currentPath.split("/").slice(0, -1).join("/") || ".",
                    )
                  }
                >
                  <IconArrowUp size={18} />
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadFiles(pathInput);
                  }}
                >
                  <input
                    aria-label="Remote path"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                  />
                </form>
                <button
                  aria-label="Refresh files"
                  disabled={busy}
                  onClick={() => void loadFiles()}
                >
                  <IconRefresh size={18} />
                </button>
                <button
                  disabled={!root?.writable}
                  onClick={() => void fileAction("mkdir")}
                >
                  <IconPlus size={18} />
                  Folder
                </button>
                <button
                  disabled={!root}
                  onClick={() => {
                    const source = prompt(
                      "Source folder (relative to this root)",
                      selectedEntries.find((e) => e.type === "directory")
                        ?.path || currentPath,
                    );
                    if (!source) return;
                    const target = prompt(
                      "Compare with folder (relative to this root)",
                    );
                    if (!target) return;
                    void api("/files/compare", {
                      hostId,
                      rootId,
                      source,
                      target,
                    })
                      .then(setComparison)
                      .catch(onError);
                  }}
                >
                  Compare folders
                </button>
                {root?.managed && (
                  <button
                    onClick={() =>
                      void api(`/trash?${query({ hostId, rootId })}`)
                        .then((result) => setTrashEntries(result.entries))
                        .catch(onError)
                    }
                  >
                    Trash
                  </button>
                )}
                <button
                  disabled={!root?.writable || !!uploadProgress}
                  onClick={() => fileInput.current?.click()}
                >
                  <IconUpload size={18} />
                  Upload
                </button>
                <button
                  disabled={!root?.writable || !!uploadProgress}
                  onClick={() => folderInput.current?.click()}
                >
                  Upload folder
                </button>
              </div>
              <div className="file-filters">
                <label className="search">
                  <IconSearch size={17} />
                  <input
                    placeholder="Filter this directory"
                    aria-label="Filter files"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(e) => setHidden(e.target.checked)}
                  />
                  Hidden files
                </label>
                <span className="muted">
                  {visible.length.toLocaleString()} entries
                  {complete ? "" : " · incomplete inventory"}
                </span>
              </div>
              {selectedEntries.length > 0 && (
                <div className="selection-bar">
                  <strong>{selectedEntries.length} selected</strong>
                  <button onClick={() => void download(selectedEntries[0])}>
                    <IconDownload size={17} />
                    Download
                  </button>
                  {selectedEntries.length === 1 && (
                    <>
                      <button
                        disabled={!root?.writable}
                        onClick={() =>
                          void fileAction("rename", selectedEntries[0])
                        }
                      >
                        Rename / move
                      </button>
                      <button
                        disabled={!root?.writable}
                        onClick={() =>
                          void fileAction("copy", selectedEntries[0])
                        }
                      >
                        Copy
                      </button>
                      <button
                        disabled={!root?.writable}
                        onClick={() =>
                          void fileAction("chmod", selectedEntries[0])
                        }
                      >
                        Permissions
                      </button>
                    </>
                  )}
                  <button
                    className="danger"
                    disabled={!root?.writable}
                    onClick={() => {
                      void (async () => {
                        for (const entry of selectedEntries)
                          await fileAction(
                            root?.managed ? "trash" : "delete",
                            entry,
                          );
                      })();
                    }}
                  >
                    {root?.managed ? "Move to trash" : "Permanently delete"}
                  </button>
                </div>
              )}
              <div className="file-table-container">
                <table className="file-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select visible files"
                          checked={
                            visible.length > 0 &&
                            visible.every((e) => selected.includes(e.path))
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? visible.map((x) => x.path)
                                : [],
                            )
                          }
                        />
                      </th>
                      {[
                        ["name", "Name"],
                        ["size", "Size"],
                        ["mtime", "Modified"],
                      ].map(([key, label]) => (
                        <th key={key}>
                          <button
                            onClick={() => {
                              setDescending(sort === key ? !descending : false);
                              setSort(key);
                            }}
                          >
                            {label}
                            {sort === key ? (descending ? " ↓" : " ↑") : ""}
                          </button>
                        </th>
                      ))}
                      <th>Permissions</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible
                      .slice(page * 200, (page + 1) * 200)
                      .map((entry) => (
                        <tr
                          key={entry.path}
                          onDoubleClick={() => void openFile(entry)}
                          className={
                            selected.includes(entry.path) ? "selected" : ""
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${entry.name}`}
                              checked={selected.includes(entry.path)}
                              onChange={(e) =>
                                setSelected((s) =>
                                  e.target.checked
                                    ? [...s, entry.path]
                                    : s.filter((p) => p !== entry.path),
                                )
                              }
                            />
                          </td>
                          <td>
                            <button
                              className="file-name"
                              onClick={() => void openFile(entry)}
                            >
                              <IconFolder
                                size={18}
                                opacity={entry.type === "directory" ? 1 : 0.35}
                              />
                              <span>{entry.name}</span>
                              {entry.type === "link" && <small>Link</small>}
                            </button>
                          </td>
                          <td>
                            {entry.type === "directory"
                              ? "—"
                              : bytes(Number(entry.size))}
                          </td>
                          <td>
                            {new Date(entry.mtime * 1000).toLocaleString()}
                          </td>
                          <td className="mono">
                            {(entry.mode & 0o777).toString(8)}
                          </td>
                          <td>
                            {entry.uid}:{entry.gid}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="empty-state">
                    <IconFolder size={32} />
                    <p>
                      {busy
                        ? "Loading directory…"
                        : "No files match this view."}
                    </p>
                  </div>
                )}
              </div>
              <footer className="file-footer">
                <span>
                  {root?.name} / {currentPath}
                </span>
                <div className="spacer" />
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil(visible.length / 200))}
                </span>
                <button
                  disabled={(page + 1) * 200 >= visible.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </footer>
            </section>
          </div>
        )}
        {section === "transfers" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Operation queue</span>
                <h2>Transfers & operations</h2>
                <p className="muted">
                  Confirmed outcomes, verification and work that needs
                  attention.
                </p>
              </div>
              <button onClick={() => void loadJobs()}>
                <IconRefresh size={18} />
                Refresh
              </button>
            </div>
            {jobs.length ? (
              jobs.map((job) => (
                <article className="job-row" key={job.id}>
                  <div className="job-icon">
                    <IconArrowsTransferUp size={22} />
                  </div>
                  <div className="job-main">
                    <strong>
                      {String(job.data.path || job.data.serviceId || job.kind)}
                    </strong>
                    <span className="muted">
                      {job.hostId} · {job.id}
                    </span>
                    {job.data.size !== undefined && (
                      <progress
                        max={Number(job.data.size) || 1}
                        value={Number(job.data.offset) || 0}
                      />
                    )}
                    <small>
                      {job.data.verification || job.data.error || ""}
                    </small>
                  </div>
                  <span className={`state ${job.state}`}>
                    {job.state.replace(/_/g, " ")}
                  </span>
                  {job.state === "outcome_unknown" &&
                    session.hosts.find((h) => h.id === job.hostId)?.managed && (
                      <button
                        onClick={() =>
                          void api("/operations/reconcile", { id: job.id })
                            .then((result) => {
                              setNotice(`Remote outcome: ${result.state}.`);
                              void loadJobs();
                            })
                            .catch(onError)
                        }
                      >
                        Verify outcome
                      </button>
                    )}
                  {job.kind==='terminal'&&job.state==='active'&&<button onClick={()=>{if(!tabs.some(t=>t.id===job.id))setTabs(t=>[...t,{id:job.id,hostId:job.hostId,title:`${job.hostId} ? retained session`,managed:Boolean(job.data.managed),recording:Boolean(job.data.recording)}]);setActiveTab(job.id);setSection('terminal');}}>Reattach terminal</button>}
                  {job.kind === "upload" &&
                    ["paused", "outcome_unknown"].includes(job.state) && (
                      <button
                        onClick={() => {
                          pendingResume.current = job;
                          setNotice(
                            "Choose the original source file again to validate and resume this upload.",
                          );
                          fileInput.current?.click();
                        }}
                      >
                        Resume
                      </button>
                    )}
                  {job.kind === "upload" &&
                    !["completed", "publishing"].includes(job.state) && (
                      <button
                        onClick={() =>
                          void api(`/transfers/${job.id}/cancel`, {})
                            .then(loadJobs)
                            .catch(onError)
                        }
                      >
                        Cancel
                      </button>
                    )}
                </article>
              ))
            ) : (
              <div className="empty-state">
                <IconArrowsTransferUp size={42} />
                <h3>No transfers yet</h3>
                <p>Uploads, downloads and file operations appear here.</p>
              </div>
            )}
          </>
        )}
        {section === "services" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Operations</span>
                <h2>Services & logs</h2>
                <p className="muted">
                  Approved service actions and bounded log output.
                </p>
              </div>
            </div>
            <div className="service-grid">
              {services.map((service) => (
                <article className="card" key={service.id}>
                  <div className="service-title">
                    <h3>{service.name || service.id}</h3>
                    <span className="state">
                      {service.state || "Unavailable"}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setServiceId(service.id);
                      void api(
                        `/logs?${query({ hostId, serviceId: service.id })}`,
                      )
                        .then((result) => setLogs(result.output || ""))
                        .catch(onError);
                    }}
                  >
                    View logs
                  </button>
                  <button
                    disabled={!service.restartable}
                    className="danger"
                    onClick={() => {
                      const reason = prompt(
                        `Reason for restarting ${service.name || service.id}`,
                      );
                      if (
                        !reason ||
                        !confirm(
                          `Restart ${service.id}? Active connections may be interrupted.`,
                        )
                      )
                        return;
                      void api("/services/restart", {
                        hostId,
                        serviceId: service.id,
                        confirm: service.id,
                        reason,
                        idempotencyKey: crypto.randomUUID(),
                      })
                        .then(() =>
                          setNotice(
                            "Restart accepted. Follow its outcome in Transfers & operations.",
                          ),
                        )
                        .catch(onError);
                    }}
                  >
                    Restart
                  </button>
                </article>
              ))}
            </div>
            <article className="card logs-card">
              <div className="file-toolbar">
                <select
                  aria-label="Log service"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  {host?.services.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    void api(`/logs?${query({ hostId, serviceId })}`)
                      .then((result) => setLogs(result.output || ""))
                      .catch(onError)
                  }
                >
                  Load logs
                </button>
                <button onClick={() => setFollowing(!following)}>
                  {following ? "Pause live logs" : "Follow logs"}
                </button>
                <input
                  placeholder="Search retained logs"
                  aria-label="Search logs"
                  value={searchPath}
                  onChange={(e) => setSearchPath(e.target.value)}
                />
              </div>
              <pre className="log-output">
                {logs
                  .split("\n")
                  .filter(
                    (line) =>
                      !searchPath ||
                      line.toLowerCase().includes(searchPath.toLowerCase()),
                  )
                  .join("\n") || "Choose a service to inspect its logs."}
              </pre>
            </article>
          </>
        )}
        {section === "activity" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Administrative history</span>
                <h2>Activity</h2>{session.actions.includes('viewRecordings')&&<button onClick={()=>void api('/recordings').then(result=>setRecordingList(result.recordings)).catch(onError)}>Terminal recordings</button>}
                <p className="muted">
                  Session metadata and structured operation outcomes. Terminal
                  commands are not inferred from keystrokes.
                </p>
              </div>
              <button
                onClick={() =>
                  void api("/activity")
                    .then((result) => setActivity(result.events))
                    .catch(onError)
                }
              >
                Refresh
              </button>
            </div>
            <div className="activity-list">
              {activity.map((event) => (
                <article className="activity-row" key={event.id}>
                  <span className="activity-marker" />
                  <div>
                    <strong>{event.action}</strong>
                    <span>
                      {event.host_id} · {event.outcome}
                    </span>
                    <small>{event.operation_id || ""}</small>
                  </div>
                  <time>{new Date(event.created_at).toLocaleString()}</time>
                </article>
              ))}
            </div>
          </>
        )}
        {section === "settings" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Control Panel</span>
                <h2>Server configuration</h2>
                <p className="muted">
                  Changes are audited and invalidate affected sessions. Verify
                  SSH fingerprints independently before enrollment.
                </p>
              </div>
            </div>
            <div className="settings-grid">
              <article className="card">
                <h3>Server profiles</h3>
                <p>
                  Use the versioned profile structure from the
                  architecture/runbook. Each account needs an explicit remote
                  identity and host action grants.
                </p>
                <textarea
                  className="json-editor"
                  aria-label="Server profile JSON"
                  value={hostDraft}
                  onChange={(e) => setHostDraft(e.target.value)}
                  spellCheck={false}
                />
                <button
                  className="primary"
                  onClick={() => {
                    try {
                      const value = JSON.parse(hostDraft);
                      void api("/config", {
                        key: "SYSTEM_MANAGEMENT_HOSTS",
                        value,
                        revision: session.policyHash,
                        reason: "Server profile update",
                      })
                        .then(() => {
                          setNotice(
                            "Profiles saved. Reopen System Management to load the new policy.",
                          );
                          setSession(null);
                        })
                        .catch(onError);
                    } catch (e) {
                      onError(e);
                    }
                  }}
                >
                  Save server profiles
                </button>
              </article>
              <article className="card">
                <h3>Replace a credential</h3>
                <p className="muted">
                  Credentials are encrypted and write-only. Use a dedicated
                  operational key.
                </p>
                <label>
                  Credential ID
                  <input
                    value={credentialId}
                    onChange={(e) => setCredentialId(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Private key
                  <textarea
                    aria-label="Private key"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    rows={8}
                  />
                </label>
                <label>
                  Passphrase
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <button
                  className="primary"
                  onClick={() =>
                    void api("/credentials", {
                      id: credentialId,
                      value: {
                        privateKey,
                        passphrase,
                        revision: crypto.randomUUID(),
                      },
                      revision: session.policyHash,
                      reason: "Operational SSH credential rotation",
                    })
                      .then(() => {
                        setPrivateKey("");
                        setPassphrase("");
                        setSession(null);
                        setNotice(
                          "Credential replaced. Open a fresh administration session.",
                        );
                      })
                      .catch(onError)
                  }
                >
                  Save encrypted credential
                </button>
                <hr />
                <p>
                  Limits, host action grants, retention and feature switches are
                  in Settings / Control Panel → System Management.
                </p>
                <a
                  target="_top"
                  href={`${location.hostname === "localhost" ? "http://localhost:3000" : "https://omni-lodge.com"}/settings/control-panel`}
                >
                  Open Control Panel →
                </a>
              </article>
            </div>
          </>
        )}
      </main>
      <input
        hidden
        multiple
        type="file"
        ref={fileInput}
        onChange={(e) => void uploadFiles(e.target.files)}
      />
      <input
        hidden
        multiple
        type="file"
        ref={folderInput}
        {...({ webkitdirectory: "", directory: "" } as any)}
        onChange={(e) => void uploadFiles(e.target.files)}
      />
      {uploadProgress && (
        <div className="upload-progress">
          <IconUpload size={20} />
          <div>
            <strong>{uploadProgress.name}</strong>
            <progress
              max={uploadProgress.total || 1}
              value={uploadProgress.done}
            />
            <small>
              {bytes(uploadProgress.done)} / {bytes(uploadProgress.total)}
            </small>
          </div>
          <button
            onClick={() => {
              abortUpload.current = true;
            }}
          >
            Pause / cancel
          </button>
        </div>
      )}
      {recordingList!==null&&<div className="dialog-backdrop"><section className="dialog wide-dialog"><span className="eyebrow">Restricted recordings</span><h2>Terminal output recordings</h2><p>Output can include passwords, tokens and private file contents. Access and retention are controlled separately from normal activity.</p>{!recordingList.length&&<p>No retained recordings.</p>}{recordingList.map(item=><article className="job-row" key={item.id}><div className="job-main"><strong>{item.host_id} ? {item.kind.replace(/-/g,' ')}</strong><small>{new Date(item.created_at).toLocaleString()} ? {bytes(Number(item.bytes))}</small></div><button onClick={()=>void api(`/recording?${query({id:item.id})}`).then(result=>setRecordingPreview({...result,id:item.id})).catch(onError)}>View</button><a className="button" href={`/management/recording/download?${query({id:item.id})}`}>Download</a></article>)}<div className="dialog-actions"><button onClick={()=>setRecordingList(null)}>Close</button></div></section></div>}
      {recordingPreview&&<div className="dialog-backdrop"><section className="dialog wide-dialog"><h2>Recorded terminal output</h2>{recordingPreview.truncated&&<p className="error-text">This recording is incomplete or still active.</p>}{recordingPreview.previewTruncated&&<p>Showing the first 256 KiB. Download the recording for the full retained output.</p>}<pre className="log-output">{recordingPreview.text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'')}</pre><div className="dialog-actions"><button onClick={()=>setRecordingPreview(null)}>Close preview</button></div></section></div>}
      {comparison && (
        <div className="dialog-backdrop">
          <section className="dialog wide-dialog">
            <span className="eyebrow">Reviewed copy plan</span>
            <h2>Folder comparison</h2>
            <p>
              {comparison.comparison} Existing files are preserved. This plan
              copies missing items without deleting anything.
            </p>
            <div className="comparison-results">
              {comparison.plan.map((item: any) => (
                <div key={item.path} className="comparison-row">
                  <span className="mono">
                    {item.path} ? {item.target}
                  </span>
                  <span className="state">
                    {item.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <button onClick={() => setComparison(null)}>Cancel</button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !comparison.plan.some(
                    (item: any) => item.status === "missing",
                  )
                }
                onClick={() => {
                  setBusy(true);
                  void api("/files/copy-plan", { id: comparison.id })
                    .then((result) => {
                      setNotice(
                        `Copied ${result.data.completed} missing items. Existing items were preserved.`,
                      );
                      setComparison(null);
                      void loadFiles();
                    })
                    .catch(onError)
                    .finally(() => setBusy(false));
                }}
              >
                Copy missing items
              </button>
            </div>
          </section>
        </div>
      )}
      {trashEntries !== null && (
        <div className="dialog-backdrop">
          <section className="dialog wide-dialog">
            <span className="eyebrow">Recoverable deletion</span>
            <h2>Trash ? {root?.name}</h2>
            <p>
              Restore into the original location. A new file at that location is
              never overwritten.
            </p>
            {!trashEntries.length && <p>No recoverable items in this root.</p>}
            {trashEntries.map((entry) => (
              <div className="job-row" key={entry.trashId}>
                <div className="job-main">
                  <strong>{entry.original}</strong>
                  <small>
                    Expires {new Date(entry.expires).toLocaleString()}
                  </small>
                </div>
                <button
                  onClick={() => {
                    if (!confirm(`Restore ${entry.original}?`)) return;
                    void api("/file-operations/review", {
                      hostId,
                      rootId,
                      path: entry.original,
                      operation: "restore",
                      trashId: entry.trashId,
                    })
                      .then((review) =>
                        api("/file-operations/execute", { id: review.id }),
                      )
                      .then(() => {
                        setTrashEntries(
                          (items) =>
                            items?.filter((i) => i.trashId !== entry.trashId) ||
                            [],
                        );
                        void loadFiles();
                      })
                      .catch(onError);
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
            <div className="dialog-actions">
              <button onClick={() => setTrashEntries(null)}>Close</button>
            </div>
          </section>
        </div>
      )}
      {document && (
        <TextEditor
          document={document}
          hostId={hostId}
          rootId={rootId}
          onClose={() => setDocument(null)}
          onSaved={() => void loadFiles()}
          onError={onError}
        />
      )}
      {stepUp && (
        <div className="dialog-backdrop">
          <form className="dialog auth-dialog" onSubmit={unlock}>
            <div className="auth-icon">
              <IconShieldLock size={28} />
            </div>
            <span className="eyebrow">Administrator access</span>
            <h2>Confirm it's you</h2>
            <p>
              Re-enter your account password to open terminals and make server
              changes.
            </p>
            <label>
              Password
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setPassword("");
                  setStepUp(false);
                }}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy || !password}>
                Confirm access
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
// Avoid confusion between a remote document and the browser document object.
const documentGlobal = window.document;
createRoot(documentGlobal.getElementById("root")!).render(<App />);
