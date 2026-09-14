import {
  Accordion,
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconPhoto, IconRefresh } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useState } from "react";
import {
  getCleaningError,
  type CleaningPhotoVersion,
  useCleaningCachedDataBlocked,
  useCleaningTaskHistory,
} from "../../api/volunteerCleaning";
import { useAppSelector } from "../../store/hooks";
import CleaningPhotoPreview from "./CleaningPhotoPreview";

const statusMeta: Record<CleaningPhotoVersion["status"], { label: string; color: string }> = {
  pending: { label: "Awaiting review", color: "blue" },
  approved: { label: "Approved", color: "teal" },
  rejected: { label: "Rejected", color: "red" },
};

type SelectedPhoto = {
  submissionId: number;
  subjectName: string;
  slotLabel: string;
  photo: CleaningPhotoVersion;
};

const CleaningTaskPhotoHistory = ({ taskLogId }: { taskLogId: number }) => {
  const userId = useAppSelector((state) => state.session.loggedUserId);
  const mobile = useMediaQuery("(max-width: 48em)");
  const [opened, setOpened] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<SelectedPhoto | null>(null);
  const query = useCleaningTaskHistory(taskLogId, userId, opened);
  const cachedDataBlocked = useCleaningCachedDataBlocked(query.error, query.isSuccess);
  const history = cachedDataBlocked ? undefined : query.data;
  const submissions = history?.submissions ?? [];
  const photoCount = submissions.reduce(
    (total, submission) => total + submission.slots.reduce((slotTotal, slot) => slotTotal + slot.history.length, 0),
    0,
  );

  return <>
    <Button
      variant="light"
      size="sm"
      leftSection={<IconPhoto size={16} />}
      onClick={() => setOpened(true)}
    >
      View cleaning photos
    </Button>

    <Modal
      opened={opened}
      onClose={() => { setOpened(false); setSelectedPhoto(null); }}
      title="Cleaning photo history"
      size="xl"
      fullScreen={mobile}
      centered
    >
      {query.isLoading && !query.data ? <Center py="xl"><Loader aria-label="Loading cleaning photo history" /></Center> : null}
      {(cachedDataBlocked || (query.error && !history)) ? <Alert color="red" title="Unable to load cleaning photos">
        <Stack gap="xs">
          <Text size="sm">{getCleaningError(query.error, "Unable to load this cleaning photo history.")}</Text>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void query.refetch()}
            loading={query.isFetching}
          >
            Try again
          </Button>
        </Stack>
      </Alert> : null}
      {history ? <Stack gap="md">
        {query.error ? <Alert color="yellow" title="Photo refresh interrupted">
          {getCleaningError(query.error, "Unable to refresh these photos right now.")} Showing the last saved history.
        </Alert> : null}
        <Group justify="space-between" wrap="wrap">
          <Text size="sm" c="dimmed">
            {submissions.length} {submissions.length === 1 ? "person" : "people"} - {photoCount} {photoCount === 1 ? "photo" : "photos"}
          </Text>
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void query.refetch()}
            loading={query.isFetching}
          >
            Refresh
          </Button>
        </Group>
        {!submissions.length ? <Alert color="gray">No cleaning assignments were saved for this task.</Alert> : null}
        {submissions.map((submission) => {
          const submissionPhotoCount = submission.slots.reduce((total, slot) => total + slot.history.length, 0);
          return <Paper key={submission.id} withBorder radius="lg" p={{ base: "sm", sm: "md" }}>
            <Stack gap="sm">
              <Stack gap={2} ta="center">
                <Text fw={700}>{submission.subjectName || `Staff #${submission.userId}`}</Text>
                <Text size="sm" c="dimmed">{submission.shiftName} - {dayjs(submission.taskDate).format("D MMM YYYY")}</Text>
                <Text size="xs" c="dimmed">{submissionPhotoCount} {submissionPhotoCount === 1 ? "uploaded photo" : "uploaded photos"}</Text>
              </Stack>
              <Accordion multiple defaultValue={submission.slots.filter((slot) => slot.history.length > 0).map((slot) => slot.key)}>
                {submission.slots.map((slot) => <Accordion.Item key={slot.key} value={slot.key}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="xs">
                      <Text fw={600} size="sm">{slot.label}</Text>
                      <Badge color={slot.currentVersion ? statusMeta[slot.currentVersion.status].color : "gray"} variant="light">
                        {slot.currentVersion ? statusMeta[slot.currentVersion.status].label : "Not uploaded"}
                      </Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {!slot.history.length ? <Text size="sm" c="dimmed" ta="center">No photo was uploaded for this item.</Text> : null}
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      {slot.history.map((photo, index) => <Paper key={photo.id} withBorder radius="md" p="sm">
                        <Stack gap="xs" ta="center">
                          <Group justify="center" gap="xs">
                            <Badge color={statusMeta[photo.status].color}>{statusMeta[photo.status].label}</Badge>
                            <Badge variant="outline" color="gray">Version {photo.version}</Badge>
                            {index === 0 ? <Badge variant="light" color="violet">Latest</Badge> : null}
                          </Group>
                          <Text size="xs" c="dimmed">Uploaded {dayjs(photo.uploadedAt).format("D MMM YYYY, HH:mm")}</Text>
                          {photo.reviewerName && photo.reviewedAt ? <Text size="xs" c="dimmed">
                            Reviewed by {photo.reviewerName} - {dayjs(photo.reviewedAt).format("D MMM YYYY, HH:mm")}
                          </Text> : null}
                          {photo.rejectionReason ? <Alert color="red" p="xs">{photo.rejectionReason}</Alert> : null}
                          <Button
                            variant="default"
                            size="xs"
                            leftSection={<IconPhoto size={14} />}
                            aria-label={`View ${submission.subjectName || `Staff #${submission.userId}`} ${slot.label} photo version ${photo.version}`}
                            onClick={() => setSelectedPhoto({
                              submissionId: submission.id,
                              subjectName: submission.subjectName || `Staff #${submission.userId}`,
                              slotLabel: slot.label,
                              photo,
                            })}
                          >
                            View photo
                          </Button>
                        </Stack>
                      </Paper>)}
                    </SimpleGrid>
                  </Accordion.Panel>
                </Accordion.Item>)}
              </Accordion>
            </Stack>
          </Paper>;
        })}
      </Stack> : null}
    </Modal>

    <Modal
      opened={Boolean(selectedPhoto)}
      onClose={() => setSelectedPhoto(null)}
      title={selectedPhoto ? `${selectedPhoto.subjectName} - ${selectedPhoto.slotLabel}` : "Cleaning photo"}
      size="xl"
      fullScreen={mobile}
      centered
    >
      {selectedPhoto ? <Stack gap="sm">
        <Group justify="center" gap="xs">
          <Badge color={statusMeta[selectedPhoto.photo.status].color}>{statusMeta[selectedPhoto.photo.status].label}</Badge>
          <Badge variant="outline" color="gray">Version {selectedPhoto.photo.version}</Badge>
        </Group>
        <CleaningPhotoPreview
          submissionId={selectedPhoto.submissionId}
          photoId={selectedPhoto.photo.id}
          label={`${selectedPhoto.subjectName} ${selectedPhoto.slotLabel}`}
        />
        <Text size="xs" c="dimmed" ta="center">
          Uploaded {dayjs(selectedPhoto.photo.uploadedAt).format("D MMM YYYY, HH:mm")}
        </Text>
        {selectedPhoto.photo.reviewerName && selectedPhoto.photo.reviewedAt ? <Text size="xs" c="dimmed" ta="center">
          Reviewed by {selectedPhoto.photo.reviewerName} - {dayjs(selectedPhoto.photo.reviewedAt).format("D MMM YYYY, HH:mm")}
        </Text> : null}
        {selectedPhoto.photo.rejectionReason ? <Alert color="red" title="Retake reason">{selectedPhoto.photo.rejectionReason}</Alert> : null}
      </Stack> : null}
    </Modal>
  </>;
};

export default CleaningTaskPhotoHistory;
