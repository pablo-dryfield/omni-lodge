import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
} from '@codemirror/view';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { completionSchema, columnCompletionSource } from './sqlCompletions';
import type { CompletionColumn } from './api';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxTree,
  indentOnInput,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';

export type EditorHandle = {
  scope: () => { sql: string; label: string; offset: number };
  all: () => string;
  focus: () => void;
  jump: (position: number) => void;
};
type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema: CompletionColumn[];
  defaultSchema?: string;
  readOnly?: boolean;
  wrapping?: boolean;
  fontSize?: number;
};
export const SqlEditor = forwardRef<EditorHandle, Props>(
  (
    {
      value,
      onChange,
      onRun,
      schema,
      defaultSchema = 'public',
      readOnly,
      wrapping = true,
      fontSize = 14,
    },
    ref,
  ) => {
    const container = useRef<HTMLDivElement>(null),
      view = useRef<EditorView>();
    const callbacks = useRef({ onChange, onRun });
    callbacks.current = { onChange, onRun };
    const language = useRef(new Compartment()),
      editing = useRef(new Compartment()),
      appearance = useRef(new Compartment());
    useImperativeHandle(
      ref,
      () => ({
        all: () => view.current?.state.doc.toString() || '',
        focus: () => view.current?.focus(),
        jump: (position) => {
          const v = view.current;
          if (!v) return;
          const at = Math.max(0, Math.min(position, v.state.doc.length));
          v.dispatch({
            selection: { anchor: at },
            effects: EditorView.scrollIntoView(at, { y: 'center' }),
          });
          v.focus();
        },
        scope: () => {
          const state = view.current?.state;
          if (!state) return { sql: value, label: 'Run current', offset: 0 };
          const selection = state.selection.main;
          if (!selection.empty)
            return {
              sql: state.sliceDoc(selection.from, selection.to),
              label: 'Run selection',
              offset: selection.from,
            };
          let selected: { from: number; to: number } | undefined;
          syntaxTree(state)
            .topNode.cursor()
            .iterate((node) => {
              if (
                node.name === 'Statement' &&
                node.from <= selection.head &&
                node.to >= selection.head
              )
                selected = { from: node.from, to: node.to };
            });
          if (!selected) {
            const nodes = syntaxTree(state).topNode;
            for (let n = nodes.firstChild; n; n = n.nextSibling)
              if (n.name === 'Statement' && n.from >= selection.head) {
                selected = { from: n.from, to: n.to };
                break;
              }
          }
          return selected
            ? {
                sql: state.sliceDoc(selected.from, selected.to),
                label: 'Run current',
                offset: selected.from,
              }
            : { sql: state.doc.toString(), label: 'Run script', offset: 0 };
        },
      }),
      [value],
    );
    useEffect(() => {
      if (!container.current) return;
      const editor = new EditorView({
        parent: container.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            appearance.current.of([
              wrapping ? EditorView.lineWrapping : [],
              EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
            ]),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            drawSelection(),
            rectangularSelection(),
            history(),
            foldGutter(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            highlightSelectionMatches(),
            autocompletion(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            language.current.of([
              sql({
                dialect: PostgreSQL,
                schema: completionSchema(schema),
                defaultSchema,
                upperCaseKeywords: true,
              }),
              PostgreSQL.language.data.of({
                autocomplete: columnCompletionSource(schema, defaultSchema),
              }),
            ]),
            editing.current.of(EditorState.readOnly.of(Boolean(readOnly))),
            EditorView.contentAttributes.of({
              'aria-label': 'SQL editor',
              spellcheck: 'false',
              'aria-describedby': 'dw-editor-help',
            }),
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  callbacks.current.onRun();
                  return true;
                },
              },
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              ...foldKeymap,
              ...completionKeymap,
              ...closeBracketsKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged)
                callbacks.current.onChange(update.state.doc.toString());
            }),
            EditorView.theme({
              '&': { height: '100%', fontSize: '14px' },
              '.cm-scroller': {
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                lineHeight: '1.7',
                overflow: 'auto',
              },
              '.cm-content': { padding: '14px 0', minHeight: '220px' },
              '.cm-gutters': {
                backgroundColor: 'var(--dw-soft)',
                borderRight: '1px solid var(--dw-border)',
              },
              '&.cm-focused': { outline: 'none' },
              '.cm-activeLine': { backgroundColor: 'var(--dw-active-line)' },
              '.cm-activeLineGutter': {
                backgroundColor: 'var(--dw-active-line)',
              },
              '.cm-tooltip': { zIndex: '50' },
            }),
          ],
        }),
      });
      view.current = editor;
      return () => {
        view.current = undefined;
        editor.destroy();
      };
      // The editor is mounted once; external values and compartments update below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
      const v = view.current;
      if (v && v.state.doc.toString() !== value)
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: value },
        });
    }, [value]);
    useEffect(() => {
      view.current?.dispatch({
        effects: language.current.reconfigure([
          sql({
            dialect: PostgreSQL,
            schema: completionSchema(schema),
            defaultSchema,
            upperCaseKeywords: true,
          }),
          PostgreSQL.language.data.of({
            autocomplete: columnCompletionSource(schema, defaultSchema),
          }),
        ]),
      });
    }, [schema, defaultSchema]);
    useEffect(() => {
      view.current?.dispatch({
        effects: editing.current.reconfigure(
          EditorState.readOnly.of(Boolean(readOnly)),
        ),
      });
    }, [readOnly]);
    useEffect(() => {
      view.current?.dispatch({
        effects: appearance.current.reconfigure([
          wrapping ? EditorView.lineWrapping : [],
          EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
        ]),
      });
    }, [wrapping, fontSize]);
    return <div className="dw-editor" ref={container} />;
  },
);
SqlEditor.displayName = 'SqlEditor';
