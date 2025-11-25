import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  Unique,
  AllowNull,
  Default,
  DataType,
  BelongsToMany,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import ShiftRole from './ShiftRole.js';
import UserShiftRole from './UserShiftRole.js';

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
  @Column(DataType.STRING)
  declare phone: string | null;

  @AllowNull(true)
  @Column({ field: 'country_of_citizenship', type: DataType.STRING })
  declare countryOfCitizenship: string | null;

  @AllowNull(true)
  @Column({ field: 'date_of_birth', type: DataType.DATEONLY })
  declare dateOfBirth: Date | null;

  @AllowNull(true)
  @Column({ field: 'preferred_pronouns', type: DataType.STRING })
  declare preferredPronouns: string | null;

  @AllowNull(true)
  @Column({ field: 'emergency_contact_name', type: DataType.STRING })
  declare emergencyContactName: string | null;

  @AllowNull(true)
  @Column({ field: 'emergency_contact_relationship', type: DataType.STRING })
  declare emergencyContactRelationship: string | null;

  @AllowNull(true)
  @Column({ field: 'emergency_contact_phone', type: DataType.STRING })
  declare emergencyContactPhone: string | null;

  @AllowNull(true)
  @Column({ field: 'emergency_contact_email', type: DataType.STRING })
  declare emergencyContactEmail: string | null;

  @AllowNull(true)
  @Column({ field: 'arrival_date', type: DataType.DATEONLY })
  declare arrivalDate: Date | null;

  @AllowNull(true)
  @Column({ field: 'departure_date', type: DataType.DATEONLY })
  declare departureDate: Date | null;

  @AllowNull(true)
  @Column({ field: 'dietary_restrictions', type: DataType.TEXT })
  declare dietaryRestrictions: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare allergies: string | null;

  @AllowNull(true)
  @Column({ field: 'medical_notes', type: DataType.TEXT })
  declare medicalNotes: string | null;

  @AllowNull(true)
  @Column({ field: 'whatsapp_handle', type: DataType.STRING })
  declare whatsappHandle: string | null;

  @AllowNull(true)
  @Column({ field: 'facebook_profile_url', type: DataType.STRING })
  declare facebookProfileUrl: string | null;

  @AllowNull(true)
  @Column({ field: 'instagram_profile_url', type: DataType.STRING })
  declare instagramProfileUrl: string | null;

  @AllowNull(true)
  @Column({ field: 'discovery_source', type: DataType.STRING })
  declare discoverySource: string | null;

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

  @AllowNull(true)
  @Column({ field: 'profile_photo_path', type: DataType.STRING })
  declare profilePhotoPath: string | null;

  @AllowNull(true)
  @Column({ field: 'profile_photo_url', type: DataType.STRING })
  declare profilePhotoUrl: string | null;

  @BelongsToMany(() => ShiftRole, () => UserShiftRole)
  declare shiftRoles?: NonAttribute<Array<ShiftRole & { UserShiftRole: UserShiftRole }>>;
}
