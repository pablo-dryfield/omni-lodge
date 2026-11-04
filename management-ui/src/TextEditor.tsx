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
import { Dialog } from "./Dialog";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { shell as shellLanguage } from "@codemirror/legacy-modes/mode/shell";
import { properties } from "@codemirror/legacy-modes/mode/properties";

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
          : /\.ya?ml$/.test(document.path)
            ? yaml()
            : /\.(sh|bash|zsh)$/.test(document.path)
              ? StreamLanguage.define(shellLanguage)
              : /\.(ini|properties|env|conf)$/.test(document.path)
                ? StreamLanguage.define(properties)
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
  const [editorError, setEditorError] = useState("");
  const [saveModal, setSaveModal] = useState<{
    as: boolean;
    target: string;
    overwriteCurrent: boolean;
    review?: any;
  } | null>(null);
  const save = (saveAs = false, overwriteCurrent = false) =>
    setSaveModal({
      as: saveAs,
      target: saveAs ? document.path + ".copy" : document.path,
      overwriteCurrent,
    });
  const prepareSave = async () => {
    if (!saveModal) return;
    const saveAs = saveModal.as;

    setBusy(true);
    setEditorError("");
    try {
      const text = (view.current?.state.doc.toString() || "").replace(
          /\r?\n/g,
          lineEnding === "CRLF" ? "\r\n" : lineEnding === "CR" ? "\r" : "\n",
        ),
        target = saveModal.target;
      if (!target) return;
      const review = await api("/file-operations/review", {
        hostId,
        rootId,
        path: target,
        operation: "save",
        text,
        createOnly: saveAs,
        version: saveAs
          ? undefined
          : saveModal.overwriteCurrent
            ? conflict?.version
            : document.version,
        sha256: saveAs
          ? undefined
          : saveModal.overwriteCurrent
            ? conflict?.sha256
            : document.sha256,
        bom: document.bom,
      });
      setSaveModal((previous) =>
        previous ? { ...previous, review } : previous,
      );
    } catch (error) {
      setEditorError((error as Error).message);
      if ((error as { code?: string }).code === "VERSION_CONFLICT") {
        try {
          setSaveModal(null);
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
  const submitSave = async () => {
    if (!saveModal?.review) return;
    setBusy(true);
    try {
      await api("/file-operations/execute", { id: saveModal.review.id });
      setDirty(false);
      onSaved();
      onClose();
    } catch (e) {
      setEditorError((e as Error).message);
      onError(e);
      setSaveModal((m) => (m ? { ...m, review: undefined } : null));
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
      {editorError && (
        <p className="alert" role="alert">
          {editorError}
        </p>
      )}
      {saveModal && (
        <Dialog
          title={saveModal.as ? "Save file as" : "Review file replacement"}
          onClose={() => {
            if (!busy) setSaveModal(null);
          }}
        >
          <p className="mono">
            {hostId} / {rootId}
          </p>
          <label>
            Destination path
            <input
              value={saveModal.target}
              disabled={busy || !saveModal.as}
              onChange={(event) =>
                setSaveModal((m) =>
                  m
                    ? { ...m, target: event.target.value, review: undefined }
                    : null,
                )
              }
            />
          </label>
          <p>
            {saveModal.as
              ? "A new file is created only if the name is still available."
              : "The reviewed identity and checksum must still match before replacement."}
          </p>
          {saveModal.overwriteCurrent && (
            <p className="notice">
              You are explicitly replacing the newly observed remote version
              with this draft.
            </p>
          )}
          {saveModal.review && (
            <p className="notice">
              Review expires after one minute.{" "}
              {saveModal.review.managed
                ? ""
                : "An external writer can still change a generic SFTP file between checking and replacement."}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setSaveModal(null)}>
              Cancel
            </button>
            {saveModal.review ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void submitSave()}
              >
                Confirm save
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !saveModal.target.trim()}
                onClick={() => void prepareSave()}
              >
                Review save
              </button>
            )}
          </div>
        </Dialog>
      )}
      {conflict && (
        <section className="conflict">
          <h3>Remote file changed</h3>
          <p>
            Your draft is retained. Compare the current remote version, then
            save your draft under another name or reload.
          </p>
          <details>
            <summary>Original version</summary>
            <pre>{document.text}</pre>
          </details>
          <details open>
            <summary>Current remote version</summary>
            <pre>{conflict.text}</pre>
          </details>
          <p>The editor above retains your proposed draft.</p>
          <button disabled={busy} onClick={() => save(false, true)}>
            Review replacing current version
          </button>
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
