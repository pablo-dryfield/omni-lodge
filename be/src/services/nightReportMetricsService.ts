import dayjs from "dayjs";
import { Op } from "sequelize";
import NightReport from "../models/NightReport.js";
import NightReportVenue from "../models/NightReportVenue.js";

export type NightReportDailyReport = {
  reportId: number;
  date: string;
  totalPeople: number;
  postOpenBarPeople: number;
  openBarPeople: number;
  venuesCount: number;
  retentionRatio: number;
};

export type NightReportLeaderSummary = {
  reports: NightReportDailyReport[];
};

export type NightReportStatsMap = Map<number, NightReportLeaderSummary>;

export const fetchLeaderNightReportStats = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): Promise<NightReportStatsMap> => {
  const reports = await NightReport.findAll({
    where: {
      activityDate: {
        [Op.between]: [rangeStart.format("YYYY-MM-DD"), rangeEnd.format("YYYY-MM-DD")],
      },
      status: "submitted",
    },
    include: [
      {
        model: NightReportVenue,
        as: "venues",
        required: false,
      },
    ],
    order: [
      ["activityDate", "ASC"],
      [{ model: NightReportVenue, as: "venues" }, "order_index", "ASC"],
    ],
  });

  const stats = new Map<number, NightReportLeaderSummary>();

  reports.forEach((report) => {
    const leaderId = report.leaderId;
    if (!leaderId) {
      return;
    }

    const venues = (report.venues ?? [])
      .slice()
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const totalPeople = venues.reduce((sum, venue) => sum + (venue.totalPeople ?? 0), 0);
    const openBarPeople = venues
      .filter((venue) => venue.isOpenBar)
      .reduce((sum, venue) => sum + (venue.totalPeople ?? 0), 0);
    let postOpenBarPeople = 0;
    const openBarIndex = venues.findIndex((venue) => venue.isOpenBar);
    if (openBarIndex >= 0 && openBarIndex + 1 < venues.length) {
      postOpenBarPeople = venues[openBarIndex + 1]?.totalPeople ?? 0;
    } else if (openBarIndex === -1 && venues.length >= 2) {
      postOpenBarPeople = venues[1]?.totalPeople ?? 0;
    }
    const venuesCount = venues.length;
    const firstCount = venues[0]?.totalPeople ?? 0;
    const lastCount = venues[venues.length - 1]?.totalPeople ?? firstCount;
    const retentionRatio = firstCount > 0 ? Math.max(0, Math.min(lastCount / firstCount, 1)) : 0;

    const entry: NightReportDailyReport = {
      reportId: report.id,
      date: report.activityDate,
      totalPeople,
      postOpenBarPeople,
      openBarPeople,
      venuesCount,
      retentionRatio,
    };

    if (!stats.has(leaderId)) {
      stats.set(leaderId, { reports: [] });
    }
    stats.get(leaderId)!.reports.push(entry);
  });

  return stats;
};
