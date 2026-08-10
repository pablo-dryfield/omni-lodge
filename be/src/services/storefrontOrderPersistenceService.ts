import type { Transaction } from 'sequelize';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';

/**
 * Locks only the storefront order row, then loads its items separately.
 *
 * PostgreSQL rejects `FOR UPDATE` when Sequelize applies it to a query whose
 * eager-loaded association is on the nullable side of an outer join. Keeping
 * the lock query free of joins avoids that failure while retaining the order
 * row lock needed to make fulfillment idempotent.
 */
export const findLockedStorefrontOrderWithItems = async (
  publicId: string,
  transaction: Transaction,
): Promise<StorefrontOrder | null> => {
  const order = await StorefrontOrder.findOne({
    where: { publicId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!order) return null;

  order.items = await StorefrontOrderItem.findAll({
    where: { orderId: order.id },
    order: [['id', 'ASC']],
    transaction,
  });

  return order;
};
