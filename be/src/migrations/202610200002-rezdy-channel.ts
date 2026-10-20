import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      INSERT INTO payment_methods (name, description, "createdAt", "updatedAt")
      SELECT 'Transfer', 'Third-party transfer payments', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE LOWER(name) = 'transfer');
      INSERT INTO channels (name, description, "apiKey", "apiSecret", payment_method_id,
        "createdAt", "updatedAt", "createdBy", "updatedBy")
      SELECT 'Rezdy', 'Rezdy email orders (including reseller orders)', '', '',
        (SELECT id FROM payment_methods WHERE LOWER(name) = 'transfer' ORDER BY id LIMIT 1),
        NOW(), NOW(), u.id, u.id
      FROM (SELECT id FROM users ORDER BY id LIMIT 1) u
      WHERE NOT EXISTS (SELECT 1 FROM channels WHERE LOWER(name) = 'rezdy');
    `, { transaction });
  });
}

export async function down(): Promise<void> {
  // Channel identity is durable: never delete financial associations or operator configuration.
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT
    (NOT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM channels c
      JOIN payment_methods p ON p.id = c.payment_method_id WHERE LOWER(c.name) = 'rezdy')) AS ready;`);
  const details = (rows as Array<{ ready: boolean }>)[0];
  return { ok: Boolean(details?.ready), details };
}
