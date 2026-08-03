import {AllowNull,AutoIncrement,Column,DataType,Model,PrimaryKey,Table} from 'sequelize-typescript';
@Table({tableName:'review_manual_credits',timestamps:true,underscored:true})
export default class ReviewManualCredit extends Model{
 @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id:number;
 @AllowNull(false) @Column({field:'user_id',type:DataType.INTEGER}) declare userId:number;
 @AllowNull(false) @Column(DataType.STRING(64)) declare platform:string;
 @AllowNull(false) @Column(DataType.DATEONLY) declare date:string;
 @AllowNull(false) @Column(DataType.DECIMAL(10,4)) declare credit:string;
 @AllowNull(true) @Column(DataType.TEXT) declare notes:string|null;
 @AllowNull(false) @Column({field:'created_by',type:DataType.INTEGER}) declare createdBy:number;
}
