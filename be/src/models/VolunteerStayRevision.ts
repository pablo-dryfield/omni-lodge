import {
  AllowNull, AutoIncrement, Column, CreatedAt, DataType, ForeignKey, Model, PrimaryKey, Table,
} from 'sequelize-typescript';
import User from './User.js';
import VolunteerStay from './VolunteerStay.js';

@Table({ tableName: 'volunteer_stay_revisions', modelName: 'VolunteerStayRevision', timestamps: true, updatedAt: false, underscored: true })
export default class VolunteerStayRevision extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => VolunteerStay) @AllowNull(false) @Column({ field: 'stay_id', type: DataType.INTEGER })
  declare stayId: number;

  @AllowNull(false) @Column(DataType.INTEGER)
  declare revision: number;

  @AllowNull(false) @Column(DataType.JSONB)
  declare snapshot: Record<string, unknown>;

  @AllowNull(true) @Column(DataType.TEXT)
  declare reason: string | null;

  @ForeignKey(() => User) @AllowNull(true) @Column({ field: 'actor_id', type: DataType.INTEGER })
  declare actorId: number | null;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
