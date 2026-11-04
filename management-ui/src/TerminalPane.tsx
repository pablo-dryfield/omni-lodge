import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { api } from "./api";
export type TerminalTab = {
  id: string;
  hostId: string;
  title: string;
  managed: boolean;
  recording?:boolean;
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
  const [recordingNotice,setRecordingNotice]=useState('');
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
    if (socket.current?.readyState === 1)
      socket.current.send(
        JSON.stringify({
          type: "input",
          data,
          sequence: ++inputSequence.current,
        }),
      );
  };
  useEffect(() => {
    if (!container.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: font,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      scrollback: 10000,
      allowProposedApi: false,
      theme: {
        background: "#0c1220",
        foreground: "#dde7f4",
        cursor: "#78ddba",
      },
      screenReaderMode: false,
    });
    const fit = new FitAddon(),
      finder = new SearchAddon();
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
      fresh = true;
    const attach = async (takeover = false) => {
      try {
        setState("Connecting");
        const { ticket } = await api<{ ticket: string }>(
          `/terminals/${tab.id}/attach-ticket`,
          { takeover },
        );
        if (cancelled) return;
        const ws = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/management/stream`,
        );
        socket.current = ws;
        ws.onopen = () =>
          ws.send(JSON.stringify({ ticket, after: last.current, fresh }));
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.type === "attached") {
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
          if(m.type==='recordingNotice')setRecordingNotice(m.message);
          if (m.type === "exit")
            setState(`Ended${m.code === null ? "" : ` (${m.code})`}`);
          if (m.type === "locked") setState("Authentication required");
          if (m.type === "error") {
            setState(
              m.code === "STEP_UP_REQUIRED"
                ? "Authentication required"
                : "Connection needs attention",
            );
            onError(new Error(m.message));
          }
        };
        ws.onclose = (e) => {
          if (cancelled) return;
          setState(
            e.code === 4001 ? "Taken over in another tab" : "Disconnected",
          );
          if (e.code !== 4001 && e.code !== 1000 && e.code !== 4003)
            timer = setTimeout(() => void attach(), 2500);
        };
        ws.onerror = () => setState("Connection interrupted");
      } catch (error) {
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
    <section className="terminal-section">
      <div className="terminal-toolbar">
        <span
          className={`status-dot ${state === "Connected" ? "online" : ""}`}
        />
        <strong>{state}</strong>
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
        <button onClick={() => reconnect.current()}>
          Take over / reconnect
        </button>
      </div>
      {tab.recording&&<div className="notice">Recording enabled ? terminal output may contain sensitive information. {recordingNotice}</div>}
      {incomplete && (
        <div className="notice">
          Session reattached. Earlier screen state is unavailable. Use the
          running application's redraw key if needed.
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
        <div className="dialog-backdrop">
          <section className="dialog">
            <h2>Paste into terminal</h2>
            <p>
              Multiple lines can run commands immediately. Review the text
              before sending.
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
          </section>
        </div>
      )}
    </section>
  );
}
