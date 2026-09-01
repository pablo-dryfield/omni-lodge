import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCamera,
  IconCheck,
  IconPhoto,
  IconSignature,
  IconUpload,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { StaffPayoutReceiptPayload } from "../../api/requiredActions";
import { compressImageFile } from "../../utils/imageCompression";
import {
  formatPayoutReceiptAmount,
  normalizeStaffPayoutReceipt,
} from "./staffPayoutReceiptUtils";

const PAYOUT_RECEIPT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PAYOUT_RECEIPT_PHOTO_COMPRESSION_OPTIONS = {
  maxWidth: 1600,
  maxHeight: 1600,
  maxSizeBytes: 900 * 1024,
  quality: 0.84,
  force: true,
  outputMimeType: "image/jpeg" as const,
};

const formatDate = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : value;
};

const SimpleFieldGrid = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16,
      width: "100%",
    }}
  >
    {children}
  </div>
);

export type ESignaturePayload = {
  dataUrl: string;
  signedAt: string;
  userAgent: string;
};

export const ESignaturePad = ({
  value,
  onChange,
  error,
  disabled = false,
}: {
  value: ESignaturePayload | null;
  onChange: (value: ESignaturePayload | null) => void;
  error?: string | null;
  disabled?: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(280, Math.floor(rect.width));
    const height = 180;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";

    if (value?.dataUrl) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, width, height);
      };
      image.src = value.dataUrl;
    }
  }, [value?.dataUrl]);

  const getPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const commitSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    onChange({
      dataUrl: canvas.toDataURL("image/png"),
      signedAt: new Date().toISOString(),
      userAgent: window.navigator.userAgent,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) {
      return;
    }
    const point = getPoint(event);
    const canvas = canvasRef.current;
    if (!point || !canvas) {
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.beginPath();
    context.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
    context.fillStyle = "#111827";
    context.fill();
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) {
      return;
    }
    const point = getPoint(event);
    const previous = lastPointRef.current;
    const context = canvasRef.current?.getContext("2d");
    if (!point || !previous || !context) {
      return;
    }
    event.preventDefault();
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) {
      return;
    }
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    commitSignature();
  };

  const handleClear = () => {
    if (disabled) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      onChange(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    onChange(null);
  };

  return (
    <Card withBorder radius="lg" p="md" style={{ borderColor: error ? "#ffc9c9" : value ? "#b7ebc6" : "#d7e6f8" }}>
      <Stack gap="sm" align="center">
        <Group gap="xs" justify="center">
          <ThemeIcon radius="xl" variant="light" color="grape">
            <IconSignature size={18} />
          </ThemeIcon>
          <Text fw={900}>E-signature required</Text>
        </Group>
        <Text size="sm" c={error ? "red.6" : "dimmed"} ta="center">
          {error ?? (value ? "Signature captured." : "Draw your signature below to complete this request.")}
        </Text>
        <canvas
          ref={canvasRef}
          aria-label="Draw your signature"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            width: "100%",
            maxWidth: 620,
            border: "1px solid #d7e0ea",
            borderRadius: 12,
            background: "#ffffff",
            touchAction: "none",
            boxShadow: "inset 0 1px 4px rgba(15, 23, 42, 0.08)",
            opacity: disabled ? 0.6 : 1,
          }}
        />
        <Button variant="subtle" color="gray" size="xs" onClick={handleClear} disabled={disabled}>
          Clear signature
        </Button>
      </Stack>
    </Card>
  );
};

export const StaffPayoutReceiptConfirmation = ({
  receipt: receiptPayload,
  onConfirm,
  loading,
  signatureSlot,
}: {
  receipt?: StaffPayoutReceiptPayload;
  onConfirm: (photo: File) => Promise<void>;
  loading: boolean;
  signatureSlot?: ReactNode;
}) => {
  const receipt = normalizeStaffPayoutReceipt(receiptPayload);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const submissionInFlightRef = useRef(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);

  useEffect(() => {
    setPhoto(null);
    setPhotoError(null);
    setAccepted(false);
    setAcceptanceError(null);
  }, [receipt?.id]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return undefined;
    }
    const nextPreview = URL.createObjectURL(photo);
    setPhotoPreview(nextPreview);
    return () => URL.revokeObjectURL(nextPreview);
  }, [photo]);

  const selectPhoto = (file: File | null) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPhoto(null);
      setPhotoError("Choose an image file.");
      return;
    }
    if (file.size > PAYOUT_RECEIPT_PHOTO_MAX_BYTES) {
      setPhoto(null);
      setPhotoError("The photo must be 10 MB or less.");
      return;
    }
    setPhoto(file);
    setPhotoError(null);
  };

  const handleSubmit = async () => {
    if (submissionInFlightRef.current) {
      return;
    }
    if (!photo) {
      setPhotoError("Take or upload a photo before confirming the payment.");
    }
    if (!accepted) {
      setAcceptanceError("Confirm that you received the displayed amount.");
    }
    if (!receipt || !photo || !accepted) {
      return;
    }

    submissionInFlightRef.current = true;
    setPreparingPhoto(true);
    try {
      let preparedPhoto = photo;
      try {
        preparedPhoto = await compressImageFile(photo, PAYOUT_RECEIPT_PHOTO_COMPRESSION_OPTIONS);
      } catch (compressionError) {
        console.error("Failed to compress payout receipt photo before upload", compressionError);
      }
      await onConfirm(preparedPhoto);
    } finally {
      submissionInFlightRef.current = false;
      setPreparingPhoto(false);
    }
  };

  if (!receipt) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        This payment confirmation is missing its receipt details. Ask a manager to recreate the request.
      </Alert>
    );
  }

  const amountLabel = formatPayoutReceiptAmount(receipt);
  const payoutDateLabel = formatDate(receipt.payoutDate);
  const rangeStartLabel = formatDate(receipt.rangeStart);
  const rangeEndLabel = formatDate(receipt.rangeEnd);
  const periodLabel =
    rangeStartLabel && rangeEndLabel
      ? rangeStartLabel === rangeEndLabel
        ? rangeStartLabel
        : `${rangeStartLabel} - ${rangeEndLabel}`
      : "Not specified";
  const immutableAcceptanceText =
    typeof receipt.acceptanceText === "string" ? receipt.acceptanceText.trim() : "";
  const confirmationStatement =
    immutableAcceptanceText ||
    (payoutDateLabel
      ? `I confirm that I received ${amountLabel} on ${payoutDateLabel}.`
      : `I confirm that I received ${amountLabel}.`);

  return (
    <Stack gap="lg">
      <Card
        withBorder
        radius="lg"
        p="lg"
        style={{
          borderColor: "var(--mantine-color-blue-3)",
          background: "linear-gradient(145deg, var(--mantine-color-blue-0), var(--mantine-color-white))",
        }}
      >
        <Stack gap="md" align="center" ta="center">
          <Text size="xs" fw={800} tt="uppercase" c="blue.7">
            Amount received
          </Text>
          <Title order={1} c="blue.9" style={{ fontSize: "clamp(2rem, 8vw, 3.5rem)" }}>
            {amountLabel}
          </Title>
          <SimpleFieldGrid>
            <Stack gap={2} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Payment date
              </Text>
              <Text fw={700}>{payoutDateLabel ?? "Not specified"}</Text>
            </Stack>
            <Stack gap={2} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Earnings period
              </Text>
              <Text fw={700}>{periodLabel}</Text>
            </Stack>
          </SimpleFieldGrid>
          {receipt.paidByName ? (
            <Text size="sm" c="dimmed">
              Payment recorded by {receipt.paidByName}
            </Text>
          ) : null}
        </Stack>
      </Card>

      <Card
        withBorder
        radius="lg"
        p="md"
        style={{ borderColor: photoError ? "var(--mantine-color-red-4)" : photo ? "var(--mantine-color-green-4)" : undefined }}
      >
        <Stack gap="md" align="center" ta="center">
          <Group gap="xs" justify="center">
            <ThemeIcon radius="xl" variant="light" color={photo ? "green" : "blue"}>
              {photo ? <IconCheck size={18} /> : <IconPhoto size={18} />}
            </ThemeIcon>
            <Text fw={900}>Photo evidence required</Text>
          </Group>
          <Text size="sm" c={photoError ? "red.6" : "dimmed"}>
            {photoError ?? (photo ? "Photo ready to submit." : "Take a clear photo that confirms the cash or payment was received.")}
          </Text>

          {photoPreview ? (
            <Box
              w="100%"
              maw={520}
              style={{
                overflow: "hidden",
                borderRadius: 14,
                border: "1px solid var(--mantine-color-gray-3)",
                background: "var(--mantine-color-gray-0)",
              }}
            >
              <img
                src={photoPreview}
                alt="Payment receipt evidence preview"
                style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain" }}
              />
            </Box>
          ) : null}

          <Group grow w="100%" maw={520} gap="sm" wrap="wrap">
            <Button
              leftSection={<IconCamera size={18} />}
              onClick={() => cameraInputRef.current?.click()}
              disabled={loading || preparingPhoto}
              style={{ minWidth: 160 }}
            >
              {photo ? "Retake photo" : "Take photo"}
            </Button>
            <Button
              variant="default"
              leftSection={<IconUpload size={18} />}
              onClick={() => uploadInputRef.current?.click()}
              disabled={loading || preparingPhoto}
              style={{ minWidth: 160 }}
            >
              {photo ? "Choose another" : "Upload photo"}
            </Button>
          </Group>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              selectPhoto(event.currentTarget.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              selectPhoto(event.currentTarget.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </Stack>
      </Card>

      <Divider label="Confirmation" labelPosition="center" />
      <Checkbox
        checked={accepted}
        onChange={(event) => {
          const nextAccepted = event.currentTarget.checked;
          setAccepted(nextAccepted);
          if (nextAccepted) {
            setAcceptanceError(null);
          }
        }}
        color="green"
        size="md"
        label={confirmationStatement}
        error={acceptanceError}
        styles={{
          root: {
            padding: 16,
            border: `1px solid ${acceptanceError ? "var(--mantine-color-red-4)" : accepted ? "var(--mantine-color-green-4)" : "var(--mantine-color-gray-3)"}`,
            borderRadius: 12,
            background: accepted ? "var(--mantine-color-green-0)" : "var(--mantine-color-white)",
          },
          label: { fontWeight: 700, lineHeight: 1.45 },
        }}
      />
      {signatureSlot}
      <Button
        size="lg"
        fullWidth
        color="green"
        leftSection={<IconCheck size={20} />}
        loading={loading || preparingPhoto}
        onClick={() => void handleSubmit()}
      >
        Confirm payment received
      </Button>
      <Text size="xs" c="dimmed" ta="center">
        Your photo, signature, account identity, and confirmation time will be saved as payment evidence.
      </Text>
    </Stack>
  );
};
