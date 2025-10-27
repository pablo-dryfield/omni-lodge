import { Model, Table, Column, PrimaryKey, AutoIncrement, Unique, AllowNull, Default, DataType } from 'sequelize-typescript';

export type UserRole = 'owner' | 'admin' | 'assistant_manager' | 'guide';

@Table({
  timestamps: true,
  modelName: 'User',
  tableName: 'users'
})
export default class User extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique
  @AllowNull(false)
  @Column(DataType.STRING)
  declare username: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare firstName: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare lastName: string;

  @Unique
  @AllowNull(false)
  @Column(DataType.STRING)
  declare email: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare password: string;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare userTypeId: number;

  @AllowNull(false)
  @Default('guide')
  @Column({ field: 'role', type: DataType.ENUM('owner', 'admin', 'assistant_manager', 'guide') })
  declare roleKey: UserRole;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare createdBy: number;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare status: boolean;
  
}
