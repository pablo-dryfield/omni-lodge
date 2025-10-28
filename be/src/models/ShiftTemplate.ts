import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  AllowNull,
  DataType,
  Default,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import ShiftType from './ShiftType.js';
import ShiftInstance from './ShiftInstance.js';

export type ShiftTemplateRoleRequirement = {
  role: string;
  required: number | null;
};

@Table({
  tableName: 'shift_templates',
  modelName: 'ShiftTemplate',
  timestamps: true,
})
export default class ShiftTemplate extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ShiftType)
  @AllowNull(false)
  @Column({ field: 'shift_type_id', type: DataType.INTEGER })
  declare shiftTypeId: number;

  @AllowNull(false)
  @Column({ type: DataType.STRING(160) })
  declare name: string;

  @AllowNull(true)
  @Column({ field: 'default_start_time', type: DataType.TIME })
  declare defaultStartTime: string | null;

  @AllowNull(true)
  @Column({ field: 'default_end_time', type: DataType.TIME })
  declare defaultEndTime: string | null;

  @AllowNull(true)
  @Column({ field: 'default_capacity', type: DataType.INTEGER })
  declare defaultCapacity: number | null;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'requires_leader', type: DataType.BOOLEAN })
  declare requiresLeader: boolean;

  @AllowNull(true)
  @Column({ field: 'default_roles', type: DataType.JSONB })
  declare defaultRoles: ShiftTemplateRoleRequirement[] | null;

  @AllowNull(true)
  @Default({})
  @Column({ field: 'default_meta', type: DataType.JSONB })
  declare defaultMeta: Record<string, unknown> | null;

  @BelongsTo(() => ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' })
  declare shiftType?: ShiftType | null;

  @HasMany(() => ShiftInstance, { foreignKey: 'shift_template_id', as: 'instances' })
  declare instances?: ShiftInstance[];
}
