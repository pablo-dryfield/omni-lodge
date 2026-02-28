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
  Unique,
} from 'sequelize-typescript';
import User from './User.js';
import CerebroEntry from './CerebroEntry.js';

export type CerebroQuizQuestionOption = {
  id: string;
  label: string;
};

export type CerebroQuizQuestion = {
  id: string;
  prompt: string;
  options: CerebroQuizQuestionOption[];
  correctOptionId: string;
  explanation?: string | null;
};

@Table({
  timestamps: true,
  modelName: 'CerebroQuiz',
  tableName: 'cerebro_quizzes',
})
export default class CerebroQuiz extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => CerebroEntry)
  @AllowNull(true)
  @Column({ field: 'entry_id', type: DataType.INTEGER })
  declare entryId: number | null;

  @Unique
  @AllowNull(false)
  @Column(DataType.STRING)
  declare slug: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare description: string | null;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'target_user_type_ids', type: DataType.JSONB })
  declare targetUserTypeIds: number[];

  @AllowNull(false)
  @Default(80)
  @Column({ field: 'passing_score', type: DataType.INTEGER })
  declare passingScore: number;

  @AllowNull(false)
  @Default([])
  @Column(DataType.JSONB)
  declare questions: CerebroQuizQuestion[];

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare status: boolean;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;
}
