import dotenv from 'dotenv';
import path from 'node:path';
import { getEcwidOrder } from './src/services/ecwidService.ts';
import { transformEcwidOrders } from './src/utils/ecwidAdapter.ts';

dotenv.config({ path: path.resolve('.env.dev') });

const run = async () => {
  const order = await getEcwidOrder('HEC3M');
  const transformed = transformEcwidOrders([order]).orders;
  const rows = transformed.map((o: any) => ({
    platformBookingId: o.platformBookingId,
    date: o.date,
    quantity: o.quantity,
    menCount: o.menCount,
    womenCount: o.womenCount,
  }));
  console.log(JSON.stringify(rows, null, 2));
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
