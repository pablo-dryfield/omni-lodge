import AddonInventoryMapping from '../../models/AddonInventoryMapping.js';
import StorefrontOrderResourceReservation from '../../models/StorefrontOrderResourceReservation.js';
import Booking from '../../models/Booking.js';
import Counter from '../../models/Counter.js';
import InventoryItem from '../../models/InventoryItem.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import StorefrontOrderItem from '../../models/StorefrontOrderItem.js';
import StorefrontPromotion from '../../models/StorefrontPromotion.js';
import {
  consumeStorefrontOrderResourceReservations,
  incrementStorefrontPromotionRedemptions,
  lockStorefrontInventoryReservationsForCounter,
  refreshStorefrontOrderInventoryReservationExpiries,
  releaseReconciledStorefrontInventoryReservations,
  releaseStorefrontOrderResourceReservations,
} from '../storefrontOrderResourceReservationService.js';
import { getAvailableStock } from '../inventoryService.js';
import { getActivePromotionReservationCounts } from '../storefrontResourceReservationAvailabilityService.js';

jest.mock('../../models/AddonInventoryMapping.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Counter.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/InventoryItem.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StorefrontOrder.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StorefrontOrderResourceReservation.js', () => ({
  __esModule: true,
  default: {
    bulkCreate: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../../models/StorefrontOrderItem.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StorefrontPromotion.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../inventoryService.js', () => ({ getAvailableStock: jest.fn() }));
jest.mock('../storefrontResourceReservationAvailabilityService.js', () => ({
  getActivePromotionReservationCounts: jest.fn(),
}));

const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
const reservationModel = StorefrontOrderResourceReservation as unknown as {
  findAll: jest.Mock;
  update: jest.Mock;
};
const addonInventoryMappingModel = AddonInventoryMapping as unknown as { findAll: jest.Mock };
const promotionModel = StorefrontPromotion as unknown as { findAll: jest.Mock };
const orderItemModel = StorefrontOrderItem as unknown as { findAll: jest.Mock };
const bookingModel = Booking as unknown as { findAll: jest.Mock };
const counterModel = Counter as unknown as { findAll: jest.Mock };
const inventoryItemModel = InventoryItem as unknown as { findAll: jest.Mock };
const orderModel = StorefrontOrder as unknown as { findAll: jest.Mock };
const activePromotionCounts = getActivePromotionReservationCounts as jest.MockedFunction<
  typeof getActivePromotionReservationCounts
>;
const availableStock = getAvailableStock as jest.MockedFunction<typeof getAvailableStock>;

describe('storefront order resource reservation service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addonInventoryMappingModel.findAll.mockResolvedValue([]);
    bookingModel.findAll.mockResolvedValue([]);
    counterModel.findAll.mockResolvedValue([]);
    inventoryItemModel.findAll.mockResolvedValue([]);
    orderModel.findAll.mockResolvedValue([]);
    orderItemModel.findAll.mockResolvedValue([]);
    availableStock.mockResolvedValue(100);
  });

  it('locks and increments promotion rows in deterministic order', async () => {
    const first = { id: 2, increment: jest.fn().mockResolvedValue(undefined) };
    const second = { id: 9, increment: jest.fn().mockResolvedValue(undefined) };
    promotionModel.findAll.mockResolvedValue([first, second]);

    await incrementStorefrontPromotionRedemptions([9, 2, 9], transaction);

    expect(promotionModel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    }));
    expect(first.increment).toHaveBeenCalledWith('redemptionCount', { by: 1, transaction });
    expect(second.increment).toHaveBeenCalledWith('redemptionCount', { by: 1, transaction });
    expect(first.increment.mock.invocationCallOrder[0]).toBeLessThan(
      second.increment.mock.invocationCallOrder[0],
    );
  });

  it('releases only held rows in the caller transaction', async () => {
    reservationModel.update.mockResolvedValue([3]);
    const now = new Date('2026-09-07T12:00:00.000Z');

    await expect(releaseStorefrontOrderResourceReservations(41, transaction, now)).resolves.toBe(3);
    expect(reservationModel.update).toHaveBeenCalledWith({
      status: 'released',
      releasedAt: now,
    }, expect.objectContaining({
      where: { orderId: 41, status: 'held' },
      transaction,
    }));
  });

  it('converts a live limited-promotion hold into exactly one redemption', async () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const reservation = {
      resourceType: 'promotion',
      promotionId: 7,
      status: 'held',
      expiresAt: new Date('2026-09-08T12:00:00.000Z'),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const promotion = {
      id: 7,
      code: 'ONLY5',
      maxRedemptions: 5,
      redemptionCount: 4,
      increment: jest.fn().mockResolvedValue(undefined),
    };
    reservationModel.findAll.mockResolvedValue([reservation]);
    promotionModel.findAll.mockResolvedValue([promotion]);
    activePromotionCounts.mockResolvedValue(new Map([[7, 1]]));

    await expect(consumeStorefrontOrderResourceReservations({
      orderId: 41,
      promotionIds: [7],
      now,
      transaction,
    })).resolves.toEqual({ inventoryReservationCount: 0, consumedPromotionIds: [7] });
    expect(promotion.increment).toHaveBeenCalledTimes(1);
    expect(promotion.increment).toHaveBeenCalledWith('redemptionCount', { by: 1, transaction });
    expect(reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'consumed',
      consumedAt: now,
    }), { transaction });
  });

  it('does not increment a promotion again when payment fulfillment is retried', async () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const reservation = {
      resourceType: 'promotion',
      promotionId: 7,
      status: 'consumed',
      expiresAt: now,
      update: jest.fn(),
    };
    const promotion = {
      id: 7,
      code: 'ONLY5',
      maxRedemptions: 5,
      redemptionCount: 5,
      increment: jest.fn(),
    };
    reservationModel.findAll.mockResolvedValue([reservation]);
    promotionModel.findAll.mockResolvedValue([promotion]);
    activePromotionCounts.mockResolvedValue(new Map());

    await expect(consumeStorefrontOrderResourceReservations({
      orderId: 41,
      promotionIds: [7],
      now,
      transaction,
    })).resolves.toEqual({ inventoryReservationCount: 0, consumedPromotionIds: [7] });
    expect(promotion.increment).not.toHaveBeenCalled();
    expect(reservation.update).not.toHaveBeenCalled();
  });

  it('refreshes held and consumed inventory horizons after a Manifest schedule amendment', async () => {
    const held = {
      orderItemId: 91,
      inventoryItemId: 4,
      addonId: 10,
      variant: 'M',
      status: 'held',
      consumedAt: null,
      commitExpiresAt: new Date('2026-09-13T19:00:00.000Z'),
      expiresAt: new Date('2026-09-08T10:00:00.000Z'),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const consumed = {
      ...held,
      status: 'consumed',
      consumedAt: new Date('2026-09-07T12:00:00.000Z'),
      update: jest.fn().mockResolvedValue(undefined),
    };
    reservationModel.findAll.mockResolvedValue([held, consumed]);
    inventoryItemModel.findAll.mockResolvedValue([{ id: 4, isActive: true }]);
    orderItemModel.findAll.mockResolvedValue([{
      id: 91,
      experienceDate: '2026-09-18',
      experienceTime: '22:00',
      addons: [{ addonId: 10, quantity: 1, variants: [{ value: 'M', quantity: 1 }] }],
    }]);

    await expect(refreshStorefrontOrderInventoryReservationExpiries({
      id: 41,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      paymentDueAt: new Date('2026-09-08T10:00:00.000Z'),
    }, transaction)).resolves.toBe(2);

    const amendedExpiry = new Date('2026-09-19T20:00:00.000Z');
    expect(held.update).toHaveBeenCalledWith(
      { commitExpiresAt: amendedExpiry },
      { transaction },
    );
    expect(consumed.update).toHaveBeenCalledWith(expect.objectContaining({
      commitExpiresAt: amendedExpiry,
      expiresAt: amendedExpiry,
      status: 'consumed',
      releasedAt: null,
    }), { transaction });
  });

  it('reacquires an expired paid commitment under the inventory row lock when rescheduled', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
    const reservation = {
      orderItemId: 91,
      inventoryItemId: 4,
      addonId: 10,
      variant: 'M',
      quantity: 2,
      status: 'consumed',
      consumedAt: new Date('2026-09-07T12:00:00.000Z'),
      commitExpiresAt: new Date('2026-09-09T20:00:00.000Z'),
      expiresAt: new Date('2026-09-09T20:00:00.000Z'),
      update: jest.fn().mockResolvedValue(undefined),
    };
    reservationModel.findAll.mockResolvedValue([reservation]);
    inventoryItemModel.findAll.mockResolvedValue([{ id: 4, isActive: true }]);
    orderItemModel.findAll.mockResolvedValue([{
      id: 91,
      productId: 2,
      experienceDate: '2026-09-18',
      experienceTime: '22:00',
      addons: [{ addonId: 10, quantity: 2, variants: [{ value: 'M', quantity: 2 }] }],
    }]);
    availableStock.mockResolvedValue(2);

    try {
      await expect(refreshStorefrontOrderInventoryReservationExpiries({
        id: 41,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'paid',
        paymentDueAt: new Date('2026-09-08T10:00:00.000Z'),
      }, transaction)).resolves.toBe(1);
    } finally {
      jest.useRealTimers();
    }

    expect(inventoryItemModel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [['id', 'ASC']],
      lock: transaction.LOCK.UPDATE,
    }));
    expect(availableStock).toHaveBeenCalledWith(4, transaction);
    expect(reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'consumed',
      expiresAt: new Date('2026-09-19T20:00:00.000Z'),
      releasedAt: null,
    }), { transaction });
  });

  it('locks counter reservations and their inventory rows before reconciliation', async () => {
    addonInventoryMappingModel.findAll.mockResolvedValue([{ inventoryItemId: 4 }]);
    bookingModel.findAll.mockResolvedValue([{ platformOrderId: 'order_public' }]);
    orderModel.findAll.mockResolvedValue([{ id: 41 }]);
    orderItemModel.findAll.mockResolvedValue([{ id: 91 }]);
    reservationModel.findAll.mockResolvedValue([{ id: 6, inventoryItemId: 4 }]);
    inventoryItemModel.findAll.mockResolvedValue([{ id: 4, isActive: true }]);

    await expect(lockStorefrontInventoryReservationsForCounter({
      date: '2026-09-18',
      productId: 2,
    } as never, transaction)).resolves.toEqual({ reservationIds: [6] });

    expect(reservationModel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      attributes: ['id', 'inventoryItemId'],
      lock: transaction.LOCK.UPDATE,
    }));
    expect(inventoryItemModel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [['id', 'ASC']],
      lock: transaction.LOCK.UPDATE,
    }));
    expect(reservationModel.findAll.mock.invocationCallOrder[0]).toBeLessThan(
      inventoryItemModel.findAll.mock.invocationCallOrder[0],
    );
  });

  it('locks every actively mapped inventory item even without a bank reservation', async () => {
    addonInventoryMappingModel.findAll.mockResolvedValue([
      { inventoryItemId: 9 },
      { inventoryItemId: 4 },
      { inventoryItemId: 9 },
    ]);
    bookingModel.findAll.mockResolvedValue([]);
    inventoryItemModel.findAll.mockResolvedValue([
      { id: 4, isActive: true },
      { id: 9, isActive: true },
    ]);

    await expect(lockStorefrontInventoryReservationsForCounter({
      date: '2026-09-18',
      productId: 2,
    } as never, transaction)).resolves.toEqual({ reservationIds: [] });

    expect(inventoryItemModel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.any(Object) },
      order: [['id', 'ASC']],
      lock: transaction.LOCK.UPDATE,
    }));
    expect(orderModel.findAll).not.toHaveBeenCalled();
  });

  it('releases only the counter reservations that were physically reconciled', async () => {
    reservationModel.update.mockResolvedValue([2]);
    const now = new Date('2026-09-19T21:00:00.000Z');

    await expect(releaseReconciledStorefrontInventoryReservations(
      { reservationIds: [6, 8] },
      transaction,
      now,
    )).resolves.toBe(2);

    expect(reservationModel.update).toHaveBeenCalledWith({
      status: 'released',
      expiresAt: now,
      releasedAt: now,
    }, expect.objectContaining({
      where: expect.objectContaining({ resourceType: 'inventory', status: 'consumed' }),
      transaction,
    }));
  });
});
