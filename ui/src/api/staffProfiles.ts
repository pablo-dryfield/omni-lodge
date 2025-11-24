import { useQuery } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type StaffProfileSummary = {
  userId: number;
  staffType: string | null;
  livesInAccom: boolean;
  active: boolean;
};

const myStaffProfileKey = ["staff-profile", "me"] as const;

export const useMyStaffProfile = () =>
  useQuery<StaffProfileSummary>({
    queryKey: myStaffProfileKey,
    queryFn: async () => {
      const response = await axiosInstance.get<StaffProfileSummary>("/staffProfiles/me");
      return response.data;
    },
    staleTime: 1000 * 60 * 5,
  });
