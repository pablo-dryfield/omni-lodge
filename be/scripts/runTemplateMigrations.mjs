import sequelize from '../dist/config/database.js';
import { up as repeatOnUp } from '../dist/migrations/202511010002-shift-template-repeat-on.js';
import { up as managerCoverageUp } from '../dist/migrations/202511010004-shift-template-manager-coverage.js';

try {
  await repeatOnUp({ context: sequelize.getQueryInterface() });
  await managerCoverageUp({ context: sequelize.getQueryInterface() });
  console.log('Template migrations executed successfully');
} catch (error) {
  console.error('Template migration execution failed', error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
