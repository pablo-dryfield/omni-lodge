import {
  AllowNull,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import type HomeQuickActionTarget from './HomeQuickActionTarget.js';

export type HomeQuickActionAudienceMode = 'all' | 'targeted';

@Table({
  tableName: 'home_quick_action_configs',
  modelName: 'HomeQuickActionConfig',
  timestamps: true,
  underscored: true,
})
export default class HomeQuickActionConfig extends Model {
  @PrimaryKey
  @AllowNull(false)
  @Column({ field: 'action_key', type: DataType.STRING(120) })
  declare actionKey: string;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare enabled: boolean;

  @AllowNull(false)
  @Default('all')
  @Column({ field: 'audience_mode', type: DataType.STRING(24) })
  declare audienceMode: HomeQuickActionAudienceMode;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  declare targets?: NonAttribute<HomeQuickActionTarget[]>;
}
