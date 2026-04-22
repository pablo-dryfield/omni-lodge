import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export type EmailTemplateType = 'plain_text' | 'react_email';

@Table({
  timestamps: true,
  modelName: 'EmailTemplate',
  tableName: 'email_templates',
  underscored: true,
})
export default class EmailTemplate extends Model<EmailTemplate> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(160),
    unique: true,
  })
  declare name: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Default('plain_text')
  @Column({
    field: 'template_type',
    type: DataType.ENUM('plain_text', 'react_email'),
  })
  declare templateType: EmailTemplateType;

  @AllowNull(false)
  @Column({
    field: 'subject_template',
    type: DataType.STRING(512),
  })
  declare subjectTemplate: string;

  @AllowNull(false)
  @Column({
    field: 'body_template',
    type: DataType.TEXT,
  })
  declare bodyTemplate: string;

  @AllowNull(false)
  @Default(true)
  @Column({
    field: 'is_active',
    type: DataType.BOOLEAN,
  })
  declare isActive: boolean;

  @AllowNull(true)
  @Column({
    field: 'created_by',
    type: DataType.INTEGER,
  })
  declare createdBy: number | null;

  @AllowNull(true)
  @Column({
    field: 'updated_by',
    type: DataType.INTEGER,
  })
  declare updatedBy: number | null;
}
