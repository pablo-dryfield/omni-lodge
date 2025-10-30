import 'dotenv/config';
import { Umzug, SequelizeStorage } from 'umzug';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sequelize from '../dist/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsGlob = join(__dirname, '../migrations/*.js');

const umzug = new Umzug({
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize, tableName: 'sequelize_meta' }),
  migrations: { glob: migrationsGlob },
});

try {
  const executed = await umzug.executed();
  console.log('Executed migrations:', executed.map((m) => m.name));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
