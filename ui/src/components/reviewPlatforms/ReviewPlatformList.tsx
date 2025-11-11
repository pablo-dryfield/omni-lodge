import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconPlus, IconRefresh, IconPencil, IconTrash } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  fetchReviewPlatforms,
  createReviewPlatform,
  updateReviewPlatform,
  deleteReviewPlatform,
} from '../../actions/reviewPlatformActions';
import type { ReviewPlatform } from '../../types/reviewPlatforms/ReviewPlatform';
import type { ServerResponse } from '../../types/general/ServerResponse';

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

type FormState = {
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  weight: number;
  sourceKey: string;
  platformUrl: string;
  aliases: string;
};

const initialFormState: FormState = {
  name: '',
  slug: '',
  description: '',
  isActive: true,
  weight: 1,
  sourceKey: '',
  platformUrl: '',
  aliases: '',
};

const ReviewPlatformList = () => {
  const dispatch = useAppDispatch();
  const platformState = useAppSelector((state) => state.reviewPlatforms)[0];
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<ReviewPlatform | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dispatch(fetchReviewPlatforms());
  }, [dispatch]);

  const platforms = useMemo<ReviewPlatform[]>(() => {
    const serverData = (platformState.data as ServerResponse<ReviewPlatform>)[0]?.data ?? [];
    return serverData;
  }, [platformState.data]);

  const closeForm = () => {
    setFormOpen(false);
    setEditingPlatform(null);
    setFormError(null);
    setFormState(initialFormState);
  };

  const openCreateForm = () => {
    setEditingPlatform(null);
    setFormState(initialFormState);
    setFormOpen(true);
  };

  const openEditForm = (platform: ReviewPlatform) => {
    setEditingPlatform(platform);
    setFormState({
      name: platform.name ?? '',
      slug: platform.slug ?? '',
      description: platform.description ?? '',
      isActive: platform.isActive !== false,
      weight: Number(platform.weight ?? 1) || 1,
      sourceKey: platform.sourceKey ?? '',
      platformUrl: platform.platformUrl ?? '',
      aliases: (platform.aliases ?? []).join('\n'),
    });
    setFormOpen(true);
  };

  const handleDelete = useCallback(
    async (platformId: number) => {
      if (!window.confirm('Delete this review platform?')) {
        return;
      }
      try {
        await dispatch(deleteReviewPlatform(platformId)).unwrap();
        await dispatch(fetchReviewPlatforms());
      } catch (error) {
        console.error('Failed to delete review platform', error);
      }
    },
    [dispatch],
  );

  const handleSubmit = async () => {
    if (!formState.name.trim()) {
      setFormError('Name is required');
      return;
    }

    const normalizedSlug = formState.slug.trim() ? slugify(formState.slug) : slugify(formState.name);
    const aliasList = formState.aliases
      .split(/[\n,]+/)
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);
    const sanitizedWeight = Math.max(0, Number.isFinite(formState.weight) ? Number(formState.weight) : 1);
    const payload = {
      name: formState.name.trim(),
      slug: normalizedSlug,
      description: formState.description.trim() || null,
      isActive: formState.isActive,
      weight: Number(sanitizedWeight.toFixed(2)),
      sourceKey: formState.sourceKey.trim() || null,
      platformUrl: formState.platformUrl.trim() || null,
      aliases: aliasList,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      if (editingPlatform) {
        await dispatch(updateReviewPlatform({ platformId: editingPlatform.id, payload })).unwrap();
      } else {
        await dispatch(createReviewPlatform(payload)).unwrap();
      }
      await dispatch(fetchReviewPlatforms());
      closeForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save review platform';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTextChange = useCallback(
    (field: keyof Pick<FormState, 'name' | 'slug' | 'description' | 'sourceKey' | 'platformUrl' | 'aliases'>) =>
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { value } = event.currentTarget;
        setFormState((prev) => ({ ...prev, [field]: value }));
      },
    [],
  );

  const handleWeightChange = (value: string | number) => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    setFormState((prev) => ({
      ...prev,
      weight: Number.isFinite(numericValue) ? numericValue : prev.weight,
    }));
  };

  const handleSwitchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.currentTarget;
    setFormState((prev) => ({ ...prev, isActive: checked }));
  };

  if (platformState.loading && platforms.length === 0) {
    return (
      <Center style={{ minHeight: 320 }}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (platformState.error) {
    return (
      <Alert color="red" title="Failed to load review platforms">
        {platformState.error}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" c="dimmed">
            Define the review platforms that staff counters can reference.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh data">
            <ActionIcon variant="light" onClick={() => dispatch(fetchReviewPlatforms())}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
            Add Platform
          </Button>
        </Group>
      </Group>

      {platforms.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Stack gap="xs" align="center">
            <Text size="sm" c="dimmed">
              No review platforms configured yet.
            </Text>
            <Button onClick={openCreateForm} leftSection={<IconPlus size={16} />}>Create Platform</Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="sm">
          {platforms.map((platform) => (
            <Card key={platform.id} withBorder radius="md" padding="md">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Group gap="xs">
                    <Text fw={600}>{platform.name}</Text>
                    <Badge color={platform.isActive !== false ? 'teal' : 'gray'}>
                      {platform.isActive !== false ? 'Active' : 'Inactive'}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    Slug: {platform.slug}
                  </Text>
                  <Group gap="xs">
                    <Badge variant="light" color="violet">
                      Weight x{Number(platform.weight ?? 1).toFixed(2)}
                    </Badge>
                    {platform.sourceKey && (
                      <Badge variant="light" color="gray">
                        {platform.sourceKey}
                      </Badge>
                    )}
                  </Group>
                  {platform.platformUrl && (
                    <Text size="xs" c="dimmed">
                      URL:{' '}
                      <Text
                        component="a"
                        href={platform.platformUrl}
                        target="_blank"
                        rel="noreferrer"
                        size="xs"
                      >
                        {platform.platformUrl}
                      </Text>
                    </Text>
                  )}
                  {platform.aliases && platform.aliases.length > 0 && (
                    <Text size="xs" c="dimmed">
                      Aliases: {platform.aliases.join(', ')}
                    </Text>
                  )}
                  {platform.description && (
                    <Text size="sm">{platform.description}</Text>
                  )}
                </Stack>
                <Group gap="xs">
                  <Tooltip label="Edit platform">
                    <ActionIcon variant="light" onClick={() => openEditForm(platform)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete platform">
                    <ActionIcon color="red" variant="light" onClick={() => handleDelete(platform.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <Modal
        opened={formOpen}
        onClose={closeForm}
        title={editingPlatform ? 'Edit Review Platform' : 'New Review Platform'}
        centered
        radius="md"
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="e.g., Google"
            required
            value={formState.name}
            onChange={handleTextChange('name')}
          />
          <TextInput
            label="Slug"
            placeholder="google"
            value={formState.slug}
            onChange={handleTextChange('slug')}
            description="Used internally. Will be generated from the name if left blank."
          />
          <Textarea
            label="Description"
            minRows={3}
            value={formState.description}
            onChange={handleTextChange('description')}
          />
          <NumberInput
            label="Weight (multiplier)"
            min={0}
            step={0.1}
            value={formState.weight}
            onChange={handleWeightChange}
            description="How much this platform should weigh when rolling up review totals."
          />
          <TextInput
            label="Source key"
            placeholder="e.g., google, tripadvisor"
            value={formState.sourceKey}
            onChange={handleTextChange('sourceKey')}
            description="Identifier used when mapping imported reviews to this platform."
          />
          <TextInput
            label="Platform URL"
            placeholder="https://maps.app.goo.gl/... "
            value={formState.platformUrl}
            onChange={handleTextChange('platformUrl')}
          />
          <Textarea
            label="Aliases / mapping keys"
            minRows={2}
            placeholder="Comma or line separated list of alternate names"
            value={formState.aliases}
            onChange={handleTextChange('aliases')}
            description="Used for fuzzy matching (e.g., Google Maps label, TripAdvisor short codes)."
          />
          <Switch
            label="Platform is active"
            checked={formState.isActive}
            onChange={handleSwitchChange}
          />
          {formError && (
            <Alert color="red" title="Unable to save">
              {formError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeForm} disabled={submitting}>
              Cancel
            </Button>
            <Button loading={submitting} onClick={handleSubmit}>
              {editingPlatform ? 'Save Changes' : 'Create Platform'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ReviewPlatformList;
