import "reflect-metadata";
import { DataTypes, QueryTypes } from "sequelize";
import sequelize from "../config/database.js";
import { defineAssociations } from "../models/defineAssociations.js";
import Channel from "../models/Channel.js";
import PaymentMethod from "../models/PaymentMethod.js";
import {
  CHANNEL_PAYMENT_METHOD_OVERRIDES,
  PAYMENT_METHOD_SEED,
  initializeAccessControl,
} from "../utils/initializeAccessControl.js";

const DEFAULT_PAYMENT_METHOD_NAME = "Online/Card";

const normalize = (value: string): string => value.trim().toLowerCase();

async function ensurePaymentMethodInfrastructure(): Promise<void> {
  await PaymentMethod.sync();
  await Channel.sync();

  const queryInterface = sequelize.getQueryInterface();

  let channelColumns: Record<string, unknown>;
  try {
    channelColumns = await queryInterface.describeTable("channels");
  } catch (error) {
    throw new Error(`Failed to inspect "channels" table: ${(error as Error).message}`);
  }

  const columnExists = Object.prototype.hasOwnProperty.call(channelColumns, "payment_method_id");
  const transaction = await sequelize.transaction();

  try {
    const methodIdByName = new Map<string, number>();
    for (const method of PAYMENT_METHOD_SEED) {
      const [record] = await PaymentMethod.findOrCreate({
        where: { name: method.name },
        defaults: {
          description: method.description,
        },
        transaction,
      });
      methodIdByName.set(normalize(record.name), record.id);
    }

    const defaultMethodId = methodIdByName.get(normalize(DEFAULT_PAYMENT_METHOD_NAME));
    if (!defaultMethodId) {
      throw new Error(`Default payment method "${DEFAULT_PAYMENT_METHOD_NAME}" is required but missing.`);
    }

    if (!columnExists) {
      await queryInterface.addColumn(
        "channels",
        "payment_method_id",
        {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: "payment_methods",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        { transaction },
      );
    }

    const nullResult = (await queryInterface.sequelize.query(
      'SELECT COUNT(*)::int AS count FROM "channels" WHERE "payment_method_id" IS NULL',
      {
        type: QueryTypes.SELECT,
        transaction,
      },
    )) as Array<{ count: number }>;

    const nullCount = nullResult[0]?.count ?? 0;

    if (nullCount > 0 || !columnExists) {
      await queryInterface.sequelize.query(
        'UPDATE "channels" SET payment_method_id = :paymentMethodId WHERE payment_method_id IS NULL',
        {
          replacements: { paymentMethodId: defaultMethodId },
          type: QueryTypes.UPDATE,
          transaction,
        },
      );

      for (const [channelKey, methodName] of Object.entries(CHANNEL_PAYMENT_METHOD_OVERRIDES)) {
        const methodId = methodIdByName.get(normalize(methodName));
        if (!methodId) {
          continue;
        }
        await queryInterface.sequelize.query(
          'UPDATE "channels" SET payment_method_id = :paymentMethodId WHERE LOWER("name") = :channelName',
          {
            replacements: { paymentMethodId: methodId, channelName: channelKey },
            type: QueryTypes.UPDATE,
            transaction,
          },
        );
      }
    }

    await queryInterface.changeColumn(
      "channels",
      "payment_method_id",
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "payment_methods",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function syncAccessControl() {
  try {
    defineAssociations();
    await ensurePaymentMethodInfrastructure();
    await sequelize.sync({ alter: true });
    await initializeAccessControl();
    console.log("Access control data synchronised.");
  } catch (error) {
    console.error("Failed to synchronise access control data:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

syncAccessControl();
