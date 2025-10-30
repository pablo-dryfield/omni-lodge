import sequelize from '../dist/config/database.js';

const migrations = [
  '202511010002-shift-template-repeat-on.js',
  '202511010003-shift-assignment-role-uniqueness.js',
  '202511010004-shift-template-manager-coverage.js'
];

try {
  await sequelize.query("CREATE TABLE IF NOT EXISTS sequelize_meta (name VARCHAR(255) PRIMARY KEY)");
  for (const name of migrations) {
    await sequelize.query('INSERT INTO sequelize_meta(name) VALUES (:name) ON CONFLICT (name) DO NOTHING', { replacements: { name } });
  }
  console.log('Migration records upserted');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
