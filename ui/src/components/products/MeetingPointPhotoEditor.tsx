import { useRef, useState } from 'react';
import { Alert, Button, FileButton, Group, Image, Paper, Stack, Text, TextInput } from '@mantine/core';
import { IconPhoto, IconTrash, IconUpload } from '@tabler/icons-react';
import { uploadProductImage } from '../../actions/productActions';
import { compressImageFile } from '../../utils/imageCompression';
import type { StorefrontMeetingPoint } from '../../types/products/Product';

type Props = {
  productId?: number;
  value: StorefrontMeetingPoint;
  onChange: (patch: Partial<StorefrontMeetingPoint>) => void;
  onUploaded: (url: string) => void;
  onUploadingChange: (uploading: boolean) => void;
};

export default function MeetingPointPhotoEditor({ productId, value, onChange, onUploaded, onUploadingChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetRef = useRef<() => void>(null);
  const upload = async (file: File | null) => {
    if (!file || !productId) return;
    setUploading(true);
    onUploadingChange(true);
    setError(null);
    try {
      // JPEG is supported by email clients as well as both storefronts.
      const prepared = await compressImageFile(file, { force: true, maxWidth: 1600, maxHeight: 1600,
        quality: 0.85, maxSizeBytes: 1200 * 1024, outputMimeType: 'image/jpeg' });
      const image = await uploadProductImage(productId, prepared);
      onUploaded(image.url);
      onChange({ photoUrl: image.url, photoAlt: value.photoAlt || value.name || 'Meeting point' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to upload the meeting point photo.');
    } finally {
      setUploading(false);
      onUploadingChange(false);
      resetRef.current?.();
    }
  };
  return <Paper withBorder radius="md" p="md">
    <Stack gap="sm">
      <Text fw={600}>Meeting point photo</Text>
      <Text size="sm" c="dimmed">Help guests recognize where to meet. Shared with storefronts and booking emails.</Text>
      {value.photoUrl ? <Image src={value.photoUrl} alt={value.photoAlt || value.name || 'Meeting point'}
        h={220} fit="contain" radius="md" /> : <Group gap="xs"><IconPhoto size={22} /><Text size="sm" c="dimmed">No meeting point photo</Text></Group>}
      {value.photoUrl && <TextInput label="Photo description" description="Describe the location for guests using a screen reader."
        maxLength={500} value={value.photoAlt ?? ''} onChange={(event) => onChange({ photoAlt: event.currentTarget.value })} />}
      {!productId && <Text size="sm" c="dimmed">Create the product first, then upload its meeting point photo.</Text>}
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        <FileButton resetRef={resetRef} onChange={upload} inputProps={{ 'aria-label': 'Meeting point photo file' }}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={!productId || uploading}>
          {(props) => <Button {...props} variant="light" loading={uploading} leftSection={<IconUpload size={16} />}>
            {value.photoUrl ? 'Replace photo' : 'Upload meeting point photo'}
          </Button>}
        </FileButton>
        {value.photoUrl && <Button color="red" variant="subtle" disabled={uploading} leftSection={<IconTrash size={16} />}
          onClick={() => onChange({ photoUrl: '', photoAlt: '' })}>Remove photo</Button>}
      </Group>
    </Stack>
  </Paper>;
}
