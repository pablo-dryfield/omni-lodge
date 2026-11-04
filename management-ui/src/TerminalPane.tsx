import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { Dialog } from "./Dialog";
import { api, ApiError } from "./api";
import { Unicode11Addon } from "@xterm/addon-unicode11";
export type TerminalTab = {
  id: string;
  hostId: string;
  title: string;
  managed: boolean;
  recording?: boolean;
  scrollback?: number;
};
export function TerminalPane({
  tab,
  onError,
}: {
  tab: TerminalTab;
  onError: (error: unknown) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal>(),
    socket = useRef<WebSocket>(),
    search = useRef<SearchAddon>();
  const [recordingNotice, setRecordingNotice] = useState(""),
    [inputNotice, setInputNotice] = useState(""),
    [focusMode, setFocusMode] = useState(false),
    [light, setLight] = useState(false),
    [accessible, setAccessible] = useState(false);
  const connected = useRef(false),
    uncertainInput = useRef(false),
    unacknowledged = useRef(new Set<number>());
  const [state, setState] = useState("Connecting"),
    [incomplete, setIncomplete] = useState(false),
    [modifier, setModifier] = useState<"ctrl" | "alt" | null>(null);
  const modifierRef = useRef<"ctrl" | "alt" | null>(null);
  useEffect(() => {
    modifierRef.current = modifier;
  }, [modifier]);
  const [find, setFind] = useState(""),
    [font, setFont] = useState(14),
    [paste, setPaste] = useState<string | null>(null);
  const last = useRef(0),
    inputSequence = useRef(0),
    reconnect = useRef<() => void>(() => {});
  const send = (data: string) => {
    if (!connected.current || socket.current?.readyState !== 1) {
      setInputNotice(
        "Input was not sent while the terminal is disconnected or locked.",
      );
      return;
    }
    if (unacknowledged.current.size >= 128) {
      setInputNotice(
        "Waiting for input acknowledgements. Inspect the connection before typing again.",
      );
      return;
    }
    const sequence = inputSequence.current + 1;
    const frame = JSON.stringify({ type: "input", data, sequence });
    if (new TextEncoder().encode(frame).length > 65536) {
      setInputNotice(
        "Input exceeds one safe terminal frame. Split the paste into smaller parts.",
      );
      return;
    }
    inputSequence.current = sequence;
    unacknowledged.current.add(sequence);
    socket.current.send(frame);
  };
  useEffect(() => {
    if (!container.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: font,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      scrollback: Math.min(50000, tab.scrollback || 10000),
      // Unicode11 uses xterm's proposed unicode API. This option exposes the
      // local renderer API; it does not permit remote scripts or clipboard OSC.
      allowProposedApi: true,
      theme: {
        background: "#0c1220",
        foreground: "#dde7f4",
        cursor: "#78ddba",
      },
      screenReaderMode: false,
    });
    const fit = new FitAddon(),
      finder = new SearchAddon();
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(fit);
    term.loadAddon(finder);
    search.current = finder;
    // Remote applications cannot silently change the clipboard or navigate the browser.
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(8, () => true);
    term.open(container.current);
    terminal.current = term;
    fit.fit();
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      fresh = true,
      connectionAttempt = 0;
    const attach = async (takeover = false) => {
      const attempt = ++connectionAttempt;
      try {
        connected.current = false;
        setState("Connecting");
        const { ticket } = await api<{ ticket: string }>(
          `/terminals/${tab.id}/attach-ticket`,
          { takeover },
        );
        if (cancelled || attempt !== connectionAttempt) return;
        const ws = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/management/stream`,
        );
        const previous = socket.current;
        if (unacknowledged.current.size) {
          uncertainInput.current = true;
          setInputNotice(
            "Some input was not acknowledged. It will not be replayed; inspect the terminal before typing again.",
          );
          unacknowledged.current.clear();
        }
        socket.current = ws;
        previous?.close(1000, "Replaced by an explicit attachment");
        ws.onopen = () =>
          ws.send(JSON.stringify({ ticket, after: last.current, fresh }));
        ws.onmessage = (e) => {
          if (socket.current !== ws) return;
          const m = JSON.parse(e.data);
          if (m.type === "attached") {
            connected.current = true;
            if (!uncertainInput.current) setInputNotice("");
            setState("Connected");
            setIncomplete(!m.screenRestored);
            fresh = false;
            fit.fit();
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: term.cols,
                rows: term.rows,
              }),
            );
          }
          if (m.type === "inputAck") {
            for (const sequence of unacknowledged.current)
              if (sequence <= m.sequence)
                unacknowledged.current.delete(sequence);
          }
          if (m.type === "unlocked") {
            connected.current = true;
            setState("Connected");
          }
          if (m.type === "output") {
            const bytes = Uint8Array.from(atob(m.data), (x: string) =>
              x.charCodeAt(0),
            );
            term.write(bytes, () => {
              last.current = m.sequence;
              if (ws.readyState === 1)
                ws.send(
                  JSON.stringify({ type: "renderAck", sequence: m.sequence }),
                );
            });
          }
          if (m.type === "gap") {
            setIncomplete(true);
            term.write("\r\n[Earlier output is no longer retained]\r\n");
          }
          if (m.type === "recordingNotice") setRecordingNotice(m.message);
          if (m.type === "exit")
            setState(`Ended${m.code === null ? "" : ` (${m.code})`}`);
          if (m.type === "locked") {
            connected.current = false;
            setState("Authentication required");
            onError(new ApiError("STEP_UP_REQUIRED", m.message));
          }
          if (m.type === "error") {
            setState(
              m.code === "STEP_UP_REQUIRED"
                ? "Authentication required"
                : "Connection needs attention",
            );
            connected.current = false;
            onError(new ApiError(m.code, m.message));
          }
        };
        ws.onclose = (e) => {
          if (socket.current !== ws) return;
          connected.current = false;
          if (unacknowledged.current.size) {
            uncertainInput.current = true;
            setInputNotice(
              "Some input was not acknowledged. It will not be replayed; inspect the terminal before typing again.",
            );
            unacknowledged.current.clear();
          }
          if (cancelled) return;
          setState(
            e.code === 4001 ? "Taken over in another tab" : "Disconnected",
          );
          if (e.code !== 4001 && e.code !== 1000 && e.code !== 4003)
            timer = setTimeout(() => void attach(), 2500);
        };
        ws.onerror = () => {
          if (socket.current === ws) setState("Connection interrupted");
        };
      } catch (error) {
        if (cancelled || attempt !== connectionAttempt) return;
        setState("Connection needs attention");
        onError(error);
      }
    };
    reconnect.current = () => void attach(true);
    void attach();
    const data = term.onData((value) => {
      const armed = modifierRef.current;
      if (armed) {
        if (armed === "ctrl" && value.length === 1)
          value = String.fromCharCode(value.toUpperCase().charCodeAt(0) & 31);
        else if (armed === "alt") value = "\x1b" + value;
        modifierRef.current = null;
        setModifier(null);
      }
      send(value);
    });
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.ctrlKey &&
        event.key.toLowerCase() === "c" &&
        term.hasSelection()
      ) {
        void navigator.clipboard.writeText(term.getSelection()).catch(onError);
        return false;
      }
      return true;
    });
    const pasteEvent = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") || "";
      if (text.includes("\n") || text.length > 512) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPaste(text);
      }
    };
    container.current.addEventListener("paste", pasteEvent, true);
    const resized = term.onResize(({ cols, rows }) => {
      if (socket.current?.readyState === 1)
        socket.current.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* Hidden tab has no measurable area. */
      }
    });
    observer.observe(container.current);
    const viewport = () => {
      fit.fit();
    };
    window.visualViewport?.addEventListener("resize", viewport);
    const heartbeat = setInterval(() => {
      if (socket.current?.readyState === 1)
        socket.current.send(JSON.stringify({ type: "heartbeat" }));
    }, 20000);
    return () => {
      cancelled = true;
      connected.current = false;
      unacknowledged.current.clear();
      clearTimeout(timer);
      clearInterval(heartbeat);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", viewport);
      container.current?.removeEventListener("paste", pasteEvent, true);
      data.dispose();
      resized.dispose();
      socket.current?.close();
      term.dispose();
    };
  }, [tab.id]);
  useEffect(() => {
    if (terminal.current) terminal.current.options.fontSize = font;
  }, [font]);
  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.theme = light
        ? { background: "#fafcff", foreground: "#152b45", cursor: "#2364c5" }
        : { background: "#0c1220", foreground: "#dde7f4", cursor: "#78ddba" };
      terminal.current.options.screenReaderMode = accessible;
    }
  }, [light, accessible]);
  const key = (value: string) => {
    if (modifier === "ctrl" && value.length === 1)
      value = String.fromCharCode(value.toUpperCase().charCodeAt(0) & 31);
    else if (modifier === "alt") value = "\x1b" + value;
    setModifier(null);
    send(value);
    terminal.current?.focus();
  };
  const pasteClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (value.includes("\n") || value.length > 512) setPaste(value);
      else terminal.current?.paste(value);
    } catch (error) {
      onError(error);
    }
  };
  return (
    <section className={`terminal-section${focusMode ? " focus-mode" : ""}`}>
      <div className="terminal-toolbar">
        <button
          aria-pressed={focusMode}
          onClick={() => setFocusMode(!focusMode)}
        >
          {focusMode ? "Exit focus" : "Focus terminal"}
        </button>
        <span
          className={`status-dot ${state === "Connected" ? "online" : ""}`}
        />
        <strong>{focusMode ? `${tab.title} - ${state}` : state}</strong>
        <span className="muted">
          {tab.managed
            ? "Managed session"
            : "SSH session · detached programs may remain"}
        </span>
        <div className="spacer" />
        <input
          aria-label="Search terminal"
          placeholder="Find in terminal"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search.current?.findNext(find);
          }}
        />
        <button onClick={() => search.current?.findNext(find)}>Find</button>
        <button
          aria-label="Decrease terminal font"
          onClick={() => setFont(Math.max(10, font - 1))}
        >
          A−
        </button>
        <button
          aria-label="Increase terminal font"
          onClick={() => setFont(Math.min(24, font + 1))}
        >
          A+
        </button>
        <button aria-pressed={light} onClick={() => setLight(!light)}>
          {light ? "Dark terminal" : "Light terminal"}
        </button>
        <button
          aria-pressed={accessible}
          onClick={() => setAccessible(!accessible)}
        >
          Screen reader
        </button>
        <button onClick={() => reconnect.current()}>
          Take over / reconnect
        </button>
      </div>
      {inputNotice && (
        <div role="status" className="notice">
          {inputNotice}
          <button
            onClick={() => {
              uncertainInput.current = false;
              setInputNotice("");
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {tab.recording && (
        <div className="notice">
          Recording enabled - terminal output may contain sensitive information.{" "}
          {recordingNotice}
        </div>
      )}
      {incomplete && (
        <div className="notice">
          Session reattached. Earlier screen state is unavailable. Use the
          running application's redraw key if needed.
          <button onClick={() => setIncomplete(false)}>Dismiss</button>
        </div>
      )}
      <div className="terminal-canvas" ref={container} />
      <div className="terminal-keys">
        <button onClick={() => key("\x1b")}>Esc</button>
        <button onClick={() => key("\t")}>Tab</button>
        <button
          aria-pressed={modifier === "ctrl"}
          onClick={() => setModifier(modifier === "ctrl" ? null : "ctrl")}
        >
          Ctrl
        </button>
        <button
          aria-pressed={modifier === "alt"}
          onClick={() => setModifier(modifier === "alt" ? null : "alt")}
        >
          Alt
        </button>
        {Object.entries({
          "←": "\x1b[D",
          "↑": "\x1b[A",
          "↓": "\x1b[B",
          "→": "\x1b[C",
          Home: "\x1b[H",
          End: "\x1b[F",
          PgUp: "\x1b[5~",
          PgDn: "\x1b[6~",
        }).map(([label, value]) => (
          <button key={label} onClick={() => key(value)}>
            {label}
          </button>
        ))}
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(terminal.current?.getSelection() || "")
              .catch(onError)
          }
        >
          Copy
        </button>
        <button onClick={() => void pasteClipboard()}>Paste</button>
        <button onClick={() => key("\x03")}>Interrupt</button>
      </div>
      {modifier && (
        <div className="notice">
          {modifier.toUpperCase()} armed ·{" "}
          <button
            onClick={() => {
              const value = prompt("Key to send with modifier");
              if (value) key(value[0]);
            }}
          >
            Send key
          </button>
          <button onClick={() => setModifier(null)}>Cancel modifier</button>
        </div>
      )}
      {paste !== null && (
        <Dialog title="Paste into terminal" onClose={() => setPaste(null)}>
          <p>
            Multiple lines can run commands immediately. Review the text before
            sending.
          </p>
          <pre>{paste.slice(0, 65536)}</pre>
          <div className="dialog-actions">
            <button onClick={() => setPaste(null)}>Cancel</button>
            <button
              className="primary"
              disabled={new TextEncoder().encode(paste).length > 60000}
              onClick={() => {
                terminal.current?.paste(paste);
                setPaste(null);
              }}
            >
              {new TextEncoder().encode(paste).length > 60000
                ? "Paste exceeds 60 KB"
                : "Send text"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
