import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type PromotionCoordinate = {
  latitude: number;
  longitude: number;
};

export type PromotionRoutePoint = PromotionCoordinate & {
  id: string;
  label: string;
  radiusMeters: number;
};

export type PromotionCheckpoint = {
  id: string;
  sequence: number;
  phase: "STREET" | "HOSTEL";
  label: string;
  instruction: string;
  requiredDwellSeconds: number;
  point: PromotionRoutePoint;
};

export type PromotionHostelRoute = {
  hostelName: string;
  hostelVenueId: string | null;
  finishLabel: string;
  finish: PromotionRoutePoint;
  polyline: PromotionCoordinate[];
};

export type PromotionRoutePolicy = {
  maxHorizontalAccuracyMeters: number;
  startDwellSeconds: number;
  checkpointDwellSeconds: number;
  finishDwellSeconds: number;
  consecutiveFixesRequired: number;
  reminderOffsetsMinutes: number[];
  preShiftCheckInWindowMinutes: number;
  streetExpectedDurationMinutes: number;
  hostelExpectedDurationMinutes: number;
  minimumStreetDurationMinutes?: number | null;
  minimumHostelDurationMinutes?: number | null;
  requiredParticipantProof?: "self" | "all_assigned";
  participantProofMaxAgeSeconds?: number;
  participantProofMaxDistanceMeters?: number;
};

export type PromotionRouteVersion = {
  routeVersionId: string;
  routePlanId: string;
  versionNumber: number;
  status: string;
  publishedAtUtc: string;
  routeName: string;
  hostelName: string;
  start: PromotionRoutePoint;
  streetPolyline: PromotionCoordinate[];
  streetCheckpoints: PromotionCheckpoint[];
  hostelPolyline: PromotionCoordinate[];
  hostelCheckpoints: PromotionCheckpoint[];
  hostelRoutes: PromotionHostelRoute[];
  finish: PromotionRoutePoint;
  policy: PromotionRoutePolicy;
};

export type PromotionRoutePlan = {
  routePlanId: string;
  name: string;
  description: string | null;
  status: string;
  routeVersions: PromotionRouteVersion[];
  createdAtUtc: string | null;
  updatedAtUtc: string | null;
};

export type PromotionRoutePlansResponse = {
  defaultHostels: string[];
  routePlans: PromotionRoutePlan[];
};

export type PromotionTeamAssignment = {
  teamAssignmentId: string;
  shiftInstanceId: string;
  shiftAssignmentId: string | null;
  routeVersionId: string;
  routeName: string | null;
  versionNumber: number | null;
  routeStatus: string | null;
  hostelVenueId: string | null;
  hostelLabel: string | null;
  teamKey: string;
  notes: string | null;
  createdAtUtc: string | null;
  updatedAtUtc: string | null;
};

export type PromotionTeamAssignmentsResponse = {
  teamAssignments: PromotionTeamAssignment[];
};

export type PromotionLifecycle = "NOT_STARTED" | "STREET_ACTIVE" | "HOSTEL_ACTIVE" | "COMPLETED" | "ABORTED";
export type PromotionPhase = "STREET" | "HOSTEL";
export type PromotionVerificationQuality = "VERIFIED" | "DEGRADED" | "REVIEW_REQUIRED";

export type PromotionSessionParticipant = {
  participantId: string;
  assignmentId: string;
  displayName: string;
  profilePhotoUrl: string | null;
  isCurrentUser: boolean;
  proofStatus: string;
  lastProofAtUtc: string | null;
  lastHeartbeatAtUtc: string | null;
  quality?: PromotionVerificationQuality;
  verificationQuality?: PromotionVerificationQuality;
};

export type PromotionSessionSnapshot = {
  sessionId: string;
  participantSessionId: string;
  lifecycle: PromotionLifecycle;
  phase: PromotionPhase | null;
  expectedSessionVersion: number;
  routeVersionId: string;
  assignmentId: string;
  streetStartedAtUtc: string | null;
  streetCompletedAtUtc: string | null;
  hostelStartedAtUtc: string | null;
  completedAtUtc: string | null;
  abortedAtUtc: string | null;
  nextCheckpointId: string | null;
  nextCheckpointLabel: string | null;
  completedCheckpointIds: string[];
  quality?: PromotionVerificationQuality;
  verificationQuality?: PromotionVerificationQuality;
  participants: PromotionSessionParticipant[];
  serverMessage: string | null;
};

export type PromotionManagerSessionsResponse = {
  sessions: PromotionSessionSnapshot[];
};

export type PromotionPlaybackSample = PromotionCoordinate & {
  eventId: string;
  participantSessionId: string;
  capturedAtUtc: string;
  sequence: string;
  horizontalAccuracyMeters: number;
  phase: PromotionPhase | null;
  mockLocationSignal: boolean | null;
  reviewFlags: string[];
};

export type PromotionPlaybackCheckpointVisit = {
  checkpointVisitId: string;
  checkpointId: string;
  label: string;
  phase: PromotionPhase | null;
  sequence: number;
  acceptedAtUtc: string;
  dwellSeconds: number;
  distanceMeters: number | null;
  reviewFlags: string[];
};

export type PromotionSessionPlaybackResponse = {
  session: PromotionSessionSnapshot;
  routeVersion: PromotionRouteVersion;
  checkpointVisits: PromotionPlaybackCheckpointVisit[];
  samples: PromotionPlaybackSample[];
};

export type PromotionPointPayload = {
  label?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type PromotionCheckpointPayload = PromotionPointPayload & {
  instruction?: string;
  requiredDwellSeconds?: number;
};

export type PromotionHostelRoutePayload = {
  hostelName: string;
  hostelVenueId?: number | null;
  finishLabel?: string | null;
  finish: PromotionPointPayload;
  polyline?: PromotionCoordinate[];
};

export type CreatePromotionRouteVersionPayload = {
  routeName: string;
  start: PromotionPointPayload;
  finish: PromotionPointPayload;
  streetPolyline: PromotionCoordinate[];
  streetCheckpoints: PromotionCheckpointPayload[];
  hostelPolyline?: PromotionCoordinate[];
  hostelCheckpoints?: PromotionCheckpointPayload[];
  policy: PromotionRoutePolicy & {
    hostelRoutes?: PromotionHostelRoutePayload[];
  };
};

export type AssignPromotionTeamRoutePayload = {
  shiftInstanceId: number;
  routeVersionId: number;
  shiftAssignmentId?: number | null;
  hostelLabel?: string | null;
  hostelVenueId?: number | null;
  teamKey?: string;
  notes?: string | null;
};

const promotionTrackingKeys = {
  routePlans: ["promotion-tracking", "route-plans"] as const,
  teamAssignments: (weekId?: number | null) => ["promotion-tracking", "team-assignments", weekId ?? "all"] as const,
  managerSessions: (lifecycle?: string | null) => ["promotion-tracking", "manager-sessions", lifecycle ?? "all"] as const,
  sessionPlayback: (sessionId?: string | null) => ["promotion-tracking", "session-playback", sessionId ?? "none"] as const,
};

export const usePromotionRoutePlans = () =>
  useQuery({
    queryKey: promotionTrackingKeys.routePlans,
    queryFn: async () => {
      const response = await axiosInstance.get<PromotionRoutePlansResponse>("/promotion-tracking/manager/route-plans");
      return response.data;
    },
  });

export const useCreatePromotionRoutePlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; description?: string | null }) => {
      const response = await axiosInstance.post<{ routePlan: { id: number; name: string } }>(
        "/promotion-tracking/manager/route-plans",
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotionTrackingKeys.routePlans });
    },
  });
};

export const useCreatePromotionRouteVersion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ routePlanId, payload }: { routePlanId: string; payload: CreatePromotionRouteVersionPayload }) => {
      const response = await axiosInstance.post<{ routeVersion: PromotionRouteVersion }>(
        `/promotion-tracking/manager/route-plans/${routePlanId}/versions`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotionTrackingKeys.routePlans });
    },
  });
};

export const usePublishPromotionRouteVersion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (routeVersionId: string) => {
      const response = await axiosInstance.post<{ routeVersion: PromotionRouteVersion }>(
        `/promotion-tracking/manager/route-versions/${routeVersionId}/publish`,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotionTrackingKeys.routePlans });
    },
  });
};

export const usePromotionTeamAssignments = (weekId: number | null) =>
  useQuery({
    queryKey: promotionTrackingKeys.teamAssignments(weekId),
    queryFn: async () => {
      const response = await axiosInstance.get<PromotionTeamAssignmentsResponse>(
        "/promotion-tracking/manager/team-assignments",
        { params: weekId == null ? undefined : { weekId } },
      );
      return response.data;
    },
    enabled: weekId != null,
  });

export const useAssignPromotionTeamRoute = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AssignPromotionTeamRoutePayload) => {
      const response = await axiosInstance.post<{ teamAssignment: PromotionTeamAssignment }>(
        "/promotion-tracking/manager/team-assignments",
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotion-tracking", "team-assignments"] });
      queryClient.invalidateQueries({ queryKey: promotionTrackingKeys.routePlans });
    },
  });
};

export const usePromotionManagerSessions = (lifecycle: string | null = null) =>
  useQuery({
    queryKey: promotionTrackingKeys.managerSessions(lifecycle),
    queryFn: async () => {
      const response = await axiosInstance.get<PromotionManagerSessionsResponse>(
        "/promotion-tracking/manager/sessions",
        { params: lifecycle ? { lifecycle } : undefined },
      );
      return response.data;
    },
  });

export const usePromotionSessionPlayback = (sessionId: string | null) =>
  useQuery({
    queryKey: promotionTrackingKeys.sessionPlayback(sessionId),
    queryFn: async () => {
      const response = await axiosInstance.get<PromotionSessionPlaybackResponse>(
        `/promotion-tracking/manager/sessions/${sessionId}/playback`,
      );
      return response.data;
    },
    enabled: Boolean(sessionId),
  });
