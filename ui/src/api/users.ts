import { useQuery } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";
import type { ServerResponse } from "../types/general/ServerResponse";
import type { User } from "../types/users/User";

export type UserSummary = Pick<User, "id" | "firstName" | "lastName" | "email"> & { status?: boolean };

export const useActiveUsers = () =>
  useQuery<UserSummary[]>({
    queryKey: ["users", "active"],
    queryFn: async () => {
      const response = await axiosInstance.get<ServerResponse<Partial<User>>>("/users/active");
      const dataset = response.data?.[0]?.data ?? [];
      return dataset
        .filter((record): record is UserSummary => typeof record?.id === "number")
        .map((record) => ({
          id: record.id as number,
          firstName: record.firstName ?? "",
          lastName: record.lastName ?? "",
          email: record.email ?? "",
          status: record.status,
        }));
    },
    staleTime: 30 * 1000,
  });
