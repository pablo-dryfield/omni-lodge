import sequelize from '../dist/config/database.js';

try {
  const [rows] = await sequelize.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'shift_assignments'");
  console.log(rows);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
