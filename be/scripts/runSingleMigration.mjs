import sequelize from '../dist/config/database.js';
import { up as shiftAssignmentUniqUp } from '../dist/migrations/202511010003-shift-assignment-role-uniqueness.js';

try {
  await shiftAssignmentUniqUp({ context: sequelize.getQueryInterface() });
  console.log('Migration executed successfully');
} catch (error) {
  console.error('Migration failed', error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
