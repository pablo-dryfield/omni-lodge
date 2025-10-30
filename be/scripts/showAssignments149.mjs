import sequelize from '../dist/config/database.js';

try {
  const [rows] = await sequelize.query('SELECT id, shift_instance_id, user_id, role_in_shift, shift_role_id FROM shift_assignments WHERE shift_instance_id = 149 ORDER BY user_id, role_in_shift');
  console.log(rows);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
