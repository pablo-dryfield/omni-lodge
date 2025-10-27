import {
  Model,
  Table,
 Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
  HasMany,
} from 'sequelize-typescript';
import ShiftTemplate from './ShiftTemplate.js';
import ShiftInstance from './ShiftInstance.js';

@Table({
  tableName: 'shift_types',
  modelName: 'ShiftType',
  timestamps: true,
})
export default class ShiftType extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'key', type: DataType.STRING(64), unique: true })
  declare key: string;

  @AllowNull(false)
  @Column({ field: 'name', type: DataType.STRING(120) })
  declare name: string;

  @AllowNull(true)
  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  @HasMany(() => ShiftTemplate, { foreignKey: 'shift_type_id', as: 'templates' })
  declare templates?: ShiftTemplate[];

  @HasMany(() => ShiftInstance, { foreignKey: 'shift_type_id', as: 'instances' })
  declare instances?: ShiftInstance[];
}
