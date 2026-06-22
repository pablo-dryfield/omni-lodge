import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
} from 'sequelize-typescript';

export type BookingUtmCatalogField = 'utm_source' | 'utm_medium' | 'utm_campaign';

@Table({
  timestamps: true,
  tableName: 'booking_utm_catalog',
  modelName: 'BookingUtmCatalog',
})
export default class BookingUtmCatalog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(32),
  })
  declare field: BookingUtmCatalogField;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(255),
  })
  declare value: string;

  @AllowNull(false)
  @Column({
    field: 'normalized_value',
    type: DataType.STRING(255),
  })
  declare normalizedValue: string;

  @AllowNull(false)
  @Default(true)
  @Column({
    type: DataType.BOOLEAN,
  })
  declare active: boolean;

  @AllowNull(true)
  @Column({
    field: 'first_seen_at',
    type: DataType.DATE,
  })
  declare firstSeenAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'last_seen_at',
    type: DataType.DATE,
  })
  declare lastSeenAt: Date | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({
    field: 'created_at',
    type: DataType.DATE,
  })
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({
    field: 'updated_at',
    type: DataType.DATE,
  })
  declare updatedAt: Date;
}
