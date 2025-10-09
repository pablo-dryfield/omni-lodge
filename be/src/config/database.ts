import { Sequelize } from "sequelize-typescript";
import dotenv from "dotenv";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Channel from "../models/Channel.js";
import Guest from "../models/Guest.js";
import Review from "../models/Review.js";
import Counter from "../models/Counter.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import Product from "../models/Product.js";
import ProductType from "../models/ProductType.js";
import UserType from "../models/UserType.js";
import Page from "../models/Page.js";
import Module from "../models/Module.js";
import Action from "../models/Action.js";
import ModuleAction from "../models/ModuleAction.js";
import RolePagePermission from "../models/RolePagePermission.js";
import RoleModulePermission from "../models/RoleModulePermission.js";
import Addon from "../models/Addon.js";
import ProductAddon from "../models/ProductAddon.js";
import CounterChannelMetric from "../models/CounterChannelMetric.js";
import PaymentMethod from "../models/PaymentMethod.js";

const environment = (process.env.NODE_ENV || "development").trim();
const envFile = environment === "production" ? ".env.prod" : ".env.dev";
const configResult = dotenv.config({ path: envFile });

if (configResult.error) {
  console.warn(`dotenv: failed to load ${envFile}. Falling back to existing process.env values.`);
} else {
  console.log(`dotenv: loaded ${envFile} for NODE_ENV=${environment}`);
}

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER) {
  console.warn("Database configuration is incomplete. Check DB_HOST, DB_PORT, DB_NAME, DB_USER environment variables.");
}

const sequelize = new Sequelize({
  database: DB_NAME,
  dialect: "postgres",
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  port: parseInt(DB_PORT || "5432", 10),
  logging: false,
  dialectOptions: {
    ssl: false,
  },
  models: [
    User,
    PaymentMethod,
    Booking,
    Channel,
    Guest,
    Review,
    Counter,
    CounterProduct,
    CounterUser,
    CounterChannelMetric,
    Product,
    ProductAddon,
    ProductType,
    Addon,
    UserType,
    Page,
    Module,
    Action,
    ModuleAction,
    RolePagePermission,
    RoleModulePermission,
  ],
});

sequelize.authenticate()
  .then(() => console.log("Database connection successful"))
  .catch(err => console.error("Database connection error:", err));

export default sequelize;
