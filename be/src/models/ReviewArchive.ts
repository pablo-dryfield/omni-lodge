import {AllowNull,AutoIncrement,Column,DataType,Default,Model,PrimaryKey,Table} from 'sequelize-typescript';
@Table({tableName:'review_archive',timestamps:true,underscored:true})
export default class ReviewArchive extends Model{
 @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id:number;
 @AllowNull(false) @Column(DataType.STRING(64)) declare platform:string;
 @AllowNull(false) @Column({field:'source_review_id',type:DataType.STRING(255)}) declare sourceReviewId:string;
 @AllowNull(false) @Column({field:'reviewer_name',type:DataType.STRING(255)}) declare reviewerName:string;
 @AllowNull(true) @Column({field:'reviewer_photo_url',type:DataType.TEXT}) declare reviewerPhotoUrl:string|null;
 @AllowNull(true) @Column(DataType.TEXT) declare comment:string|null;
 @AllowNull(false) @Column(DataType.DECIMAL(3,2)) declare rating:string;
 @AllowNull(false) @Column({field:'review_created_at',type:DataType.DATE}) declare reviewCreatedAt:Date;
 @AllowNull(true) @Column({field:'credit_month',type:DataType.DATEONLY}) declare creditMonth:string|null;
 @AllowNull(true) @Column({field:'review_updated_at',type:DataType.DATE}) declare reviewUpdatedAt:Date|null;
 @AllowNull(false) @Default(false) @Column({field:'is_deleted',type:DataType.BOOLEAN}) declare isDeleted:boolean;
 @AllowNull(false) @Default(false) @Column({field:'is_no_name',type:DataType.BOOLEAN}) declare isNoName:boolean;
 @AllowNull(false) @Default(false) @Column({field:'is_bad_review',type:DataType.BOOLEAN}) declare isBadReview:boolean;
 @AllowNull(true) @Column({field:'deleted_detected_at',type:DataType.DATE}) declare deletedDetectedAt:Date|null;
 @AllowNull(false) @Column({field:'first_seen_at',type:DataType.DATE}) declare firstSeenAt:Date;
 @AllowNull(false) @Column({field:'last_seen_at',type:DataType.DATE}) declare lastSeenAt:Date;
 @AllowNull(true) @Column({field:'last_seen_run_id',type:DataType.INTEGER}) declare lastSeenRunId:number|null;
 @AllowNull(true) @Column({field:'raw_payload',type:DataType.JSONB}) declare rawPayload:Record<string,unknown>|null;
}
