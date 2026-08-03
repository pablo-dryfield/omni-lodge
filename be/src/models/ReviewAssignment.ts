import {AllowNull,AutoIncrement,Column,DataType,Model,PrimaryKey,Table} from 'sequelize-typescript';
@Table({tableName:'review_assignments',timestamps:true,underscored:true})
export default class ReviewAssignment extends Model{
 @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id:number;
 @AllowNull(false) @Column({field:'review_id',type:DataType.INTEGER}) declare reviewId:number;
 @AllowNull(false) @Column({field:'user_id',type:DataType.INTEGER}) declare userId:number;
 @AllowNull(false) @Column({field:'assigned_by',type:DataType.INTEGER}) declare assignedBy:number;
}
