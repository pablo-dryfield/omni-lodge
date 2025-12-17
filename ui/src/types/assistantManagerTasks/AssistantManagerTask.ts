export type AssistantManagerTaskCadence = 'daily' | 'weekly' | 'biweekly' | 'every_two_weeks' | 'monthly';

export type AssistantManagerTaskTemplate = {
  id: number;
  name: string;
  description?: string | null;
  cadence: AssistantManagerTaskCadence;
  scheduleConfig: Record<string, unknown>;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  assignments?: AssistantManagerTaskAssignment[];
};

export type TaskCommentEntry = {
  id: string;
  body: string;
  authorId: number | null;
  authorName?: string | null;
  createdAt: string;
};

export type AssistantManagerTaskLogMeta = {
  time?: string | null;
  durationHours?: number | null;
  priority?: 'high' | 'medium' | 'low' | null;
  points?: number | null;
  tags?: string[];
  evidence?: string[];
  manual?: boolean;
  comments?: TaskCommentEntry[];
  requireShift?: boolean;
  scheduleConflict?: boolean;
  onShift?: boolean;
  offDay?: boolean;
  shiftInstanceId?: number | null;
  shiftAssignmentId?: number | null;
  shiftTimeStart?: string | null;
  shiftTimeEnd?: string | null;
  [key: string]: unknown;
};

export type AssistantManagerTaskAssignment = {
  id: number;
  templateId: number;
  targetScope: 'staff_type' | 'user';
  staffType?: string | null;
  userId?: number | null;
  userName?: string | null;
  effectiveStart?: string | null;
  effectiveEnd?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AssistantManagerTaskLog = {
  id: number;
  templateId: number;
  templateName?: string | null;
  userId: number;
  userName?: string | null;
  taskDate: string;
  status: 'pending' | 'completed' | 'missed' | 'waived';
  completedAt?: string | null;
  notes?: string | null;
  meta: AssistantManagerTaskLogMeta;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ManualAssistantManagerTaskPayload = {
  templateId: number;
  userId: number;
  taskDate: string;
  assignmentId?: number | null;
  status?: AssistantManagerTaskLog['status'];
  notes?: string | null;
  time?: string | null;
  durationHours?: number | null;
  priority?: AssistantManagerTaskLogMeta['priority'];
  points?: number | null;
  tags?: string[];
  evidence?: string[];
  comment?: string;
  requireShift?: boolean;
};

export type TaskLogMetaUpdatePayload = {
  time?: string | null;
  durationHours?: number | null;
  priority?: AssistantManagerTaskLogMeta['priority'];
  points?: number | null;
  tags?: string[] | null;
  evidence?: string[] | null;
  manual?: boolean;
  comment?: string;
  notes?: string | null;
  taskDate?: string;
  requireShift?: boolean;
};
