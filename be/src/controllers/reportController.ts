import { Request, Response } from "express";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import dayjs from "dayjs";
import Counter from "../models/Counter.js";
import CounterChannelMetric from "../models/CounterChannelMetric.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import User from "../models/User.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";

type CommissionSummary = {
  userId: number;
  firstName: string;
  totalCommission: number;
  breakdown: Array<{
    date: string;
    commission: number;
    customers: number;
    guidesCount: number;
  }>;
};

type GuideDailyBreakdown = {
  userId: number;
  firstName: string;
  commission: number;
  customers: number;
};

type DailyAggregate = {
  totalCustomers: number;
  guides: Map<number, GuideDailyBreakdown>;
};

const FULL_ACCESS_ROLE_SLUGS = new Set([
  "admin",
  "owner",
  "manager",
  "assistant-manager",
  "assistant_manager",
  "assistantmanager",
]);

const COMMISSION_RATE_PER_ATTENDEE = 6;
const NEW_COUNTER_SYSTEM_START = dayjs("2025-10-09");

export const getCommissionByDateRange = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, scope } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json([{ message: "Start date and end date are required" }]);
      return;
    }

    const start = dayjs(startDate as string).startOf("day");
    const end = dayjs(endDate as string).endOf("day");

    const counters = await Counter.findAll({
      attributes: ["id", "date"],
      where: {
        date: {
          [Op.between]: [start.toDate(), end.toDate()],
        },
      },
      order: [["date", "ASC"]],
    });

    if (counters.length === 0) {
      res.status(404).json([{ message: "No data found for the specified date range" }]);
      return;
    }

    const counterMetaById = new Map<number, { dateKey: string; isNewSystem: boolean }>();
    const legacyCounterIds: number[] = [];
    const newSystemCounterIds: number[] = [];

    counters.forEach((counter) => {
      const rawDate = counter.getDataValue("date");
      if (!rawDate) {
        return;
      }

      const counterDate = dayjs(rawDate);
      const dateKey = counterDate.format("YYYY-MM-DD");
      const isNewSystem = !counterDate.isBefore(NEW_COUNTER_SYSTEM_START, "day");

      counterMetaById.set(counter.id, { dateKey, isNewSystem });

      if (isNewSystem) {
        newSystemCounterIds.push(counter.id);
      } else {
        legacyCounterIds.push(counter.id);
      }
    });

    const legacyTotalsByCounter = new Map<number, number>();
    if (legacyCounterIds.length > 0) {
      const legacyRows = await CounterProduct.findAll({
        attributes: [
          "counterId",
          [Sequelize.fn("SUM", Sequelize.col("quantity")), "totalQuantity"],
        ],
        where: {
          counterId: {
            [Op.in]: legacyCounterIds,
          },
        },
        group: ["counterId"],
      });

      legacyRows.forEach((row) => {
        const counterId = row.getDataValue("counterId");
        const totalQuantity = Number(row.get("totalQuantity") ?? 0);
        legacyTotalsByCounter.set(counterId, totalQuantity);
      });
    }

    const newSystemTotalsByCounter = new Map<number, number>();
    if (newSystemCounterIds.length > 0) {
      const metricRows = await CounterChannelMetric.findAll({
        attributes: [
          "counterId",
          [Sequelize.fn("SUM", Sequelize.col("qty")), "attendedQty"],
        ],
        where: {
          counterId: {
            [Op.in]: newSystemCounterIds,
          },
          kind: "people",
          tallyType: "attended",
        },
        group: ["counterId"],
      });

      metricRows.forEach((row) => {
        const counterId = row.getDataValue("counterId");
        const attendedQty = Number(row.get("attendedQty") ?? 0);
        newSystemTotalsByCounter.set(counterId, attendedQty);
      });
    }

    const counterIds = counters.map((counter) => counter.id);
    const staffRecords = await CounterUser.findAll({
      attributes: ["counterId", "userId", "role"],
      include: [
        {
          model: User,
          as: "counterUser",
          attributes: ["firstName"],
        },
      ],
      where: {
        counterId: {
          [Op.in]: counterIds,
        },
      },
    });

    if (staffRecords.length === 0) {
      res.status(404).json([{ message: "No staff members found for the specified date range" }]);
      return;
    }

    const commissionDataByUser = new Map<number, CommissionSummary>();
    const staffByCounter = new Map<number, CounterUser[]>();

    staffRecords.forEach((staff) => {
      const counterId = staff.counterId;
      if (!staffByCounter.has(counterId)) {
        staffByCounter.set(counterId, []);
      }
      staffByCounter.get(counterId)!.push(staff);

      const userId = staff.userId;
      const firstName = staff.counterUser?.firstName ?? `User ${userId}`;

      if (!commissionDataByUser.has(userId)) {
        commissionDataByUser.set(userId, {
          userId,
          firstName,
          totalCommission: 0,
          breakdown: [],
        });
      }
    });

    const dailyAggregates = new Map<string, DailyAggregate>();

    const getOrCreateDailyAggregate = (dateKey: string): DailyAggregate => {
      let aggregate = dailyAggregates.get(dateKey);
      if (!aggregate) {
        aggregate = {
          totalCustomers: 0,
          guides: new Map<number, GuideDailyBreakdown>(),
        };
        dailyAggregates.set(dateKey, aggregate);
      }
      return aggregate;
    };

    counters.forEach((counter) => {
      const meta = counterMetaById.get(counter.id);
      if (!meta) {
        return;
      }

      const customers = meta.isNewSystem
        ? newSystemTotalsByCounter.get(counter.id) ?? 0
        : legacyTotalsByCounter.get(counter.id) ?? 0;

      const aggregate = getOrCreateDailyAggregate(meta.dateKey);
      aggregate.totalCustomers += customers;

      const staffForCounter = staffByCounter.get(counter.id) ?? [];
      if (staffForCounter.length === 0 || customers === 0) {
        return;
      }

      const totalCommissionForCounter = customers * COMMISSION_RATE_PER_ATTENDEE;
      const commissionPerStaff = totalCommissionForCounter / staffForCounter.length;

      staffForCounter.forEach((staff) => {
        const userId = staff.userId;
        const commissionSummary = commissionDataByUser.get(userId);
        if (!commissionSummary) {
          return;
        }

        commissionSummary.totalCommission += commissionPerStaff;

        const guideBreakdown = aggregate.guides.get(userId) ?? {
          userId,
          firstName: commissionSummary.firstName,
          commission: 0,
          customers: 0,
        };

        guideBreakdown.commission += commissionPerStaff;
        guideBreakdown.customers += customers;

        aggregate.guides.set(userId, guideBreakdown);
      });
    });

    aggregateDailyBreakdownByUser(dailyAggregates, commissionDataByUser);

    const allSummaries = Array.from(commissionDataByUser.values()).map((entry) => ({
      ...entry,
      totalCommission: Number(entry.totalCommission.toFixed(2)),
      breakdown: entry.breakdown.map((item) => ({
        ...item,
        commission: Number(item.commission.toFixed(2)),
      })),
    }));

    const authRequest = req as AuthenticatedRequest;
    const requesterId = authRequest.authContext?.id ?? null;
    const requesterRoleSlug = authRequest.authContext?.roleSlug ?? null;

    const requesterHasFullAccess = requesterRoleSlug ? FULL_ACCESS_ROLE_SLUGS.has(requesterRoleSlug) : false;
    const forceSelfScope = scope === "self";
    const shouldLimitToSelf = forceSelfScope || !requesterHasFullAccess;

    const data = shouldLimitToSelf && requesterId !== null
      ? allSummaries.filter((entry) => entry.userId === requesterId)
      : allSummaries;

    res.status(200).json([{ data, columns: [] }]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json([{ message: "Internal server error" }]);
  }
};

function aggregateDailyBreakdownByUser(
  dailyAggregates: Map<string, DailyAggregate>,
  commissionDataByUser: Map<number, CommissionSummary>,
) {
  dailyAggregates.forEach((aggregate, dateKey) => {
    const guidesCount = aggregate.guides.size;

    aggregate.guides.forEach((guide) => {
      const summary = commissionDataByUser.get(guide.userId);
      if (!summary) {
        return;
      }

      summary.breakdown.push({
        date: dateKey,
        commission: guide.commission,
        customers: guide.customers,
        guidesCount,
      });
    });
  });
}
