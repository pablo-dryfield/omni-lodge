import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
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
} from '@tabler/icons-react';
import { normalizeCerebroRichText } from '../../utils/cerebroRichText';
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

export const CerebroRichTextEditor = ({
  value,
  onChange,
}: CerebroRichTextEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        autolink: true,
        openOnClick: false,
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
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
        </Group>
        <Divider />
        <Box className="cerebro-editor-content">
          <EditorContent editor={editor} />
        </Box>
      </Box>
      <Text size="xs" c="dimmed">
        Add formatting, links, and hosted image or GIF URLs directly into the article body.
      </Text>
    </Stack>
  );
};
