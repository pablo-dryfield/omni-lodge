import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Group,
  Modal,
  MultiSelect,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { api, message } from './api';
export function ShareDialog({
  input,
  opened,
  onClose,
}: {
  input: Record<string, unknown>;
  opened: boolean;
  onClose: () => void;
}) {
  const recipients = useQuery({
    queryKey: ['dw-share-recipients'],
    queryFn: api.recipients,
    enabled: opened,
    retry: false,
  });
  const [selected, setSelected] = useState<string[]>([]),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const saved = await api.share({
        ...input,
        recipientIds: selected.map(Number),
      });
      const link = new URL(saved.path, window.location.origin).toString();
      setUrl(link);
      await navigator.clipboard.writeText(link).catch(() => {});
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Share with administrators"
      centered
    >
      <Stack>
        <Text size="sm">
          Choose named recipients. They must sign in and retain matching
          database access. Links expire with workspace retention and can be
          revoked from Saved queries.
        </Text>
        {(error || recipients.error) && (
          <Alert color="red">{error || message(recipients.error)}</Alert>
        )}
        <MultiSelect
          label="Recipients"
          value={selected}
          onChange={setSelected}
          searchable
          data={(recipients.data || []).map((r) => ({
            value: String(r.id),
            label: r.name,
          }))}
        />
        {url && (
          <TextInput
            label="Authenticated share link"
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <Group justify="end">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={busy}
            disabled={!selected.length}
            onClick={() => void create()}
          >
            {url ? 'Create new link' : 'Create & copy link'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
