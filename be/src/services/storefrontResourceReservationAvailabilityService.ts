import { col, fn, Op, type Transaction } from 'sequelize';

import StorefrontOrderResourceReservation from '../models/StorefrontOrderResourceReservation.js';

export const getActivePromotionReservationCounts = async (
  promotionIdsInput: number[],
  transaction?: Transaction,
  now = new Date(),
): Promise<Map<number, number>> => {
  const promotionIds = [...new Set(promotionIdsInput
    .map(Number)
    .filter((promotionId) => Number.isInteger(promotionId) && promotionId > 0))];
  if (promotionIds.length === 0) return new Map();
  const rows = await StorefrontOrderResourceReservation.findAll({
    attributes: ['promotionId', [fn('SUM', col('quantity')), 'reservedQuantity']],
    where: {
      resourceType: 'promotion',
      promotionId: { [Op.in]: promotionIds },
      status: 'held',
      expiresAt: { [Op.gt]: now },
    },
    group: ['promotionId'],
    transaction,
  });
  return new Map(rows.map((row) => [
    Number(row.promotionId),
    Number(row.get('reservedQuantity') ?? 0),
  ]));
};
