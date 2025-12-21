import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
  ForeignKey,
  BelongsTo,
  Unique,
} from "sequelize-typescript";
import type { NonAttribute } from "sequelize";
import User from "./User.js";

@Table({
  tableName: "game_scores",
  modelName: "GameScore",
  timestamps: true,
  underscored: true,
})
export default class GameScore extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique
  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: "user_id", type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: "best_score", type: DataType.INTEGER })
  declare bestScore: number;

  @BelongsTo(() => User, { foreignKey: "user_id", as: "user" })
  declare user?: NonAttribute<User>;
}
