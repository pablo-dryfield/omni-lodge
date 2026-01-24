import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type Pm2Process = {
  id: number;
  name: string;
  status: string;
  pid: number | null;
  uptime: number | null;
};

export type Pm2RestartResponse = {
  message: string;
  startedAt?: string;
};

export type Pm2LogsResponse = {
  id: number;
  lines: number;
  output: string;
  stderr: string;
};

export type LogFileResponse = {
  target: string;
  lines: number;
  output: string;
};

const PM2_PROCESSES_QUERY_KEY = ["pm2-processes"];

type Pm2ProcessesQueryOptions = {
  enabled?: boolean;
};

export const usePm2Processes = (options: Pm2ProcessesQueryOptions = {}) =>
  useQuery<Pm2Process[], unknown>({
    queryKey: PM2_PROCESSES_QUERY_KEY,
    queryFn: async () => {
      const response = await axiosInstance.get("/pm2/processes");
      return (response.data?.processes ?? []) as Pm2Process[];
    },
    enabled: options.enabled,
  });

export const useRestartPm2Process = () => {
  const queryClient = useQueryClient();

  return useMutation<Pm2RestartResponse, unknown, { id: number }>({
    mutationFn: async ({ id }) => {
      const response = await axiosInstance.post(`/pm2/processes/${id}/restart`);
      return response.data as Pm2RestartResponse;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PM2_PROCESSES_QUERY_KEY });
    },
  });
};

export const fetchPm2ProcessLogs = async (id: number, lines = 200): Promise<Pm2LogsResponse> => {
  const response = await axiosInstance.get(`/pm2/processes/${id}/logs`, {
    params: { lines },
  });
  return response.data as Pm2LogsResponse;
};

export const fetchLogFile = async (target: "backend" | "ui", lines = 200): Promise<LogFileResponse> => {
  const response = await axiosInstance.get(`/pm2/log-files/${target}`, {
    params: { lines },
  });
  return response.data as LogFileResponse;
};
