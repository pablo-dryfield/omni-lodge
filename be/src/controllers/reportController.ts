import { Request, Response } from "express";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import dayjs from "dayjs";
import Counter from "../models/Counter.js";
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

export const getCommissionByDateRange = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, scope } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json([{ message: "Start date and end date are required" }]);
      return;
    }

    const start = dayjs(startDate as string).startOf("day").toDate();
    const end = dayjs(endDate as string).endOf("day").toDate();

    const commissionReport = await Counter.findAll({
      attributes: [
        "id",
        "date",
        [Sequelize.fn("SUM", Sequelize.col("products.quantity")), "totalQuantity"],
      ],
      include: [
        {
          model: CounterProduct,
          as: "products",
          attributes: [],
        },
      ],
      where: {
        date: {
          [Op.between]: [start, end],
        },
      },
      group: ["Counters.id"],
      order: [["date", "ASC"]],
    });

    if (!commissionReport || commissionReport.length === 0) {
      res.status(404).json([{ message: "No data found for the specified date range" }]);
      return;
    }

    const totalStaffCount = await CounterUser.findAll({
      attributes: ["userId"],
      include: [
        {
          model: Counter,
          as: "counter",
          attributes: ["date"],
        },
        {
          model: User,
          as: "counterUser",
          attributes: ["firstName"],
        },
      ],
      where: {
        "$counter.date$": {
          [Op.between]: [start, end],
        },
      },
    });

    if (totalStaffCount.length === 0) {
      res.status(404).json([{ message: "No staff members found for the specified date range" }]);
      return;
    }

    const commissionDataByUser = new Map<number, CommissionSummary>();
    const staffByDate = new Map<string, typeof totalStaffCount>();

    totalStaffCount.forEach((staff) => {
      const userId = staff.dataValues.userId;
      const firstName = staff.dataValues.counterUser?.dataValues?.firstName ?? `User ${userId}`;

      if (!commissionDataByUser.has(userId)) {
        commissionDataByUser.set(userId, {
          userId,
          firstName,
          totalCommission: 0,
          breakdown: [],
        });
      }

      const counterDate: Date | undefined = staff.dataValues.counter?.date;
      if (!counterDate) {
        return;
      }

      const dateKey = dayjs(counterDate).format("YYYY-MM-DD");
      if (!staffByDate.has(dateKey)) {
        staffByDate.set(dateKey, []);
      }
      staffByDate.get(dateKey)!.push(staff);
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

    commissionReport.forEach((report) => {
      const reportDate: Date | undefined = report.dataValues.date;
      if (!reportDate) {
        return;
      }

      const dateKey = dayjs(reportDate).format("YYYY-MM-DD");
      const totalQuantity = Number(report.get("totalQuantity") ?? 0);

      const aggregate = getOrCreateDailyAggregate(dateKey);
      aggregate.totalCustomers += totalQuantity;

      const staffForDay = staffByDate.get(dateKey) ?? [];
      if (staffForDay.length === 0 || totalQuantity === 0) {
        return;
      }

      const totalCommissionForDay = totalQuantity * 6;
      const commissionPerStaff = totalCommissionForDay / staffForDay.length;

      staffForDay.forEach((staff) => {
        const userId = staff.dataValues.userId;
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
        guideBreakdown.customers += totalQuantity;

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