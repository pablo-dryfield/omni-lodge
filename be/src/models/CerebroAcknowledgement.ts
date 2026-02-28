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
import CerebroEntry from './CerebroEntry.js';

@Table({
  timestamps: true,
  modelName: 'CerebroAcknowledgement',
  tableName: 'cerebro_acknowledgements',
})
export default class CerebroAcknowledgement extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => CerebroEntry)
  @AllowNull(false)
  @Column({ field: 'entry_id', type: DataType.INTEGER })
  declare entryId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'accepted_at', type: DataType.DATE })
  declare acceptedAt: Date;

  @AllowNull(false)
  @Default('')
  @Column({ field: 'version_accepted', type: DataType.STRING })
  declare versionAccepted: string;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
