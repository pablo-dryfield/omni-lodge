import dotenv from 'dotenv';
import path from 'node:path';
import { getEcwidOrder } from './src/services/ecwidService.ts';

dotenv.config({ path: path.resolve('.env.dev') });

const run = async () => {
  const order = await getEcwidOrder('HEC3M');
  const out: any = {
    id: order?.id,
    createDate: order?.createDate,
    pickupTime: order?.pickupTime,
    paymentStatus: order?.paymentStatus,
    fulfillmentStatus: (order as any)?.fulfillmentStatus,
    subtotal: order?.subtotal,
    total: order?.total,
    couponDiscount: (order as any)?.couponDiscount,
    discount: (order as any)?.discount,
    refundedAmount: (order as any)?.refundedAmount,
    items: Array.isArray((order as any)?.items)
      ? (order as any).items.map((it: any) => ({
          id: it?.id,
          productId: it?.productId,
          name: it?.name,
          quantity: it?.quantity,
          selectedOptions: it?.selectedOptions,
          options: it?.options,
          pickupTime: it?.pickupTime,
        }))
      : [],
    orderExtraFields: (order as any)?.orderExtraFields,
    extraFields: (order as any)?.extraFields,
  };
  console.log(JSON.stringify(out, null, 2));
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
