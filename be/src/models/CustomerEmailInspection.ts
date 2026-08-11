import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'CustomerEmailInspection',
  tableName: 'customer_email_inspections',
  underscored: true,
})
export default class CustomerEmailInspection extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @Unique
  @AllowNull(false)
  @Column({ field: 'gmail_message_id', type: DataType.STRING(256) })
  declare gmailMessageId: string;

  @AllowNull(false)
  @Default('processing')
  @Column(DataType.STRING(32))
  declare status: 'processing' | 'completed';

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'action_created', type: DataType.BOOLEAN })
  declare actionCreated: boolean;

  @AllowNull(true)
  @Column({ field: 'inspected_at', type: DataType.DATE })
  declare inspectedAt: Date | null;
}
