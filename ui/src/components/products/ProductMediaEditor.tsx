import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  FileButton,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconPhoto,
  IconStar,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { uploadProductImage } from '../../actions/productActions';
import { ProductImage } from '../../types/products/Product';
import { compressImageFile } from '../../utils/imageCompression';

type ProductMediaEditorProps = {
  productId?: number;
  productName: string;
  imageUrl: string | null;
  images: ProductImage[];
  onChange: (value: { imageUrl: string | null; images: ProductImage[] }) => void;
  onUploaded: (url: string) => void;
  onUploadingChange: (uploading: boolean) => void;
};

const orderedImages = (images: ProductImage[]) =>
  [...images]
    .sort((left, right) => left.order - right.order)
    .map((image, index) => ({ ...image, order: index + 1 }));

const ProductMediaEditor = ({
  productId,
  productName,
  imageUrl,
  images,
  onChange,
  onUploaded,
  onUploadingChange,
}: ProductMediaEditorProps) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const sortedImages = useMemo(() => orderedImages(images), [images]);

  const emitImages = (nextImages: ProductImage[], nextCover = imageUrl) => {
    const normalized = orderedImages(nextImages);
    const coverExists = nextCover && normalized.some((image) => image.url === nextCover);
    onChange({
      images: normalized,
      imageUrl: coverExists ? nextCover : normalized[0]?.url ?? null,
    });
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !productId) return;
    setUploading(true);
    onUploadingChange(true);
    setUploadError(null);
    try {
      const preparedFile = await compressImageFile(file, {
        force: true,
        maxWidth: 1800,
        maxHeight: 1800,
        quality: 0.84,
        maxSizeBytes: 1200 * 1024,
        outputMimeType: 'image/webp',
      });
      const uploaded = await uploadProductImage(productId, preparedFile);
      const nextImage = {
        ...uploaded,
        alt: productName.trim() || uploaded.alt,
        order: sortedImages.length + 1,
      };
      onUploaded(nextImage.url);
      emitImages([...sortedImages, nextImage], imageUrl ?? nextImage.url);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unable to upload this image.');
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= sortedImages.length) return;
    const next = [...sortedImages];
    [next[index], next[destination]] = [next[destination], next[index]];
    emitImages(next);
  };

  const removeImage = (url: string) => {
    emitImages(sortedImages.filter((image) => image.url !== url));
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Box>
            <Text fw={700}>Storefront media</Text>
            <Text size="sm" c="dimmed">Choose the cover and arrange the product gallery.</Text>
          </Box>
          <FileButton
            onChange={handleUpload}
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            disabled={!productId || uploading}
          >
            {(props) => (
              <Button {...props} loading={uploading} leftSection={<IconUpload size={16} />}>
                Upload image
              </Button>
            )}
          </FileButton>
        </Group>

        {!productId && (
          <Alert color="blue" icon={<IconPhoto size={18} />}>
            Create this product before uploading its media.
          </Alert>
        )}
        {uploadError && <Alert color="red">{uploadError}</Alert>}

        {sortedImages.length === 0 ? (
          <Paper withBorder p="xl" bg="gray.0">
            <Stack align="center" gap={6}>
              <IconPhoto size={28} color="var(--mantine-color-gray-5)" />
              <Text fw={600}>No product images</Text>
              <Text size="sm" c="dimmed" ta="center">
                Upload a landscape image to use in the storefront and shared-link preview.
              </Text>
            </Stack>
          </Paper>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {sortedImages.map((image, index) => {
              const isCover = image.url === imageUrl;
              return (
                <Paper key={image.url} withBorder p="sm">
                  <Stack gap="sm">
                    <Box pos="relative">
                      <Image
                        src={image.url}
                        alt={image.alt}
                        h={150}
                        fit="cover"
                      />
                      {isCover && (
                        <Badge pos="absolute" top={8} left={8} color="yellow" c="black" leftSection={<IconStar size={12} />}>
                          Cover
                        </Badge>
                      )}
                    </Box>
                    <TextInput
                      label="Alt text"
                      value={image.alt}
                      placeholder={productName || 'Describe this image'}
                      onChange={(event) => {
                        const next = sortedImages.map((entry) =>
                          entry.url === image.url ? { ...entry, alt: event.currentTarget.value } : entry,
                        );
                        emitImages(next);
                      }}
                    />
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant={isCover ? 'light' : 'default'}
                        leftSection={<IconStar size={14} />}
                        disabled={isCover}
                        onClick={() => onChange({ imageUrl: image.url, images: sortedImages })}
                      >
                        {isCover ? 'Cover image' : 'Set as cover'}
                      </Button>
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label="Move image up">
                          <ActionIcon variant="default" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label="Move image up">
                            <IconArrowUp size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Move image down">
                          <ActionIcon variant="default" disabled={index === sortedImages.length - 1} onClick={() => moveImage(index, 1)} aria-label="Move image down">
                            <IconArrowDown size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Remove image">
                          <ActionIcon color="red" variant="subtle" onClick={() => removeImage(image.url)} aria-label="Remove image">
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Stack>
                </Paper>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>
    </Paper>
  );
};

export default ProductMediaEditor;
