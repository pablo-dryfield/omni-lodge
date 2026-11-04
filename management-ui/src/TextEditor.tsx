import React, { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { api } from "./api";
export type Document = {
  text: string;
  path: string;
  version: string;
  sha256: string;
  bom: boolean;
  newline: string;
  size: string;
};
export function TextEditor({
  document:initialDocument,
  hostId,
  rootId,
  onClose,
  onSaved,
  onError,
}: {
  document: Document;
  hostId: string;
  rootId: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [document,setDocument]=useState(initialDocument);
  useEffect(()=>setDocument(initialDocument),[initialDocument]);
  const container = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>(),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState<Document | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const extension = document.path.endsWith(".json")
      ? json()
      : /\.(tsx?|jsx?)$/.test(document.path)
        ? javascript({ typescript: true, jsx: true })
        : document.path.endsWith(".sql")
          ? sql()
          : document.path.endsWith(".md")
            ? markdown()
            : [];
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: document.text.replace(/\r\n/g,"\n"),
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          extension,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              setDirty(update.state.doc.toString() !== document.text.replace(/\r\n/g,"\n"));
          }),
        ],
      }),
    });
    view.current = editor;
    const unload = (e: BeforeUnloadEvent) => {
      if (editor.state.doc.toString() !== document.text.replace(/\r\n/g,"\n")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      editor.destroy();
    };
  }, [document]);
  const save = async (saveAs = false) => {
    setBusy(true);
    try {
      const text = (view.current?.state.doc.toString() || "").replace(/\r?\n/g,document.newline === "CRLF" ? "\r\n" : "\n"),
        target = saveAs
          ? prompt("Save as relative path", document.path)
          : document.path;
      if (!target) return;
      const review = await api("/file-operations/review", {
        hostId,
        rootId,
        path: target,
        operation: "save",
        text,
        createOnly: saveAs,
        version: saveAs ? undefined : document.version,
        sha256: saveAs ? undefined : document.sha256,
        bom: document.bom,
      });
      if (
        !confirm(
          `Save ${target}? ${review.managed ? "" : "Other processes can still change this file before replacement."}`,
        )
      )
        return;
      await api("/file-operations/execute", { id: review.id });
      setDirty(false);
      onSaved();
      onClose();
    } catch (error) {
      if ((error as { code?: string }).code === "VERSION_CONFLICT") {
        try {
          setConflict(
            await api(
              `/files/content?${new URLSearchParams({ hostId, rootId, path: document.path })}`,
            ),
          );
        } catch (e) {
          onError(e);
        }
      }
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop">
      <section className="editor-dialog">
        <header>
          <div>
            <span className="eyebrow">Remote text editor</span>
            <h2>
              {document.path}
              {dirty ? " •" : ""}
            </h2>
            <span className="muted">
              UTF-8{document.bom ? " BOM" : ""} · {document.newline} ·{" "}
              {Number(document.size).toLocaleString()} bytes
            </span>
          </div>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => void save(true)}>
              Save as
            </button>
            <button
              disabled={busy || !dirty}
              className="primary"
              onClick={() => void save()}
            >
              Save
            </button>
            <button
              onClick={() => {
                if (!dirty || confirm("Discard unsaved changes?")) onClose();
              }}
            >
              Close
            </button>
          </div>
        </header>
        <div className="code-editor" ref={container} />
        {conflict && (
          <section className="conflict">
            <h3>Remote file changed</h3>
            <p>
              Your draft is retained. Compare the current remote version, then
              save your draft under another name or reload.
            </p>
            <pre>{conflict.text}</pre>
            <button onClick={() => void save(true)}>Save draft as</button>
            <button
              onClick={() => {
                if (confirm("Discard this draft and reload?")) {setDocument(conflict);setConflict(null);setDirty(false);onSaved();}
              }}
            >
              Reload remote file
            </button>
          </section>
        )}
      </section>
    </div>
  );
}
