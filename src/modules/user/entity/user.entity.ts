import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { randomInt } from 'crypto';
import { normalizeUsername } from 'src/common/utils/utilityFunctions';
import {
  UserAudienceAccessOptions,
  UserCreateOptions,
  UserMessagingBehaviourOptions,
  UserStatusEnum,
  UserVisibilityOptions,
} from '../interfaces/user.interfaces';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { ChatParticipant } from 'src/modules/chats/entities/chat-participant.entity';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function generateRefId(length = 7): string {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}

@Index('idx_user_first_name', ['firstName'])
@Index('idx_user_last_name', ['lastName'])
@Index('idx_user_username', ['username'])
@Index('idx_user_email', ['email'])
@Index('idx_user_user_ref_id', ['userRefId'])
@Entity('users')
export class User {
  constructor(id: string) {
    this.id = id;
    this.userRefId = generateRefId(7);
  }

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'first_name', type: 'text', nullable: true })
  firstName: string;

  @Column({ name: 'last_name', type: 'text', nullable: true })
  lastName: string;

  @Column({
    type: 'text',
    unique: true,
    nullable: true,
    transformer: {
      to: (value: string | null) =>
        value != null ? normalizeUsername(value)! : value,
      from: (value: string | null) => value,
    },
  })
  username: string;

  @Column({ name: 'bio', type: 'text', nullable: true })
  bio: string;

  @Column({ name: 'bio_pending', type: 'text', nullable: true })
  bioPending?: string;

  @Column({
    name: 'bio_moderation_status',
    type: 'enum',
    enum: ModerationStatus,
    nullable: true,
  })
  bioModerationStatus?: ModerationStatus;

  @Column({ name: 'bio_moderation_labels', type: 'jsonb', nullable: true })
  bioModerationLabels?: Record<string, unknown>;

  @Column({ name: 'bio_moderated_at', type: 'timestamp', nullable: true })
  bioModeratedAt?: Date;

  @Column({ name: 'country_code', type: 'text', nullable: true })
  countryCode: string;

  @Column({ name: 'profile_picture', type: 'text', nullable: true })
  profilePicture: string;

  @Column({ type: 'text', unique: true, nullable: false })
  email: string;

  @Column({
    type: 'enum',
    enum: UserRoles,
    nullable: true,
    default: UserRoles.USER,
  })
  role: UserRoles;

  @Column({ name: 'phone_code', type: 'text', nullable: true })
  phoneCode: string;

  @Column({ name: 'phone_number', type: 'text', nullable: true })
  phoneNumber: string;

  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @Column({
    type: 'enum',
    nullable: true,
    default: UserStatusEnum.ACTIVATED,
    enum: UserStatusEnum,
  })
  status: UserStatusEnum;

  @Column({ type: 'text', nullable: true, select: false })
  otp: string;

  @Column({
    name: 'otp_expires_at',
    type: 'timestamp',
    nullable: true,
    select: false,
  })
  otpExpiresAt: Date;

  @Column({
    name: 'reset_otp',
    type: 'text',
    nullable: true,
    select: false,
  })
  resetOtp: string;

  @Column({
    name: 'reset_otp_expires_at',
    type: 'timestamp',
    nullable: true,
    select: false,
  })
  resetOtpExpiresAt: Date;

  @Column({
    name: 'created_with',
    type: 'enum',
    enum: UserCreateOptions,
    nullable: true,
    select: false,
    default: UserCreateOptions.EMAIL_AND_PASSWORD,
  })
  createdWith: UserCreateOptions;

  @Column({
    name: 'user_ref_id',
    type: 'text',
    unique: true,
    nullable: true,
  })
  userRefId: string;

  @Column({ type: 'timestamp', nullable: true })
  dob?: Date;

  @Column({ type: 'text', nullable: true, select: false })
  password: string;

  @Column({ name: 'social_mode', type: 'boolean', default: true })
  socialMode: boolean;

  @Column({
    name: 'allow_live_invite',
    type: 'boolean',
    default: true,
    select: false,
  })
  allowLiveInvite: boolean;

  @Column({ name: 'allow_beep', type: 'boolean', default: true, select: false })
  allowBeep: boolean;

  @Column({ name: 'notification_enabled', type: 'boolean', default: true })
  notificationEnabled: boolean;

  @Column({
    name: 'read_receipts',
    type: 'boolean',
    default: true,
    select: false,
  })
  readReceipts: boolean;

  @Column({
    name: 'profile_visit_visibility',
    type: 'boolean',
    default: true,
    select: false,
  })
  profileVisitVisibility: boolean;

  @Column({
    name: 'show_last_active',
    type: 'boolean',
    default: true,
    select: false,
  })
  showLastActive: boolean;

  @Column({
    name: 'audience_access',
    type: 'enum',
    enum: UserAudienceAccessOptions,
    nullable: true,
    default: UserAudienceAccessOptions.EVERYONE,
  })
  audienceAccess: UserAudienceAccessOptions;

  @Column({
    name: 'messaging_behaviour',
    type: 'enum',
    enum: UserMessagingBehaviourOptions,
    nullable: true,
    default: UserMessagingBehaviourOptions.REQUESTS_ONLY,
  })
  messagingBehaviour: UserMessagingBehaviourOptions;

  @Column({
    name: 'visibility',
    type: 'enum',
    enum: UserVisibilityOptions,
    nullable: true,
    default: UserVisibilityOptions.VISIBLE,
  })
  visibility: UserVisibilityOptions;

  /*** Relationships ***/

  @OneToMany(() => ChatParticipant, (p) => p.user)
  chatParticipants: ChatParticipant[];

  /*** Date Related ***/
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', select: false })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', select: false })
  deletedAt: Date | null;
}
