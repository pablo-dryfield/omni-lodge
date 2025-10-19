import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
  HasMany,
} from 'sequelize-typescript';
import Counter from './Counter.js';
import User from './User.js';
import NightReportVenue from './NightReportVenue.js';
import NightReportPhoto from './NightReportPhoto.js';

export type NightReportStatus = 'draft' | 'submitted';

@Table({
  timestamps: true,
  modelName: 'NightReport',
  tableName: 'night_reports',
})
export default class NightReport extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Counter)
  @AllowNull(false)
  @Column({ field: 'counter_id', type: DataType.INTEGER })
  declare counterId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'leader_id', type: DataType.INTEGER })
  declare leaderId: number;

  @AllowNull(false)
  @Column({ field: 'activity_date', type: DataType.DATEONLY })
  declare activityDate: string;

  @AllowNull(false)
  @Default('draft')
  @Column({ type: DataType.ENUM('draft', 'submitted') })
  declare status: NightReportStatus;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @AllowNull(true)
  @Column({ field: 'submitted_at', type: DataType.DATE })
  declare submittedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'reassigned_by_id', type: DataType.INTEGER })
  declare reassignedById: number | null;

  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  @BelongsTo(() => Counter, { foreignKey: 'counterId', as: 'counter' })
  declare counter?: Counter;

  @BelongsTo(() => User, { foreignKey: 'leaderId', as: 'leader' })
  declare leader?: User;

  @BelongsTo(() => User, { foreignKey: 'reassignedById', as: 'reassignedBy' })
  declare reassignedBy?: User | null;
  @HasMany(() => NightReportVenue, { foreignKey: 'reportId', as: 'venues', onDelete: 'CASCADE' })
  declare venues?: NightReportVenue[];

  @HasMany(() => NightReportPhoto, { foreignKey: 'reportId', as: 'photos', onDelete: 'CASCADE' })
  declare photos?: NightReportPhoto[];
}
