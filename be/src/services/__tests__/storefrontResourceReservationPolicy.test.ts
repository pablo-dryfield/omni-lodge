import {
  allocateInventoryReservationDemands,
  canAcquireLimitedPromotion,
  resolveInventoryReservationCommitExpiry,
  resolveInventoryReservationCommitExpiryForSchedule,
} from '../storefrontResourceReservationPolicy.js';

describe('storefront resource reservation policy', () => {
  it('allocates constrained demands first so shared inventory is not consumed unnecessarily', () => {
    const expiresAt = new Date('2026-09-10T22:00:00.000Z');
    const result = allocateInventoryReservationDemands([
      { orderItemId: 1, addonId: 10, variant: null, quantity: 1, commitExpiresAt: expiresAt },
      { orderItemId: 2, addonId: 20, variant: null, quantity: 1, commitExpiresAt: expiresAt },
    ], [
      { id: 1, addonId: 10, inventoryItemId: 100, variant: null, quantityPerAddon: 1 },
      { id: 2, addonId: 10, inventoryItemId: 200, variant: null, quantityPerAddon: 1 },
      { id: 3, addonId: 20, inventoryItemId: 200, variant: null, quantityPerAddon: 1 },
    ], new Map([[100, 1], [200, 1]]));

    expect(result.shortages).toEqual([]);
    expect(result.allocations).toEqual([
      expect.objectContaining({ orderItemId: 1, addonId: 10, inventoryItemId: 100, quantity: 1 }),
      expect.objectContaining({ orderItemId: 2, addonId: 20, inventoryItemId: 200, quantity: 1 }),
    ]);
  });

  it('uses physical mapping quantities and reports a deterministic variant shortage', () => {
    const expiresAt = new Date('2026-09-10T22:00:00.000Z');
    const result = allocateInventoryReservationDemands([
      { orderItemId: 1, addonId: 10, variant: 'M', quantity: 3, commitExpiresAt: expiresAt },
    ], [
      { id: 1, addonId: 10, inventoryItemId: 100, variant: 'M', quantityPerAddon: 0.5 },
    ], new Map([[100, 1]]));

    expect(result.allocations).toEqual([
      expect.objectContaining({ orderItemId: 1, addonId: 10, variant: 'M', inventoryItemId: 100, quantity: 1 }),
    ]);
    expect(result.shortages).toEqual([{
      orderItemId: 1,
      addonId: 10,
      variant: 'M',
      missingQuantity: 1,
    }]);
  });

  it('keeps identical selections on different order items as separate commitments', () => {
    const firstExpiry = new Date('2026-09-10T22:00:00.000Z');
    const secondExpiry = new Date('2026-10-10T22:00:00.000Z');
    const result = allocateInventoryReservationDemands([
      { orderItemId: 11, addonId: 10, variant: 'M', quantity: 1, commitExpiresAt: firstExpiry },
      { orderItemId: 12, addonId: 10, variant: 'M', quantity: 1, commitExpiresAt: secondExpiry },
    ], [
      { id: 1, addonId: 10, inventoryItemId: 100, variant: 'M', quantityPerAddon: 1 },
    ], new Map([[100, 2]]));

    expect(result.shortages).toEqual([]);
    expect(result.allocations).toEqual([
      expect.objectContaining({ orderItemId: 11, quantity: 1, commitExpiresAt: firstExpiry }),
      expect.objectContaining({ orderItemId: 12, quantity: 1, commitExpiresAt: secondExpiry }),
    ]);
  });

  it('holds paid inventory until 24 hours after the experience', () => {
    const dueAt = new Date('2026-09-08T10:00:00.000Z');
    const experienceAt = new Date('2026-09-12T19:00:00.000Z');
    expect(resolveInventoryReservationCommitExpiry(dueAt, experienceAt)).toEqual(
      new Date('2026-09-13T19:00:00.000Z'),
    );
  });

  it('moves an aggregated inventory commitment with the latest matching amended experience', () => {
    const dueAt = new Date('2026-09-08T10:00:00.000Z');
    const result = resolveInventoryReservationCommitExpiryForSchedule(
      dueAt,
      10,
      'M',
      [
        {
          experienceStartsAt: new Date('2026-09-12T19:00:00.000Z'),
          addons: [{ addonId: 10, quantity: 1, variants: [{ value: 'M', quantity: 1 }] }],
        },
        {
          experienceStartsAt: new Date('2026-09-18T20:00:00.000Z'),
          addons: [{ addonId: 10, quantity: 2, variants: [{ value: 'M', quantity: 2 }] }],
        },
        {
          experienceStartsAt: new Date('2026-10-01T20:00:00.000Z'),
          addons: [{ addonId: 20, quantity: 1, variants: [] }],
        },
      ],
    );

    expect(result).toEqual(new Date('2026-09-19T20:00:00.000Z'));
  });

  it('does not assign an unrelated order-item schedule to a reservation', () => {
    expect(resolveInventoryReservationCommitExpiryForSchedule(
      new Date('2026-09-08T10:00:00.000Z'),
      10,
      null,
      [{
        experienceStartsAt: new Date('2026-09-18T20:00:00.000Z'),
        addons: [{ addonId: 20, quantity: 1, variants: [] }],
      }],
    )).toBeNull();
  });

  it('counts other active promotion holds but honors an already-owned live hold', () => {
    expect(canAcquireLimitedPromotion({
      redemptionCount: 3,
      maxRedemptions: 5,
      activeReservationCount: 2,
    })).toBe(false);
    expect(canAcquireLimitedPromotion({
      redemptionCount: 3,
      maxRedemptions: 5,
      activeReservationCount: 2,
      ownsActiveReservation: true,
    })).toBe(true);
  });
});
