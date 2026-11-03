import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Code,
  Drawer,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { api, message, type Document } from './api';
import { ShareDialog } from './ShareDialog';
export function QueryLibrary({
  onOpen,
  onNew,
  canShare,
}: {
  onOpen: (document: Document) => void;
  onNew: () => void;
  canShare: boolean;
}) {
  const queries = useQuery({
      queryKey: ['database-workspace-documents'],
      queryFn: () => api.documents('query'),
      retry: false,
    }),
    shares = useQuery({
      queryKey: ['dw-own-shares'],
      queryFn: () => api.documents('share'),
      retry: false,
    });
  const [search, setSearch] = useState(''),
    [folder, setFolder] = useState<string | null>(null),
    [tags, setTags] = useState<string[]>([]),
    [favorites, setFavorites] = useState(false),
    [error, setError] = useState(''),
    [sharing, setSharing] = useState<string>(),
    [editing, setEditing] = useState<Document>(),
    [editTitle, setEditTitle] = useState(''),
    [editFolder, setEditFolder] = useState(''),
    [editTags, setEditTags] = useState(''),
    [history, setHistory] = useState<Document>();
  const revisions = useQuery({
    queryKey: ['dw-query-revisions', history?.id],
    queryFn: () => api.revisions(history!.id),
    enabled: Boolean(history),
    retry: false,
  });
  const visible = useMemo(
    () =>
      (queries.data || []).filter(
        (d) =>
          (!search ||
            `${d.value.title} ${d.value.sql} ${d.value.folder}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!folder || d.value.folder === folder) &&
          (!favorites || d.value.favorite) &&
          tags.every((t) => d.value.tags?.includes(t)),
      ),
    [queries.data, search, folder, favorites, tags],
  );
  async function save(doc: Document, value: Document['value']) {
    try {
      await api.saveDocument({
        id: doc.id,
        kind: 'query',
        revision: doc.revision,
        value,
      });
      await queries.refetch();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="dw-pane">
      <Group justify="space-between" mb="md">
        <div>
          <Text fw={700}>Query library</Text>
          <Text size="xs" c="dimmed">
            Private encrypted SQL, named revisions and explicit sharing. Opening
            a query never executes it.
          </Text>
        </div>
        <Button size="xs" variant="light" onClick={onNew}>
          New query
        </Button>
      </Group>
      {(error || queries.error) && (
        <Alert color="red" mb="md">
          {error || message(queries.error)}
        </Alert>
      )}
      <Group align="end" mb="lg">
        <TextInput
          label="Search SQL & names"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <Select
          clearable
          label="Folder"
          value={folder}
          onChange={setFolder}
          data={[
            ...new Set(
              (queries.data || [])
                .map((d) => d.value.folder)
                .filter((v): v is string => Boolean(v)),
            ),
          ]}
        />
        <MultiSelect
          searchable
          clearable
          label="Tags"
          value={tags}
          onChange={setTags}
          data={[
            ...new Set((queries.data || []).flatMap((d) => d.value.tags || [])),
          ]}
        />
        <Switch
          label="Favorites"
          checked={favorites}
          onChange={(e) => setFavorites(e.currentTarget.checked)}
          mb={8}
        />
      </Group>
      <div className="dw-grid">
        {visible.map((d) => (
          <div className="dw-card" key={d.id}>
            <Group justify="space-between">
              <Text fw={600} size="sm">
                {d.value.title || 'Untitled'}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                aria-label={`${d.value.favorite ? 'Unfavorite' : 'Favorite'} ${d.value.title}`}
                onClick={() =>
                  void save(d, { ...d.value, favorite: !d.value.favorite })
                }
              >
                {d.value.favorite ? '★' : '☆'}
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              {d.value.folder || 'Unfiled'} · revision {d.revision} ·{' '}
              {(d.value.tags || []).join(', ')}
            </Text>
            <Code block mt="sm" style={{ height: 110, overflow: 'auto' }}>
              {String(d.value.sql || '')}
            </Code>
            <Group mt="sm" gap={5}>
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => onOpen(d)}
              >
                Open query
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  setEditing(d);
                  setEditTitle(String(d.value.title || ''));
                  setEditFolder(String(d.value.folder || ''));
                  setEditTags((d.value.tags || []).join(', '));
                }}
              >
                Organize
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setHistory(d)}
              >
                Revisions
              </Button>
              {canShare && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setSharing(d.id)}
                >
                  Share
                </Button>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() =>
                  void api
                    .deleteDocument(d.id)
                    .then(() => queries.refetch())
                    .catch((e) => setError(message(e)))
                }
              >
                Delete
              </Button>
            </Group>
          </div>
        ))}
      </div>
      {!visible.length && (
        <Text p="lg" c="dimmed" size="sm">
          No saved queries match these filters.
        </Text>
      )}
      {!!shares.data?.length && (
        <Stack mt="xl">
          <Text fw={600} size="sm">
            Active authenticated shares
          </Text>
          {shares.data.map((d) => (
            <Group key={d.id} justify="space-between">
              <Text size="xs">
                {d.value.title || 'Shared result'} · {d.id}
              </Text>
              <Button
                size="compact-xs"
                variant="light"
                color="red"
                onClick={() =>
                  void api
                    .deleteDocument(d.id)
                    .then(() => shares.refetch())
                    .catch((e) => setError(message(e)))
                }
              >
                Revoke link
              </Button>
            </Group>
          ))}
        </Stack>
      )}
      {sharing && (
        <ShareDialog
          input={{ kind: 'query', documentId: sharing }}
          opened
          onClose={() => {
            setSharing(undefined);
            void shares.refetch();
          }}
        />
      )}
      <Modal
        opened={Boolean(editing)}
        onClose={() => setEditing(undefined)}
        title="Organize saved query"
        centered
      >
        <Stack>
          <TextInput
            label="Name"
            value={editTitle}
            onChange={(e) => setEditTitle(e.currentTarget.value)}
            maxLength={120}
          />
          <TextInput
            label="Folder"
            value={editFolder}
            onChange={(e) => setEditFolder(e.currentTarget.value)}
            maxLength={120}
          />
          <TextInput
            label="Tags, separated by commas"
            value={editTags}
            onChange={(e) => setEditTags(e.currentTarget.value)}
            maxLength={1000}
          />
          <Button
            disabled={!editTitle.trim()}
            onClick={() => {
              if (editing)
                void save(editing, {
                  ...editing.value,
                  title: editTitle,
                  folder: editFolder,
                  tags: [
                    ...new Set(
                      editTags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    ),
                  ].slice(0, 20),
                });
              setEditing(undefined);
            }}
          >
            Save organization
          </Button>
        </Stack>
      </Modal>
      <Drawer
        opened={Boolean(history)}
        onClose={() => setHistory(undefined)}
        title={`Revisions · ${history?.value.title}`}
        position="right"
        size="lg"
      >
        <Stack>
          {revisions.error && (
            <Alert color="red">{message(revisions.error)}</Alert>
          )}
          <Text size="xs" c="dimmed">
            Historical revisions open as a new unsaved query; they never
            overwrite the current document automatically.
          </Text>
          {revisions.data?.map((r) => (
            <div className="dw-card" key={r.revision}>
              <Text size="sm" fw={600}>
                Revision {r.revision} · {new Date(r.createdAt).toLocaleString()}
              </Text>
              <Code block mt="sm" style={{ maxHeight: 220, overflow: 'auto' }}>
                {String(r.value.sql || '')}
              </Code>
              <Button
                size="compact-xs"
                variant="light"
                mt="sm"
                onClick={() => {
                  onOpen({
                    id: '',
                    kind: 'query',
                    revision: 0,
                    updatedAt: r.createdAt,
                    value: {
                      ...r.value,
                      title: `${r.value.title || 'Query'} · revision ${r.revision}`,
                    },
                  });
                  setHistory(undefined);
                }}
              >
                Open this revision as a copy
              </Button>
            </div>
          ))}
        </Stack>
      </Drawer>
    </div>
  );
}
