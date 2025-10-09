import type { QueryInterface } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const PAYMENT_METHOD_SEED = [
  { name: 'Online/Card', description: 'Online or card-based payments' },
  { name: 'Bank Transfer', description: 'Payments received via bank transfer' },
  { name: 'Transfer', description: 'Third-party transfer payments' },
  { name: 'Cash', description: 'Payments collected in cash' },
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      'payment_methods',
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        description: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
      },
      { transaction },
    );

    const timestamp = new Date();
    await qi.bulkInsert(
      'payment_methods',
      PAYMENT_METHOD_SEED.map((method) => ({
        name: method.name,
        description: method.description,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      { transaction },
    );

    await qi.addColumn(
      'channels',
      'payment_method_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'payment_methods',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    const paymentMethods = (await qi.sequelize.query(
      'SELECT id, name FROM "payment_methods"',
      {
        type: QueryTypes.SELECT,
        transaction,
      },
    )) as Array<{ id: number; name: string }>;

    const getMethodId = (name: string): number => {
      const record = paymentMethods.find((method) => method.name.toLowerCase() === name.toLowerCase());
      if (!record) {
        throw new Error(`Payment method "${name}" was not seeded correctly.`);
      }
      return record.id;
    };

    const onlineCardId = getMethodId('Online/Card');
    await qi.sequelize.query('UPDATE "channels" SET payment_method_id = :paymentMethodId', {
      replacements: { paymentMethodId: onlineCardId },
      type: QueryTypes.UPDATE,
      transaction,
    });

    const overrides: Array<[string, string]> = [
      ['email', 'Bank Transfer'],
      ['xperiencepoland', 'Transfer'],
      ['walk-in', 'Cash'],
      ['topdeck', 'Cash'],
      ['hostel atlantis', 'Cash'],
    ];

    for (const [channelName, methodName] of overrides) {
      const paymentMethodId = getMethodId(methodName);
      await qi.sequelize.query(
        'UPDATE "channels" SET payment_method_id = :paymentMethodId WHERE LOWER("name") = :channelName',
        {
          replacements: { paymentMethodId, channelName },
          type: QueryTypes.UPDATE,
          transaction,
        },
      );
    }

    await qi.changeColumn(
      'channels',
      'payment_method_id',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'payment_methods',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.removeColumn('channels', 'payment_method_id', { transaction });
    await qi.dropTable('payment_methods', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
