import axiosInstance from '../utils/axiosInstance';
import type { ServerResponse } from '../types/general/ServerResponse';
import type { ReviewCounterStaffSummary } from '../types/reviewCounters/ReviewCounterStaffSummary';

const extractSummary = (payload: ServerResponse<ReviewCounterStaffSummary>): ReviewCounterStaffSummary => {
  return payload[0]?.data?.[0] ?? { periodStart: '', periodEnd: '', minimumReviews: 15, staff: [] };
};

export const fetchReviewStaffSummary = async (params: {
  periodStart?: string;
  period?: string;
}): Promise<ReviewCounterStaffSummary> => {
  const response = await axiosInstance.get<ServerResponse<ReviewCounterStaffSummary>>('/reviewCounters/staff-summary', {
    params,
    withCredentials: true,
  });
  return extractSummary(response.data);
};

export const updateReviewMonthlyApproval = async (
  userId: number,
  payload: { periodStart?: string; paymentApproved?: boolean; incentiveApproved?: boolean },
): Promise<ReviewCounterStaffSummary> => {
  const response = await axiosInstance.patch<ServerResponse<ReviewCounterStaffSummary>>(
    `/reviewCounters/staff-summary/${userId}/approval`,
    payload,
    { withCredentials: true },
  );
  return extractSummary(response.data);
};
