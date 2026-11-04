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
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
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
  document: initialDocument,
  hostId,
  rootId,
  onClose,
  onSaved,
  onError,
  editable = false,
}: {
  document: Document;
  hostId: string;
  rootId: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
  editable?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [lineEnding, setLineEnding] = useState(initialDocument.newline);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const lineEndingRef = useRef(lineEnding);
  lineEndingRef.current = lineEnding;
  const [document, setDocument] = useState(initialDocument);
  useEffect(() => {
    setDocument(initialDocument);
    setLineEnding(initialDocument.newline);
  }, [initialDocument]);
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
        doc: document.text.replace(/\r\n|\r/g, "\n"),
        extensions: [
          EditorView.editable.of(editable),
          EditorState.readOnly.of(!editable),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          lineNumbers(),
          history(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          extension,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              setDirty(
                update.state.doc.toString() !==
                  document.text.replace(/\r\n|\r/g, "\n") ||
                  lineEndingRef.current !== document.newline,
              );
          }),
        ],
      }),
    });
    view.current = editor;
    const unload = (e: BeforeUnloadEvent) => {
      if (
        editor.state.doc.toString() !==
          document.text.replace(/\r\n|\r/g, "\n") ||
        lineEndingRef.current !== document.newline
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      editor.destroy();
    };
  }, [document, editable]);
  const save = async (saveAs = false) => {
    setBusy(true);
    try {
      const text = (view.current?.state.doc.toString() || "").replace(
          /\r?\n/g,
          lineEnding === "CRLF" ? "\r\n" : lineEnding === "CR" ? "\r" : "\n",
        ),
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
    <dialog
      ref={dialog}
      className="editor-dialog native-dialog"
      aria-label={`Text editor - ${hostId} / ${rootId} / ${document.path}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!dirty || confirm("Discard unsaved changes?")) onClose();
      }}
    >
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
          <select
            aria-label="File line endings"
            value={lineEnding}
            disabled={!editable || busy}
            onChange={(event) => {
              setLineEnding(event.target.value);
              setDirty(true);
            }}
          >
            {document.newline === "mixed" && (
              <option value="mixed" disabled>
                Mixed - choose before saving
              </option>
            )}
            <option value="LF">LF</option>
            <option value="CRLF">CRLF</option>
            <option value="CR">CR</option>
          </select>
          <button
            disabled={busy || !editable || lineEnding === "mixed"}
            onClick={() => void save(true)}
          >
            Save as
          </button>
          <button
            disabled={busy || !dirty || !editable || lineEnding === "mixed"}
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
      {document.newline === "mixed" && (
        <p className="notice">
          This file uses mixed line endings. Choose a format explicitly before
          saving; all line endings will use that format.
        </p>
      )}
      {!editable && (
        <p className="notice">
          Read-only preview for this file root and account.
        </p>
      )}
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
              if (confirm("Discard this draft and reload?")) {
                setDocument(conflict);
                setLineEnding(conflict.newline);
                setConflict(null);
                setDirty(false);
                onSaved();
              }
            }}
          >
            Reload remote file
          </button>
        </section>
      )}
    </dialog>
  );
}
