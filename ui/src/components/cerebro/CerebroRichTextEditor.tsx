import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import {
  ActionIcon,
  Box,
  Divider,
  Group,
  NativeSelect,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBlockquote,
  IconBold,
  IconCode,
  IconH1,
  IconH2,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconPhotoPlus,
  IconStrikethrough,
  IconTrash,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconTable,
  IconRowInsertBottom,
  IconRowRemove,
  IconColumnInsertRight,
  IconColumnRemove,
  IconTableMinus,
} from '@tabler/icons-react';
import { normalizeCerebroRichText } from '../../utils/cerebroRichText';
import { CerebroTableCell, CerebroTableHeader, FontSize } from './cerebroRichTextExtensions';
import './CerebroRichText.css';

type ToolbarAction = {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon: typeof IconBold;
};

type CerebroRichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

const FONT_SIZE_OPTIONS = [
  { value: '', label: 'Font size' },
  { value: '12px', label: '12 px' },
  { value: '14px', label: '14 px' },
  { value: '16px', label: '16 px' },
  { value: '18px', label: '18 px' },
  { value: '20px', label: '20 px' },
  { value: '24px', label: '24 px' },
  { value: '28px', label: '28 px' },
  { value: '32px', label: '32 px' },
];

const FONT_COLOR_OPTIONS = [
  { value: '', label: 'Font color' },
  { value: '#111827', label: 'Black' },
  { value: '#6b7280', label: 'Gray' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#16a34a', label: 'Green' },
  { value: '#dc2626', label: 'Red' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#7c3aed', label: 'Purple' },
];

export const CerebroRichTextEditor = ({
  value,
  onChange,
}: CerebroRichTextEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        autolink: true,
        openOnClick: false,
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      CerebroTableHeader,
      CerebroTableCell,
    ],
    content: normalizeCerebroRichText(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'cerebro-rich-text',
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      onChange(nextEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    const normalizedValue = normalizeCerebroRichText(value);
    const currentValue = editor.getHTML();
    if (normalizedValue !== currentValue) {
      editor.commands.setContent(normalizedValue, { emitUpdate: false });
    }
  }, [editor, value]);

  const promptForLink = () => {
    if (!editor) {
      return;
    }
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const nextUrl = window.prompt('Enter link URL', previousUrl ?? 'https://');
    if (nextUrl == null) {
      return;
    }
    if (!nextUrl.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: nextUrl.trim() }).run();
  };

  const promptForImage = () => {
    if (!editor) {
      return;
    }
    const nextUrl = window.prompt('Enter image or GIF URL', 'https://');
    if (!nextUrl?.trim()) {
      return;
    }
    editor.chain().focus().setImage({ src: nextUrl.trim() }).run();
  };

  const insertTable = () => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  };

  const deleteCurrentTable = () => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.deleteTable();
  };

  const addRowAfter = () => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.addRowAfter();
  };

  const deleteCurrentRow = () => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.deleteRow();
  };

  const addColumnAfter = () => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.addColumnAfter();
  };

  const deleteCurrentColumn = () => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.deleteColumn();
  };

  const setHorizontalAlign = (alignment: 'left' | 'center' | 'right') => {
    if (!editor) {
      return;
    }
    if (editor.isActive('table')) {
      editor.commands.focus();
      editor.commands.updateAttributes('tableCell', { textAlign: alignment });
      editor.commands.updateAttributes('tableHeader', { textAlign: alignment });
      return;
    }
    editor.chain().focus().setTextAlign(alignment).run();
  };

  const setVerticalAlign = (alignment: 'top' | 'middle' | 'bottom') => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.updateAttributes('tableCell', { verticalAlign: alignment });
    editor.commands.updateAttributes('tableHeader', { verticalAlign: alignment });
  };

  const setFontSize = (fontSize: string) => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.setMark('textStyle', { fontSize: fontSize || null });
  };

  const setFontColor = (color: string) => {
    if (!editor) {
      return;
    }
    editor.commands.focus();
    editor.commands.setMark('textStyle', { color: color || null });
  };

  const currentTextStyle = editor?.getAttributes('textStyle') as { fontSize?: string; color?: string } | undefined;
  const currentCellAttributes = editor?.getAttributes('tableCell') as { textAlign?: string; verticalAlign?: string } | undefined;
  const currentHeaderAttributes = editor?.getAttributes('tableHeader') as { textAlign?: string; verticalAlign?: string } | undefined;
  const currentHorizontalAlign = editor?.isActive('table')
    ? currentCellAttributes?.textAlign ?? currentHeaderAttributes?.textAlign
    : (['left', 'center', 'right'].find((alignment) => editor?.isActive({ textAlign: alignment })) as 'left' | 'center' | 'right' | undefined);
  const currentVerticalAlign = currentCellAttributes?.verticalAlign ?? currentHeaderAttributes?.verticalAlign;
  const selectedFontSize = FONT_SIZE_OPTIONS.some((option) => option.value === currentTextStyle?.fontSize) ? currentTextStyle?.fontSize ?? '' : '';
  const selectedFontColor = FONT_COLOR_OPTIONS.some((option) => option.value === currentTextStyle?.color) ? currentTextStyle?.color ?? '' : '';

  const actions: ToolbarAction[] = editor
    ? [
        { label: 'Bold', icon: IconBold, active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
        { label: 'Italic', icon: IconItalic, active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
        { label: 'Strike', icon: IconStrikethrough, active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
        { label: 'Heading 1', icon: IconH1, active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
        { label: 'Heading 2', icon: IconH2, active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: 'Bullet list', icon: IconList, active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() },
        { label: 'Numbered list', icon: IconListNumbers, active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() },
        { label: 'Blockquote', icon: IconBlockquote, active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run() },
        { label: 'Code block', icon: IconCode, active: editor.isActive('codeBlock'), onClick: () => editor.chain().focus().toggleCodeBlock().run() },
        { label: 'Link', icon: IconLink, active: editor.isActive('link'), onClick: promptForLink },
        { label: 'Image or GIF', icon: IconPhotoPlus, onClick: promptForImage },
        { label: 'Insert table', icon: IconTable, active: editor.isActive('table'), onClick: insertTable },
        { label: 'Add row', icon: IconRowInsertBottom, disabled: !editor.isActive('table'), onClick: addRowAfter },
        { label: 'Remove row', icon: IconRowRemove, disabled: !editor.isActive('table'), onClick: deleteCurrentRow },
        { label: 'Add column', icon: IconColumnInsertRight, disabled: !editor.isActive('table'), onClick: addColumnAfter },
        { label: 'Remove column', icon: IconColumnRemove, disabled: !editor.isActive('table'), onClick: deleteCurrentColumn },
        { label: 'Delete table', icon: IconTableMinus, disabled: !editor.isActive('table'), onClick: deleteCurrentTable },
        { label: 'Clear formatting', icon: IconTrash, onClick: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
        { label: 'Undo', icon: IconArrowBackUp, disabled: !editor.can().chain().focus().undo().run(), onClick: () => editor.chain().focus().undo().run() },
        { label: 'Redo', icon: IconArrowForwardUp, disabled: !editor.can().chain().focus().redo().run(), onClick: () => editor.chain().focus().redo().run() },
      ]
    : [];

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        Body
      </Text>
      <Box className="cerebro-editor-shell">
        <Group className="cerebro-editor-toolbar" gap="xs">
          {actions.map((action) => (
            <Tooltip key={action.label} label={action.label}>
              <ActionIcon
                type="button"
                variant={action.active ? 'filled' : 'light'}
                color={action.active ? 'blue' : 'gray'}
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.label}
              >
                <action.icon size={16} />
              </ActionIcon>
            </Tooltip>
          ))}
          <Tooltip label="Align left">
            <ActionIcon
              type="button"
              variant={currentHorizontalAlign === 'left' ? 'filled' : 'light'}
              color={currentHorizontalAlign === 'left' ? 'blue' : 'gray'}
              onClick={() => setHorizontalAlign('left')}
              aria-label="Align left"
            >
              <IconAlignLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Align center">
            <ActionIcon
              type="button"
              variant={currentHorizontalAlign === 'center' ? 'filled' : 'light'}
              color={currentHorizontalAlign === 'center' ? 'blue' : 'gray'}
              onClick={() => setHorizontalAlign('center')}
              aria-label="Align center"
            >
              <IconAlignCenter size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Align right">
            <ActionIcon
              type="button"
              variant={currentHorizontalAlign === 'right' ? 'filled' : 'light'}
              color={currentHorizontalAlign === 'right' ? 'blue' : 'gray'}
              onClick={() => setHorizontalAlign('right')}
              aria-label="Align right"
            >
              <IconAlignRight size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Vertical align top">
            <ActionIcon
              type="button"
              variant={currentVerticalAlign === 'top' ? 'filled' : 'light'}
              color={currentVerticalAlign === 'top' ? 'blue' : 'gray'}
              onClick={() => setVerticalAlign('top')}
              disabled={!editor?.isActive('table')}
              aria-label="Vertical align top"
            >
              <Text size="xs" fw={700}>T</Text>
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Vertical align middle">
            <ActionIcon
              type="button"
              variant={currentVerticalAlign === 'middle' ? 'filled' : 'light'}
              color={currentVerticalAlign === 'middle' ? 'blue' : 'gray'}
              onClick={() => setVerticalAlign('middle')}
              disabled={!editor?.isActive('table')}
              aria-label="Vertical align middle"
            >
              <Text size="xs" fw={700}>M</Text>
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Vertical align bottom">
            <ActionIcon
              type="button"
              variant={currentVerticalAlign === 'bottom' ? 'filled' : 'light'}
              color={currentVerticalAlign === 'bottom' ? 'blue' : 'gray'}
              onClick={() => setVerticalAlign('bottom')}
              disabled={!editor?.isActive('table')}
              aria-label="Vertical align bottom"
            >
              <Text size="xs" fw={700}>B</Text>
            </ActionIcon>
          </Tooltip>
          <NativeSelect
            aria-label="Font size"
            className="cerebro-toolbar-select"
            data={FONT_SIZE_OPTIONS}
            value={selectedFontSize}
            onChange={(event) => setFontSize(event.currentTarget.value)}
          />
          <NativeSelect
            aria-label="Font color"
            className="cerebro-toolbar-select"
            data={FONT_COLOR_OPTIONS}
            value={selectedFontColor}
            onChange={(event) => setFontColor(event.currentTarget.value)}
          />
        </Group>
        <Divider />
        <Box className="cerebro-editor-content">
          <EditorContent editor={editor} />
        </Box>
      </Box>
      <Text size="xs" c="dimmed">
        Add formatting, alignment, colors, tables, and hosted image or GIF URLs directly into the article body.
      </Text>
    </Stack>
  );
};
