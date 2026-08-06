import { AllowNull, AutoIncrement, Column, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import UserType from './UserType.js';
import ProductType from './ProductType.js';

@Table({ timestamps: true, modelName: 'UserTypeProductType', tableName: 'user_type_product_types' })
export default class UserTypeProductType extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => UserType)
  @AllowNull(false)
  @Column({ field: 'user_type_id', type: DataType.INTEGER })
  declare userTypeId: number;

  @ForeignKey(() => ProductType)
  @AllowNull(false)
  @Column({ field: 'product_type_id', type: DataType.INTEGER })
  declare productTypeId: number;
}
