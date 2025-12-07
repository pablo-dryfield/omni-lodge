import dotenv from 'dotenv';
import { processBookingEmail } from './dist/services/bookings/bookingIngestionService.js';
dotenv.config({ path: '.env.dev' });
const messageIds = process.argv.slice(2);
if (messageIds.length === 0) {
  console.error('No message ids provided');
  process.exit(1);
}
for (const id of messageIds) {
  try {
    const result = await processBookingEmail(id, { force: true });
    console.log(`Processed ${id}: ${result}`);
  } catch (error) {
    console.error(`Failed ${id}`, error);
  }
}
