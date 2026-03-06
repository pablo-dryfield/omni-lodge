export type AssistantManagerTaskCadence = 'daily' | 'weekly' | 'biweekly' | 'every_two_weeks' | 'monthly';

export type AssistantManagerTaskEvidenceRuleType = 'link' | 'image';

export type AssistantManagerTaskEvidenceLinkMatch = {
  hosts?: string[];
  contains?: string[];
  regex?: string | null;
};

export type AssistantManagerTaskEvidenceRule = {
  key: string;
  label: string;
  type: AssistantManagerTaskEvidenceRuleType;
  required?: boolean;
  multiple?: boolean;
  minItems?: number | null;
  maxItems?: number | null;
  match?: AssistantManagerTaskEvidenceLinkMatch | null;
};

export type AssistantManagerTaskEvidenceItem = {
  id: string;
  ruleKey: string;
  type: AssistantManagerTaskEvidenceRuleType;
  value?: string | null;
  valid?: boolean;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  storagePath?: string | null;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  uploadedAt?: string | null;
  uploadedBy?: number | null;
};

export type AssistantManagerTaskTemplate = {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  subgroup: string;
  categoryOrder: number;
  subgroupOrder: number;
  templateOrder: number;
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
  evidenceItems?: AssistantManagerTaskEvidenceItem[];
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
  targetScope: 'staff_type' | 'user' | 'user_type' | 'shift_role';
  staffType?: string | null;
  livesInAccom?: boolean | null;
  userId?: number | null;
  userName?: string | null;
  userTypeId?: number | null;
  userTypeName?: string | null;
  shiftRoleId?: number | null;
  shiftRoleName?: string | null;
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
  templateDescription?: string | null;
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
  evidenceItems?: AssistantManagerTaskEvidenceItem[] | null;
  manual?: boolean;
  comment?: string;
  notes?: string | null;
  taskDate?: string;
  requireShift?: boolean;
};

export type UploadAmTaskEvidenceImageResponse = {
  id: string;
  ruleKey: string;
  type: 'image';
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  uploadedAt: string;
  uploadedBy: number | null;
};
