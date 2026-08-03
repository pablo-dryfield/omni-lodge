import{AllowNull,AutoIncrement,Column,DataType,Default,Model,PrimaryKey,Table}from'sequelize-typescript';
@Table({tableName:'review_daily_snapshots',timestamps:true,underscored:true})
export default class ReviewDailySnapshot extends Model{
 @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id:number;
 @AllowNull(false) @Column(DataType.STRING(64)) declare platform:string;
 @AllowNull(false) @Column({field:'snapshot_date',type:DataType.DATEONLY}) declare snapshotDate:string;
 @AllowNull(true) @Column({field:'source_total_count',type:DataType.INTEGER}) declare sourceTotalCount:number|null;
 @AllowNull(true) @Column({field:'average_rating',type:DataType.DECIMAL(4,3)}) declare averageRating:string|null;
 @AllowNull(false) @Default(0) @Column({field:'archived_count',type:DataType.INTEGER}) declare archivedCount:number;
 @AllowNull(false) @Default(0) @Column({field:'active_count',type:DataType.INTEGER}) declare activeCount:number;
 @AllowNull(false) @Default(0) @Column({field:'deleted_count',type:DataType.INTEGER}) declare deletedCount:number;
 @AllowNull(false) @Default(0) @Column({field:'new_reviews_count',type:DataType.INTEGER}) declare newReviewsCount:number;
 @AllowNull(true) @Column({field:'sync_run_id',type:DataType.INTEGER}) declare syncRunId:number|null;
}
