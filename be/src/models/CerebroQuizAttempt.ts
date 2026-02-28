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
import User from './User.js';
import CerebroQuiz from './CerebroQuiz.js';

@Table({
  timestamps: true,
  modelName: 'CerebroQuizAttempt',
  tableName: 'cerebro_quiz_attempts',
})
export default class CerebroQuizAttempt extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => CerebroQuiz)
  @AllowNull(false)
  @Column({ field: 'quiz_id', type: DataType.INTEGER })
  declare quizId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'score_percent', type: DataType.DECIMAL(6, 2) })
  declare scorePercent: number;

  @AllowNull(false)
  @Default(false)
  @Column(DataType.BOOLEAN)
  declare passed: boolean;

  @AllowNull(false)
  @Default({})
  @Column(DataType.JSONB)
  declare answers: Record<string, string>;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'result_details', type: DataType.JSONB })
  declare resultDetails: Array<Record<string, unknown>>;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'submitted_at', type: DataType.DATE })
  declare submittedAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
