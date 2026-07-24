import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Center,
  FileInput,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Radio,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconArrowsExchange, IconCheck, IconClipboardCheck, IconSignature, IconUser, IconUserEdit, IconX } from "@tabler/icons-react";
import dayjs from "dayjs";
import { acknowledgeCerebroPolicy, submitCerebroQuiz } from "../../api/cerebro";
import {
  useCompleteRequiredAction,
  useCompleteRequiredProfileFields,
  useDecideRequiredManagerSwap,
  useMarkRequiredActionPrompted,
  useMyRequiredActions,
  useRespondToRequiredSwap,
  type RequiredActionField,
  type RequiredActionItem,
} from "../../api/requiredActions";
import { CerebroRichTextContent } from "../cerebro/CerebroRichTextContent";
import { compressImageFile } from "../../utils/imageCompression";

const HEADER_FONT_STACK = "'Arial Black', 'Inter', sans-serif";
const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_COMPRESSION_OPTIONS = {
  maxWidth: 1400,
  maxHeight: 1400,
  maxSizeBytes: 900 * 1024,
  quality: 0.84,
  outputMimeType: "image/jpeg" as const,
};

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  const candidate = error as {
    response?: { data?: Array<{ message?: string }> | { message?: string; error?: string } };
    message?: string;
  };
  const data = candidate.response?.data;
  if (Array.isArray(data) && data[0]?.message) {
    return data[0].message;
  }
  if (!Array.isArray(data) && (data?.message || data?.error)) {
    return data.message ?? data.error ?? fallback;
  }
  return candidate.message ?? fallback;
};

const formatDateTime = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY HH:mm") : value;
};

const getPayloadRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const getUserName = (value: unknown, fallback: string): string => {
  const user = getPayloadRecord(value);
  const name = [user.firstName, user.lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return name || fallback;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "U").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
};

const formatRoleLabel = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "Role";
  }
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatShiftTime = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
};

const getSwapAssignmentSummary = (value: unknown) => {
  const assignment = getPayloadRecord(value);
  const shiftInstance = getPayloadRecord(assignment.shiftInstance);
  const shiftType = getPayloadRecord(shiftInstance.shiftType ?? assignment.shiftType);
  const dateValue = typeof assignment.date === "string" ? assignment.date : null;
  const timeStart = typeof assignment.timeStart === "string" ? assignment.timeStart : null;
  const timeEnd = typeof assignment.timeEnd === "string" ? assignment.timeEnd : null;
  const shiftTypeName =
    typeof assignment.shiftTypeName === "string" && assignment.shiftTypeName.trim()
      ? assignment.shiftTypeName
      : typeof shiftType.name === "string" && shiftType.name.trim()
        ? shiftType.name
        : typeof assignment.shiftType === "string" && assignment.shiftType.trim()
          ? assignment.shiftType
          : "Shift";
  return {
    date: dateValue && dayjs(dateValue).isValid() ? dayjs(dateValue).format("ddd, MMM D") : "Unknown date",
    time: [formatShiftTime(timeStart), formatShiftTime(timeEnd)].filter(Boolean).join(" - ") || "Any time",
    shiftTypeName,
    role: formatRoleLabel(assignment.roleInShift),
  };
};

const getActionIcon = (action: RequiredActionItem) => {
  if (action.type === "schedule_swap_partner" || action.type === "schedule_swap_manager") {
    return <IconArrowsExchange size={28} />;
  }
  if (action.type === "profile_fields") {
    return <IconUserEdit size={28} />;
  }
  return <IconClipboardCheck size={28} />;
};

type ESignaturePayload = {
  dataUrl: string;
  signedAt: string;
  userAgent: string;
};

const ESignaturePad = ({
  value,
  onChange,
  error,
}: {
  value: ESignaturePayload | null;
  onChange: (value: ESignaturePayload | null) => void;
  error?: string | null;
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
    if (!drawingRef.current) {
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
    if (!drawingRef.current) {
      return;
    }
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    commitSignature();
  };

  const handleClear = () => {
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
          }}
        />
        <Button variant="subtle" color="gray" size="xs" onClick={handleClear}>
          Clear signature
        </Button>
      </Stack>
    </Card>
  );
};

const ProfileFieldsForm = ({
  action,
  onSubmit,
  loading,
  signatureSlot,
}: {
  action: RequiredActionItem;
  onSubmit: (values: Record<string, string>, profilePhoto?: File | null) => void;
  loading: boolean;
  signatureSlot?: ReactNode;
}) => {
  const fields = useMemo(() => action.payload.fields ?? [], [action.payload.fields]);
  const photoField = useMemo(() => fields.find((field) => field.inputType === "image"), [fields]);
  const textFields = useMemo(() => fields.filter((field) => field.inputType !== "image"), [fields]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [profilePhotoError, setProfilePhotoError] = useState<string | null>(null);

  useEffect(() => {
    setValues(
      textFields.reduce<Record<string, string>>((acc, field) => {
        acc[field.key] = field.currentValue ?? "";
        return acc;
      }, {}),
    );
  }, [textFields]);

  useEffect(
    () => () => {
      if (profilePhotoPreview) {
        URL.revokeObjectURL(profilePhotoPreview);
      }
    },
    [profilePhotoPreview],
  );

  const updateValue = (field: RequiredActionField, value: string) => {
    setValues((current) => ({
      ...current,
      [field.key]: field.inputType === "tel" ? value.replace(/\D/g, "") : value,
    }));
  };

  const handleProfilePhotoChange = (file: File | null) => {
    if (profilePhotoPreview) {
      URL.revokeObjectURL(profilePhotoPreview);
    }

    if (!file) {
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      setProfilePhotoError("Profile photo is required");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      setProfilePhotoError("Upload an image file");
      return;
    }

    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      setProfilePhotoError("Image must be 10 MB or less");
      return;
    }

    setProfilePhotoFile(file);
    setProfilePhotoPreview(URL.createObjectURL(file));
    setProfilePhotoError(null);
  };

  const handleSubmit = async () => {
    if (photoField && !profilePhotoFile) {
      setProfilePhotoError("Profile photo is required");
      return;
    }

    let uploadFile = profilePhotoFile;
    if (uploadFile) {
      try {
        uploadFile = await compressImageFile(uploadFile, PROFILE_PHOTO_COMPRESSION_OPTIONS);
      } catch (compressionError) {
        console.error("Failed to compress profile photo before upload", compressionError);
      }
    }

    onSubmit(values, uploadFile);
  };

  return (
    <Stack gap="md">
      {photoField ? (
        <Card
          withBorder
          radius="lg"
          p="lg"
          style={{
            borderColor: profilePhotoError ? "#ffc9c9" : profilePhotoFile ? "#b7ebc6" : "#d7e6f8",
            background: profilePhotoFile ? "#f6fffb" : "#fbfdff",
          }}
        >
          <Stack gap="md" align="center" ta="center">
            <Avatar
              size={112}
              radius="50%"
              src={profilePhotoPreview ?? undefined}
              style={{
                border: "6px solid #ffffff",
                boxShadow: "0 16px 34px rgba(22, 31, 54, 0.12)",
              }}
            >
              {!profilePhotoPreview ? <IconUser size={40} /> : null}
            </Avatar>
            <Stack gap={2} align="center">
              <Text fw={900} size="lg">
                Profile photo
              </Text>
              <Text size="sm" c={profilePhotoError ? "red.6" : "dimmed"}>
                {profilePhotoError ?? (profilePhotoFile ? "Photo ready to upload." : "Required. Upload a clear profile photo.")}
              </Text>
            </Stack>
            <FileInput
              placeholder="Upload an image"
              accept="image/*"
              value={profilePhotoFile}
              onChange={handleProfilePhotoChange}
              clearable
              required
              style={{ width: "100%", maxWidth: 360 }}
            />
          </Stack>
        </Card>
      ) : null}
      <SimpleFieldGrid>
        {textFields.map((field) =>
          field.inputType === "textarea" ? (
            <Textarea
              key={field.key}
              label={field.label}
              value={values[field.key] ?? ""}
              onChange={(event) => updateValue(field, event.currentTarget.value)}
              autosize
              minRows={3}
              required
              styles={{ label: { width: "100%", textAlign: "center" }, input: { textAlign: "center" } }}
            />
          ) : (
            <TextInput
              key={field.key}
              label={field.label}
              type={field.inputType === "date" ? "date" : "text"}
              inputMode={field.inputType === "tel" ? "numeric" : undefined}
              value={values[field.key] ?? ""}
              onChange={(event) => updateValue(field, event.currentTarget.value)}
              required
              styles={{ label: { width: "100%", textAlign: "center" }, input: { textAlign: "center" } }}
            />
          ),
        )}
      </SimpleFieldGrid>
      {signatureSlot}
      <Button size="lg" fullWidth loading={loading} onClick={handleSubmit}>
        Save and continue
      </Button>
    </Stack>
  );
};

const SimpleFieldGrid = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16,
    }}
  >
    {children}
  </div>
);

const SwapAction = ({
  action,
  onRespond,
  loading,
}: {
  action: RequiredActionItem;
  onRespond: (accept: boolean) => void;
  loading: boolean;
}) => {
  const isManagerDecision = action.type === "schedule_swap_manager";
  const requesterName = getUserName(action.payload.requester, "Teammate");
  const partnerName = getUserName(action.payload.partner, "Teammate");
  const fromAssignment = getSwapAssignmentSummary(action.payload.fromAssignment);
  const toAssignment = getSwapAssignmentSummary(action.payload.toAssignment);

  const renderSwapCard = ({
    label,
    name,
    assignment,
    tone,
  }: {
    label: string;
    name: string;
    assignment: ReturnType<typeof getSwapAssignmentSummary>;
    tone: "offer" | "request";
  }) => {
    const accent = tone === "offer" ? "#2563EB" : "#e90183";
    const borderColor = tone === "offer" ? "#93C5FD" : "#F9A8D4";
    const headerBackground =
      tone === "offer"
        ? "linear-gradient(135deg, rgba(37, 99, 235, 0.16), rgba(147, 197, 253, 0.18))"
        : "linear-gradient(135deg, rgba(233, 1, 131, 0.16), rgba(244, 114, 182, 0.16))";
    const softBackground =
      tone === "offer"
        ? "linear-gradient(180deg, rgba(239, 246, 255, 0.98), rgba(255, 255, 255, 0.98))"
        : "linear-gradient(180deg, rgba(253, 242, 248, 0.98), rgba(255, 255, 255, 0.98))";

    return (
      <Paper
        withBorder
        radius={18}
        style={{
          width: "100%",
          overflow: "hidden",
          border: `2px solid ${borderColor}`,
          background: softBackground,
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
        }}
      >
        <Stack gap={0}>
          <Center
            style={{
              minHeight: 34,
              background: headerBackground,
              borderBottom: `1px solid ${borderColor}`,
            }}
          >
            <Text
              fw={900}
              style={{
                fontFamily: HEADER_FONT_STACK,
                color: accent,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontSize: 12,
              }}
            >
              {label}
            </Text>
          </Center>

          <Stack gap={6} align="center" p={{ base: 7, sm: 9 }}>
            <Group gap={7} justify="center" wrap="nowrap" style={{ width: "100%" }}>
              <Center
                style={{
                  width: 38,
                  height: 38,
                  flex: "0 0 38px",
                  borderRadius: "50%",
                  backgroundColor: "#FFFFFF",
                  border: "2px solid #FFFFFF",
                  outline: `2px solid ${accent}`,
                  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14)",
                }}
              >
                <Text fw={900} size="sm" c={accent} style={{ fontFamily: HEADER_FONT_STACK }}>
                  {getInitials(name)}
                </Text>
              </Center>
              <Stack gap={2} align="center" style={{ minWidth: 0 }}>
                <Text fw={900} size="sm" ta="center" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1.1 }}>
                  {name}
                </Text>
                <Badge variant="light" color={tone === "offer" ? "blue" : "violet"} radius="xl" size="xs">
                  {assignment.role}
                </Badge>
              </Stack>
            </Group>

            <Text
              fw={900}
              ta="center"
              style={{
                fontFamily: HEADER_FONT_STACK,
                color: accent,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              {assignment.shiftTypeName}
            </Text>

            <div
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 7,
              }}
            >
              <BoxInfo label="Date" value={assignment.date} />
              <BoxInfo label="Time" value={assignment.time} />
            </div>
          </Stack>
        </Stack>
      </Paper>
    );
  };

  return (
    <Stack gap="sm" align="center">
      <Stack gap={6} align="center">
        <Title
          order={2}
          ta="center"
          style={{
            fontFamily: HEADER_FONT_STACK,
            fontWeight: 900,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          Swap request
        </Title>
        <Text c="dimmed" ta="center" fw={700}>
          {isManagerDecision
            ? `${requesterName} and ${partnerName} accepted this swap.`
            : `${requesterName} wants to swap shifts with you.`}
        </Text>
      </Stack>

      {renderSwapCard({
        label: isManagerDecision ? "Requester offers" : "They offer",
        name: requesterName,
        assignment: fromAssignment,
        tone: "offer",
      })}

      <Center
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          backgroundColor: "#111827",
          color: "#FFFFFF",
          boxShadow: "0 12px 22px rgba(15, 23, 42, 0.18)",
        }}
      >
        <IconArrowsExchange size={19} />
      </Center>

      {renderSwapCard({
        label: isManagerDecision ? "Teammate gives" : "You give",
        name: isManagerDecision ? partnerName : "You",
        assignment: toAssignment,
        tone: "request",
      })}

      <Alert color="blue" radius="md" variant="light" w="100%">
        <Text size="sm" fw={900} ta="center" style={{ fontFamily: HEADER_FONT_STACK }}>
          {isManagerDecision ? "Approve to update the schedule." : "Manager will receive the request."}
        </Text>
      </Alert>

      <Group grow>
        <Button color="red" size="lg" leftSection={<IconX size={18} />} loading={loading} onClick={() => onRespond(false)}>
          {isManagerDecision ? "Decline swap" : "Decline"}
        </Button>
        <Button color="green" size="lg" leftSection={<IconCheck size={18} />} loading={loading} onClick={() => onRespond(true)}>
          {isManagerDecision ? "Approve swap" : "Accept"}
        </Button>
      </Group>
    </Stack>
  );
};

const BoxInfo = ({ label, value }: { label: string; value: string }) => (
  <Paper
    withBorder
    radius={14}
    p={7}
    style={{
      backgroundColor: "#FFFFFF",
      textAlign: "center",
    }}
  >
    <Text size="xs" fw={900} c="dimmed" tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
      {label}
    </Text>
    <Text fw={900} size="md" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1.15 }}>
      {value}
    </Text>
  </Paper>
);

const GenericAction = ({
  action,
  onComplete,
  loading,
  signatureSlot,
}: {
  action: RequiredActionItem;
  onComplete: () => void;
  loading: boolean;
  signatureSlot?: ReactNode;
}) => (
  <Stack gap="lg">
    {action.body ? (
      <Paper withBorder radius="md" p="lg">
        <Text ta="center" style={{ whiteSpace: "pre-wrap" }}>
          {action.body}
        </Text>
      </Paper>
    ) : null}
    {signatureSlot}
    <Button size="lg" fullWidth loading={loading} onClick={onComplete}>
      {action.type === "policy_consent" ? "I agree" : "Mark complete"}
    </Button>
  </Stack>
);

const PolicyAction = ({
  action,
  onAccept,
  loading,
  signatureSlot,
}: {
  action: RequiredActionItem;
  onAccept: () => void;
  loading: boolean;
  signatureSlot?: ReactNode;
}) => {
  const entry = action.payload.cerebroEntry;
  if (!entry) {
    return <GenericAction action={action} onComplete={onAccept} loading={loading} signatureSlot={signatureSlot} />;
  }

  return (
    <Stack gap="lg">
      <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
        <Stack gap="md">
          <Group justify="center" gap="xs">
            <Badge variant="light">Version {entry.policyVersion ?? "current"}</Badge>
            {entry.estimatedReadMinutes ? <Badge variant="light">{entry.estimatedReadMinutes} min read</Badge> : null}
          </Group>
          <CerebroRichTextContent value={entry.body} />
        </Stack>
      </Paper>
      {signatureSlot}
      <Button size="lg" fullWidth loading={loading} onClick={onAccept}>
        I agree
      </Button>
    </Stack>
  );
};

const QuizAction = ({
  action,
  onSubmit,
  loading,
  resultText,
  signatureSlot,
}: {
  action: RequiredActionItem;
  onSubmit: (answers: Record<string, string>) => void;
  loading: boolean;
  resultText: string | null;
  signatureSlot?: ReactNode;
}) => {
  const quiz = action.payload.cerebroQuiz;
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setAnswers({});
  }, [quiz?.id]);

  if (!quiz) {
    return <GenericAction action={action} onComplete={() => onSubmit({})} loading={loading} signatureSlot={signatureSlot} />;
  }

  const complete = quiz.questions.every((question) => Boolean(answers[question.id]));

  return (
    <Stack gap="md">
      <Group justify="center" gap="xs">
        <Badge variant="light">Pass {quiz.passingScore}%</Badge>
        <Badge variant="light">{quiz.questions.length} questions</Badge>
      </Group>
      {quiz.description ? (
        <Text c="dimmed" ta="center">
          {quiz.description}
        </Text>
      ) : null}
      {quiz.questions.map((question, index) => (
        <Paper key={question.id} withBorder radius="md" p="md">
          <Stack gap="sm">
            <Text fw={700} ta="center">
              {index + 1}. {question.prompt}
            </Text>
            <Radio.Group
              value={answers[question.id] ?? ""}
              onChange={(value) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: value,
                }))
              }
            >
              <Stack gap="xs" align="center">
                {question.options.map((option) => (
                  <Radio key={option.id} value={option.id} label={option.label} />
                ))}
              </Stack>
            </Radio.Group>
          </Stack>
        </Paper>
      ))}
      {resultText ? (
        <Alert color="orange" icon={<IconAlertCircle size={16} />}>
          {resultText}
        </Alert>
      ) : null}
      {signatureSlot}
      <Button size="lg" fullWidth loading={loading} disabled={!complete} onClick={() => onSubmit(answers)}>
        Submit quiz
      </Button>
    </Stack>
  );
};

export const RequiredActionsOverlay = ({ enabled }: { enabled: boolean }) => {
  const actionsQuery = useMyRequiredActions(enabled);
  const queryClient = useQueryClient();
  const completeAction = useCompleteRequiredAction();
  const completeProfileFields = useCompleteRequiredProfileFields();
  const markPrompted = useMarkRequiredActionPrompted();
  const promptedActionIdsRef = useRef<Set<string>>(new Set());
  const respondToSwap = useRespondToRequiredSwap();
  const decideManagerSwap = useDecideRequiredManagerSwap();
  const [error, setError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<string | null>(null);
  const [cerebroSubmitting, setCerebroSubmitting] = useState(false);
  const [signature, setSignature] = useState<ESignaturePayload | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);

  const actions = actionsQuery.data?.actions ?? [];
  const action = actions[0] ?? null;
  const requiresSignature = Boolean(action?.source === "required_action" && action.requiresSignature);
  const isBusy =
    completeAction.isPending ||
    completeProfileFields.isPending ||
    respondToSwap.isPending ||
    decideManagerSwap.isPending ||
    cerebroSubmitting ||
    actionsQuery.isFetching;
  const progress = actions.length > 0 ? ((actionsQuery.data?.summary.total ?? actions.length) - actions.length + 1) / (actionsQuery.data?.summary.total ?? actions.length) : 0;

  useEffect(() => {
    setError(null);
    setQuizResult(null);
    setSignature(null);
    setSignatureError(null);
  }, [action?.id]);

  useEffect(() => {
    if (!enabled || !action || action.source !== "required_action") {
      return;
    }
    if (promptedActionIdsRef.current.has(action.id)) {
      return;
    }
    promptedActionIdsRef.current.add(action.id);
    markPrompted.mutate({ actionId: action.recordId });
  }, [action, enabled, markPrompted]);

  const getSignatureForSubmit = (): ESignaturePayload | null | undefined => {
    if (!requiresSignature) {
      return null;
    }
    if (!signature) {
      setSignatureError("Draw your signature before completing this request.");
      return undefined;
    }
    setSignatureError(null);
    return signature;
  };

  const signatureSlot = requiresSignature ? (
    <ESignaturePad
      value={signature}
      onChange={(nextSignature) => {
        setSignature(nextSignature);
        if (nextSignature) {
          setSignatureError(null);
        }
      }}
      error={signatureError}
    />
  ) : null;

  const handleComplete = async () => {
    if (!action || action.source !== "required_action") {
      return;
    }
    const eSignature = getSignatureForSubmit();
    if (eSignature === undefined) {
      return;
    }
    setError(null);
    try {
      await completeAction.mutateAsync({
        actionId: action.recordId,
        response: {
          acknowledgedAt: new Date().toISOString(),
          ...(eSignature ? { eSignature } : {}),
        },
      });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to complete this required action"));
    }
  };

  const handleProfileSubmit = async (values: Record<string, string>, profilePhoto?: File | null) => {
    if (!action || action.type !== "profile_fields") {
      return;
    }
    const eSignature = getSignatureForSubmit();
    if (eSignature === undefined) {
      return;
    }
    setError(null);
    try {
      await completeProfileFields.mutateAsync({ actionId: action.recordId, values, profilePhoto, signature: eSignature });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to save your details"));
    }
  };

  const handleSwapResponse = async (accept: boolean) => {
    if (!action || (action.type !== "schedule_swap_partner" && action.type !== "schedule_swap_manager")) {
      return;
    }
    setError(null);
    try {
      if (action.type === "schedule_swap_manager") {
        await decideManagerSwap.mutateAsync({ swapId: action.recordId, approve: accept });
      } else {
        await respondToSwap.mutateAsync({ swapId: action.recordId, accept });
      }
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to update the swap request"));
    }
  };

  const handlePolicyAccept = async () => {
    const entryId = action?.payload.cerebroEntry?.id;
    if (!entryId) {
      await handleComplete();
      return;
    }
    const eSignature = getSignatureForSubmit();
    if (eSignature === undefined) {
      return;
    }
    setError(null);
    try {
      setCerebroSubmitting(true);
      await acknowledgeCerebroPolicy(entryId);
      if (action?.source === "required_action") {
        await completeAction.mutateAsync({
          actionId: action.recordId,
          response: {
            selectedAction: "accepted_policy",
            cerebroEntryId: entryId,
            acceptedAt: new Date().toISOString(),
            ...(eSignature ? { eSignature } : {}),
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to accept this policy"));
    } finally {
      setCerebroSubmitting(false);
    }
  };

  const handleQuizSubmit = async (answers: Record<string, string>) => {
    const quizId = action?.payload.cerebroQuiz?.id;
    if (!quizId) {
      return;
    }
    const eSignature = getSignatureForSubmit();
    if (eSignature === undefined) {
      return;
    }
    setError(null);
    setQuizResult(null);
    try {
      setCerebroSubmitting(true);
      const result = await submitCerebroQuiz(quizId, answers);
      if (!result.passed) {
        setQuizResult(`You scored ${result.scorePercent.toFixed(0)}%. You need ${action.payload.cerebroQuiz?.passingScore ?? 80}% to continue.`);
        return;
      }
      if (action?.source === "required_action") {
        await completeAction.mutateAsync({
          actionId: action.recordId,
          response: {
            selectedAction: "submitted_quiz",
            cerebroQuizId: quizId,
            answers,
            scorePercent: result.scorePercent,
            passed: result.passed,
            submittedAt: new Date().toISOString(),
            ...(eSignature ? { eSignature } : {}),
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to submit this quiz"));
    } finally {
      setCerebroSubmitting(false);
    }
  };

  const isSwapAction = action?.type === "schedule_swap_partner" || action?.type === "schedule_swap_manager";

  return (
    <Modal
      opened={enabled && actions.length > 0}
      onClose={() => undefined}
      fullScreen
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      trapFocus
      zIndex={5000}
      padding={0}
      styles={{
        content: { background: "#f4f4f7" },
        body: { minHeight: "100dvh" },
      }}
    >
      <Center mih="100dvh" p={{ base: "md", sm: "xl" }}>
        <Card
          withBorder={!isSwapAction}
          radius={isSwapAction ? 0 : "lg"}
          shadow={isSwapAction ? undefined : "xl"}
          p={isSwapAction ? 0 : { base: "lg", sm: "xl" }}
          w="100%"
          maw={isSwapAction ? 420 : 760}
          style={{
            background: isSwapAction ? "transparent" : undefined,
            border: isSwapAction ? 0 : undefined,
          }}
        >
          {!action ? (
            <Center py="xl">
              <Loader variant="dots" />
            </Center>
          ) : (
            <Stack gap="lg" align="stretch">
              {action.type === "schedule_swap_partner" || action.type === "schedule_swap_manager" ? null : (
                <Stack gap="sm" align="center">
                  <ThemeIcon size={64} radius="xl" color="blue" variant="light">
                    {getActionIcon(action)}
                  </ThemeIcon>
                  <Badge color="red" variant="light" size="lg">
                    Action required
                  </Badge>
                  <Title order={2} ta="center">
                    {action.title}
                  </Title>
                  {action.body && action.type !== "broadcast" && action.type !== "policy_consent" ? (
                    <Text c="dimmed" ta="center">
                      {action.body}
                    </Text>
                  ) : null}
                  {action.dueAt ? (
                    <Text size="sm" c="dimmed" ta="center">
                      Due {formatDateTime(action.dueAt)}
                    </Text>
                  ) : null}
                </Stack>
              )}

              {actions.length > 1 ? (
                <Stack gap={6}>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Pending items
                    </Text>
                    <Text size="sm" fw={700}>
                      {actions.length} left
                    </Text>
                  </Group>
                  <Progress value={Math.min(Math.max(progress * 100, 0), 100)} radius="xl" />
                </Stack>
              ) : null}

              {error ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />}>
                  {error}
                </Alert>
              ) : null}

              {action.type === "schedule_swap_partner" || action.type === "schedule_swap_manager" ? (
                <SwapAction action={action} onRespond={handleSwapResponse} loading={isBusy} />
              ) : action.type === "profile_fields" ? (
                <ProfileFieldsForm action={action} onSubmit={handleProfileSubmit} loading={isBusy} signatureSlot={signatureSlot} />
              ) : action.type === "policy_consent" ? (
                <PolicyAction action={action} onAccept={handlePolicyAccept} loading={isBusy} signatureSlot={signatureSlot} />
              ) : action.type === "quiz" ? (
                <QuizAction action={action} onSubmit={handleQuizSubmit} loading={isBusy} resultText={quizResult} signatureSlot={signatureSlot} />
              ) : (
                <GenericAction action={action} onComplete={handleComplete} loading={isBusy} signatureSlot={signatureSlot} />
              )}

              {actionsQuery.isFetching ? (
                <Text size="xs" c="dimmed" ta="center">
                  Syncing required actions...
                </Text>
              ) : null}
            </Stack>
          )}
        </Card>
      </Center>
    </Modal>
  );
};

export default RequiredActionsOverlay;
