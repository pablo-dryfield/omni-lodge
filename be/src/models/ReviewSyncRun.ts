import {AllowNull,AutoIncrement,Column,DataType,Default,Model,PrimaryKey,Table} from 'sequelize-typescript';
@Table({tableName:'review_sync_runs',timestamps:true,underscored:true})
export default class ReviewSyncRun extends Model{
 @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id:number;
 @AllowNull(false) @Column(DataType.STRING(64)) declare platform:string;
 @AllowNull(false) @Default('running') @Column(DataType.STRING(20)) declare status:string;
 @AllowNull(false) @Default(0) @Column({field:'seen_count',type:DataType.INTEGER}) declare seenCount:number;
 @AllowNull(false) @Default(0) @Column({field:'deleted_count',type:DataType.INTEGER}) declare deletedCount:number;
 @AllowNull(false) @Column({field:'started_at',type:DataType.DATE}) declare startedAt:Date;
 @AllowNull(true) @Column({field:'completed_at',type:DataType.DATE}) declare completedAt:Date|null;
 @AllowNull(true) @Column({field:'created_by',type:DataType.INTEGER}) declare createdBy:number|null;
}
