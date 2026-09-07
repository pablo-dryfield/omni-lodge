import { Alert, Badge, Button, FileButton, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconCamera, IconPhoto } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { getCleaningError, useUploadCleaningPhoto, type CleaningPhotoStatus, type CleaningSubmission } from "../../api/volunteerCleaning";
import { compressImageFile } from "../../utils/imageCompression";
import CleaningPhotoPreview, { LocalCleaningPhotoPreview } from "./CleaningPhotoPreview";

export const cleaningStatus: Record<CleaningPhotoStatus, { label: string; color: string }> = {
  missing: { label: "Photo needed", color: "gray" },
  pending: { label: "Awaiting review", color: "blue" },
  approved: { label: "Approved", color: "teal" },
  rejected: { label: "Retake needed", color: "red" },
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

const CleaningSubmissionForm = ({ submission }: { submission: CleaningSubmission }) => {
  const [snapshot, setSnapshot] = useState(submission);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const sendingRef = useRef(false);
  const upload = useUploadCleaningPhoto(submission.userId);
  const hasFiles = Object.keys(files).length > 0;
  useEffect(() => {
    if (!sending) setSnapshot((current) => submission.revision >= current.revision ? submission : current);
  }, [submission, sending]);
  useEffect(() => {
    setFiles((current) => Object.fromEntries(Object.entries(current).filter(([key]) =>
      snapshot.canUpload && snapshot.slots.some((slot) => slot.key === key && ["missing", "rejected"].includes(slot.status)),
    )));
  }, [snapshot]);

  const selectFile = async (key: string, file: File | null) => {
    if (!file) return;
    setMessage(null);
    if (!ALLOWED_PHOTO_TYPES.has(file.type) && !["image/heic", "image/heif"].includes(file.type)) {
      setError("Choose a JPEG, PNG, WebP, or HEIC photo.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Each photo must be 10 MB or smaller.");
      return;
    }
    setError(null);
    setPreparing(true);
    try {
      const prepared = await compressImageFile(file, {
        maxWidth: 2200, maxHeight: 2200, maxSizeBytes: 2 * 1024 * 1024,
        outputMimeType: "image/jpeg", quality: 0.9,
      });
      if (!ALLOWED_PHOTO_TYPES.has(prepared.type)) throw new Error("unsupported-image");
      setFiles((current) => ({ ...current, [key]: prepared }));
    } catch {
      setError("Unable to prepare this photo. Try another image or save it as JPEG first.");
    } finally { setPreparing(false); }
  };

  const send = async () => {
    if (sendingRef.current || preparing || !snapshot.canUpload) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    setMessage(null);
    let current = snapshot;
    let uploaded = 0;
    try {
      for (const slot of snapshot.slots) {
        const file = files[slot.key];
        if (!file || !["missing", "rejected"].includes(slot.status)) continue;
        const result = await upload.mutateAsync({ submissionId: current.id, slotKey: slot.key, expectedRevision: current.revision, file });
        current = result.submission;
        setSnapshot(current);
        setFiles((selected) => {
          const next = { ...selected };
          delete next[slot.key];
          return next;
        });
        uploaded += 1;
      }
      if (uploaded) setMessage("Photos sent for manager review. Your task completes when every required photo is approved.");
    } catch (sendError) {
      setError(getCleaningError(sendError, "Unable to send this photo. Any photos already sent remain saved; the remaining selections are kept."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return <Stack gap="md">
    <Text size="sm" c="dimmed">{snapshot.taskDate} · {snapshot.shiftName}</Text>
    <Text size="sm">Add a clear photo for each item. Approved photos are kept; only missing or rejected photos can be uploaded.</Text>
    {snapshot.reviewerMissing ? <Alert color="yellow">No on-shift reviewer is available. Your photos will go to the management review queue.</Alert> : null}
    {!snapshot.canUpload && snapshot.status !== "approved" ? <Alert color="yellow">Photo uploads are not available for this assignment. Ask your manager to check the shift.</Alert> : null}
    {error ? <Alert color="red">{error}</Alert> : null}
    {message ? <Alert color="teal">{message}</Alert> : null}
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      {snapshot.slots.map((slot) => {
        const selected = files[slot.key];
        const editable = snapshot.canUpload && (slot.status === "missing" || slot.status === "rejected");
        return <Paper key={slot.key} withBorder radius="md" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start"><Title order={3} size="h5">{slot.label}</Title><Badge color={cleaningStatus[slot.status].color}>{cleaningStatus[slot.status].label}</Badge></Group>
            {slot.currentVersion?.rejectionReason && slot.status === "rejected" ? <Alert color="red">{slot.currentVersion.rejectionReason}</Alert> : null}
            {selected ? <LocalCleaningPhotoPreview file={selected} label={slot.label} /> : slot.currentVersion ? <CleaningPhotoPreview submissionId={snapshot.id} photoId={slot.currentVersion.id} label={slot.label} /> : null}
            {slot.currentVersion?.reviewerName && slot.status === "approved" ? <Text size="xs" c="dimmed">Approved by {slot.currentVersion.reviewerName}</Text> : null}
            {editable ? <>
              <Group gap="xs" grow>
                <FileButton accept={PHOTO_ACCEPT} capture="environment" inputProps={{ "aria-label": `Camera photo for ${slot.label}` }} onChange={(file) => void selectFile(slot.key, file)}>
                  {(props) => <Button {...props} size="xs" variant="light" leftSection={<IconCamera size={16} />} disabled={sending || preparing} aria-label={`Take photo for ${slot.label}`}>Camera</Button>}
                </FileButton>
                <FileButton accept={PHOTO_ACCEPT} inputProps={{ "aria-label": `Upload ${slot.label} photo` }} onChange={(file) => void selectFile(slot.key, file)}>
                  {(props) => <Button {...props} size="xs" variant="default" leftSection={<IconPhoto size={16} />} disabled={sending || preparing} aria-label={`Choose photo for ${slot.label}`}>Choose photo</Button>}
                </FileButton>
              </Group>
              {selected ? <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>{selected.name} · Ready to send</Text> : null}
            </> : null}
          </Stack>
        </Paper>;
      })}
    </SimpleGrid>
    <Text size="xs" c="dimmed">JPEG, PNG, WebP or HEIC, up to 10 MB per photo.</Text>
    {snapshot.slots.length > 0 && snapshot.slots.every((slot) => slot.status === "approved") ? <Alert color="teal">Your required photos are approved. The planner task completes once everyone's photos are approved.</Alert>
      : <Button fullWidth onClick={() => void send()} loading={sending || preparing} disabled={!hasFiles || !snapshot.canUpload}>{preparing ? "Preparing photo" : "Send photos for review"}</Button>}
  </Stack>;
};

export default CleaningSubmissionForm;
