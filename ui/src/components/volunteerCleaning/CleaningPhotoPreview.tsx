import { Alert, Button, Image, Loader, Stack } from "@mantine/core";
import { useEffect, useState } from "react";
import { fetchCleaningPhoto } from "../../api/volunteerCleaning";

export const LocalCleaningPhotoPreview = ({ file, label }: { file: File; label: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url ? <Image src={url} alt={`Selected ${label}`} mah={300} fit="contain" radius="md" /> : null;
};

const CleaningPhotoPreview = ({ submissionId, photoId, label }: { submissionId: number; photoId: number; label: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setUrl(null);
    setFailed(false);
    void fetchCleaningPhoto(submissionId, photoId, controller.signal).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [submissionId, photoId, attempt]);
  if (failed) return <Alert color="red">Unable to load this photo. <Button variant="subtle" size="xs" onClick={() => setAttempt((value) => value + 1)}>Retry photo</Button></Alert>;
  return <Stack align="center">{url ? <Image src={url} alt={label} mah={420} fit="contain" radius="md" /> : <Loader size="sm" aria-label={`Loading ${label}`} />}</Stack>;
};

export default CleaningPhotoPreview;
