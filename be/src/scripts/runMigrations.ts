import 'dotenv/config';
import { Umzug, SequelizeStorage } from 'umzug';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sequelize from '../config/database.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsGlob = join(__dirname, '../migrations/*.js');
const umzug = new Umzug({
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName: 'sequelize_meta' }),
    logger: console,
    migrations: {
        glob: migrationsGlob,
        resolve: ({ name, path, context }) => {
            return {
                name,
                up: async () => {
                    if (!path) {
                        throw new Error(`Migration ${name} is missing file path`);
                    }
                    const migration = (await import(path));
                    if (typeof migration.up !== 'function') {
                        throw new Error(`Migration ${name} is missing an up() export`);
                    }
                    await migration.up({ context });
                },
                down: async () => {
                    if (!path) {
                        throw new Error(`Migration ${name} is missing file path`);
                    }
                    const migration = (await import(path));
                    if (typeof migration.down !== 'function') {
                        throw new Error(`Migration ${name} is missing a down() export`);
                    }
                    await migration.down({ context });
                },
            };
        },
    },
});
async function run() {
    const shouldUndo = process.argv.includes('--undo');
    try {
        if (shouldUndo) {
            await umzug.down({ step: 1 });
        }
        else {
            await umzug.up();
        }
    }
    finally {
        await sequelize.close();
    }
}
run().catch((error) => {
    console.error('Migration execution failed', error);
    process.exit(1);
});
