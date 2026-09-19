import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const databaseModuleUrl = pathToFileURL(
  path.join(repositoryRoot, 'be', 'dist', 'config', 'database.js'),
).href;

const requiredEnvironment = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnvironment = requiredEnvironment.filter((name) => !(process.env[name] ?? '').trim());
if (missingEnvironment.length > 0) {
  throw new Error(`Missing disposable database configuration: ${missingEnvironment.join(', ')}`);
}

const { default: sequelize } = await import(databaseModuleUrl);
sequelize.options.logging = false;

const tableNameFor = (model) => {
  const tableName = model.getTableName();
  return typeof tableName === 'string' ? tableName : tableName.tableName;
};

try {
  await sequelize.authenticate();
  const models = [...sequelize.modelManager.models]
    .sort((left, right) => left.name.localeCompare(right.name));
  if (models.length === 0) throw new Error('The compiled database registered no Sequelize models');

  const verifiedTables = new Set();
  for (const model of models) {
    const tableName = tableNameFor(model);
    try {
      // Selecting all mapped attributes validates the compiled model contract
      // even when the disposable table contains no rows.
      await model.findOne({ raw: true });
      verifiedTables.add(tableName);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Compiled model ${model.name} cannot query ${tableName}: ${detail}`);
    }
  }

  console.log(JSON.stringify({
    status: 'valid',
    compiledModels: models.length,
    queriedTables: verifiedTables.size,
  }));
} finally {
  await sequelize.close().catch(() => undefined);
}
