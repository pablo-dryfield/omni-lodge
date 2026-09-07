import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import axiosInstance from '../utils/axiosInstance';

export type AttendanceCheckStatus = 'on_time' | 'late' | 'absent' | 'excused';
export type AttendanceCheckAssignment = {
  assignmentId: number; userId: number; name: string; role: string; shiftName: string;
  startTime: string; endTime: string; status: AttendanceCheckStatus | null;
  revision: number; evidenceTaskLogId: number | null; evidenceFileId: string | null;
  lateMinutes: number | null; notes: string | null; recordedAt: string | null; self: boolean;
};
export type AttendanceCheck = {
  taskLogId: number; taskDate: string; checkKind: 'meeting_point' | 'promotion_chat'; expectedTime: string;
  evidenceRuleKey: string; shiftTypeIds: number[]; serverTime: string;
  evidence: Array<{ id: string; fileName: string; subjectUserId: number | null; uploadedAt: string }>;
  assignments: AttendanceCheckAssignment[];
};
export type AttendanceCheckInput = {
  status: AttendanceCheckStatus; evidenceFileId: string; expectedRevision: number;
  lateMinutes?: number | null; notes?: string | null;
};
export const attendanceCheckError = (error: unknown) => {
  const data = (error as AxiosError<{ message?: string } | Array<{ message?: string }>>)?.response?.data;
  return (Array.isArray(data) ? data[0]?.message : data?.message) || 'Unable to save attendance. Please try again.';
};
export const fetchAttendanceCheck = async (logId: number): Promise<AttendanceCheck> =>
  (await axiosInstance.get<AttendanceCheck>(`/assistantManagerTasks/logs/${logId}/attendance-check`)).data;
export const saveAttendanceCheck = async (logId: number, assignmentId: number, input: AttendanceCheckInput): Promise<AttendanceCheck> =>
  (await axiosInstance.put<AttendanceCheck>(`/assistantManagerTasks/logs/${logId}/attendance-check/${assignmentId}`, input)).data;
export const useAttendanceCheck = (logId: number, evidenceVersion: string, enabled = true) => useQuery({
  queryKey: ['task-attendance-check', logId, evidenceVersion], queryFn: () => fetchAttendanceCheck(logId), retry: false, enabled,
});
export const useSaveAttendanceCheck = (logId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: number; input: AttendanceCheckInput }) => saveAttendanceCheck(logId, assignmentId, input),
    onSuccess: (data) => {
      queryClient.setQueriesData({ queryKey: ['task-attendance-check', logId] }, data);
      void queryClient.invalidateQueries({ queryKey: ['volunteer-milestones'] });
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ['task-attendance-check', logId] }); },
  });
};
