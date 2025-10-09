import "reflect-metadata";
import sequelize from "../config/database.js";
import { defineAssociations } from "../models/defineAssociations.js";
import { initializeAccessControl } from "../utils/initializeAccessControl.js";

async function syncAccessControl() {
  try {
    defineAssociations();
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
