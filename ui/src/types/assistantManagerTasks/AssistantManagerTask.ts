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
  meta: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
};
