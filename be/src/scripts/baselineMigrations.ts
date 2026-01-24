import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import sequelize from '../config/database.js';

const EXCLUDES = new Set([
  '202601150001-control-panel-config.js',
  '202602010001-migration-audit.js',
  '202602150001-config-seed-runs.js',
]);

type MigrationList = {
  names: string[];
  source: string;
};

async function listMigrations(): Promise<MigrationList> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const distDir = join(__dirname, '../migrations');
  const srcDir = join(__dirname, '../../src/migrations');

  try {
    const entries = await fs.readdir(distDir);
    const names = entries.filter((entry) => entry.endsWith('.js')).sort();
    return { names, source: distDir };
  } catch {
    const entries = await fs.readdir(srcDir);
    const names = entries
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => entry.replace(/\.ts$/, '.js'))
      .sort();
    return { names, source: srcDir };
  }
}

async function ensureSequelizeMeta(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS sequelize_meta (
      name VARCHAR(255) PRIMARY KEY
    );
  `);
}

async function loadExisting(): Promise<Set<string>> {
  const [rows] = await sequelize.query('SELECT name FROM sequelize_meta');
  const entries = rows as Array<{ name: string }>;
  return new Set(entries.map((entry) => entry.name));
}

async function insertNames(names: string[]): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const values = names.map((name) => `('${name.replace(/'/g, "''")}')`).join(', ');
  await sequelize.query(
    `INSERT INTO sequelize_meta (name) VALUES ${values} ON CONFLICT (name) DO NOTHING;`,
  );
}

async function run(): Promise<void> {
  const { names, source } = await listMigrations();
  const target = names.filter((name) => !EXCLUDES.has(name));

  await ensureSequelizeMeta();
  const existing = await loadExisting();
  const missing = target.filter((name) => !existing.has(name));

  console.log(`baseline: found ${names.length} migrations from ${source}`);
  console.log(`baseline: excluding ${EXCLUDES.size} migrations`);
  console.log(`baseline: inserting ${missing.length} into sequelize_meta`);

  await insertNames(missing);
}

run()
  .then(async () => {
    await sequelize.close();
  })
  .catch(async (error) => {
    console.error('Baseline migration failed', error);
    await sequelize.close();
    process.exit(1);
  });
