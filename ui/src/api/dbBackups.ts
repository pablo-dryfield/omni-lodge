import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type DbBackup = {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
};

export type DbBackupCommandResult = {
  message: string;
  result: {
    exitCode: number | null;
    command: string;
    args: string[];
    stdout: string;
    stderr: string;
  };
  storedFilename?: string;
};

const DB_BACKUPS_QUERY_KEY = ["db-backups"];

export const useDbBackups = () =>
  useQuery<DbBackup[], unknown>({
    queryKey: DB_BACKUPS_QUERY_KEY,
    queryFn: async () => {
      const response = await axiosInstance.get("/db-backups");
      return (response.data?.backups ?? []) as DbBackup[];
    },
  });

export const useCreateDbBackup = () => {
  const queryClient = useQueryClient();

  return useMutation<DbBackupCommandResult, unknown, void>({
    mutationFn: async () => {
      const response = await axiosInstance.post("/db-backups/create");
      return response.data as DbBackupCommandResult;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DB_BACKUPS_QUERY_KEY });
    },
  });
};

export const useRestoreDbBackup = () => {
  const queryClient = useQueryClient();

  return useMutation<DbBackupCommandResult, unknown, { filename: string }>({
    mutationFn: async ({ filename }) => {
      const encoded = encodeURIComponent(filename);
      const response = await axiosInstance.post(`/db-backups/${encoded}/restore`);
      return response.data as DbBackupCommandResult;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DB_BACKUPS_QUERY_KEY });
    },
  });
};

export const useUploadAndRestoreDbBackup = () => {
  const queryClient = useQueryClient();

  return useMutation<DbBackupCommandResult, unknown, File>({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("backup", file);
      const response = await axiosInstance.post("/db-backups/upload/restore", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data as DbBackupCommandResult;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DB_BACKUPS_QUERY_KEY });
    },
  });
};

export const downloadDbBackup = async (filename: string): Promise<{ blob: Blob; suggestedName: string }> => {
  const encoded = encodeURIComponent(filename);
  const response = await axiosInstance.get(`/db-backups/${encoded}/download`, {
    responseType: "blob",
  });

  const disposition = response.headers["content-disposition"] as string | undefined;
  let suggestedName = filename;
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/iu);
    if (match && match[1]) {
      suggestedName = match[1];
    }
  }

  return {
    blob: response.data as Blob,
    suggestedName,
  };
};
