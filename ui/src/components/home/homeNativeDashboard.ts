import type {
  BookingsSummaryDashboardFilters,
  ReportDashboardDto,
} from "../../api/reports";
import {
  isBookingsSummaryDashboardPageConfig,
  normalizeBookingsSummaryDashboardFilters,
} from "../../utils/dashboardPageConfig";

export type HomeNativeDashboard = {
  kind: "bookings-summary";
  filters: BookingsSummaryDashboardFilters;
};

type DashboardContentSource = Pick<ReportDashboardDto, "config" | "filters">;

/**
 * Resolves full-page dashboard modules that Home renders outside the legacy
 * report-card grid. An absent/unknown kind remains a legacy report dashboard.
 */
export const resolveHomeNativeDashboard = (
  dashboard: DashboardContentSource | null | undefined,
): HomeNativeDashboard | null => {
  if (!dashboard || !isBookingsSummaryDashboardPageConfig(dashboard.config)) {
    return null;
  }

  return {
    kind: "bookings-summary",
    filters: normalizeBookingsSummaryDashboardFilters(dashboard.filters),
  };
};
