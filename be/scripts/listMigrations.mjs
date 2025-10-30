import sequelize from '../dist/config/database.js';

try {
  const [rows] = await sequelize.query("SELECT name FROM sequelize_meta ORDER BY name");
  console.log(rows);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
