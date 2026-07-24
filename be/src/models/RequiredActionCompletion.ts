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

export type RequiredActionCompletionStatus = 'prompted' | 'completed' | 'dismissed';

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

  @AllowNull(true)
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'prompted_at', type: DataType.DATE })
  declare promptedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_prompted_at', type: DataType.DATE })
  declare lastPromptedAt: Date | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'prompt_count', type: DataType.INTEGER })
  declare promptCount: number;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'response_json', type: DataType.JSONB })
  declare responseJson: Record<string, unknown>;
}
