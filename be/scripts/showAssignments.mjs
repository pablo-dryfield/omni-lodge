import sequelize from '../dist/config/database.js';

try {
  const [rows] = await sequelize.query('SELECT id, shift_instance_id, user_id, role_in_shift, shift_role_id FROM shift_assignments ORDER BY id DESC LIMIT 10');
  console.log(rows);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
