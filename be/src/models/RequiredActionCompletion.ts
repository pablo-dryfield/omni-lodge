import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import RequiredAction from './RequiredAction.js';
import User from './User.js';

export type RequiredActionCompletionStatus = 'completed' | 'dismissed';

@Table({
  timestamps: true,
  modelName: 'RequiredActionCompletion',
  tableName: 'required_action_completions',
  underscored: true,
})
export default class RequiredActionCompletion extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => RequiredAction)
  @AllowNull(false)
  @Column({ field: 'required_action_id', type: DataType.INTEGER })
  declare requiredActionId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default('completed')
  @Column(DataType.STRING)
  declare status: RequiredActionCompletionStatus;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'response_json', type: DataType.JSONB })
  declare responseJson: Record<string, unknown>;
}
