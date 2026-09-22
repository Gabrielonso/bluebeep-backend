import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ name: 'platform_name', type: 'text', default: 'Bluebeep' })
  platformName: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ name: 'support_email', type: 'text', nullable: true })
  supportEmail: string | null;

  @Column({ name: 'support_phone', type: 'text', nullable: true })
  supportPhone: string | null;

  @Column({
    name: 'email_notifications_enabled',
    type: 'boolean',
    default: false,
  })
  emailNotificationsEnabled: boolean;

  @Column({
    name: 'push_notifications_enabled',
    type: 'boolean',
    default: true,
  })
  pushNotificationsEnabled: boolean;

  @Column({
    name: 'sms_notifications_enabled',
    type: 'boolean',
    default: false,
  })
  smsNotificationsEnabled: boolean;

  @Column({ name: 'privacy_policy', type: 'text', default: '' })
  privacyPolicy: string;

  @Column({ name: 'require_2fa', type: 'boolean', default: true })
  require2fa: boolean;

  @Column({ name: 'session_timeout_minutes', type: 'int', default: 30 })
  sessionTimeoutMinutes: number;

  @Column({ name: 'ip_allowlist_enabled', type: 'boolean', default: false })
  ipAllowlistEnabled: boolean;

  @Column({
    name: 'ip_allowlist',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  ipAllowlist: string[];

  @Column({
    name: 'login_attempt_alerts_enabled',
    type: 'boolean',
    default: true,
  })
  loginAttemptAlertsEnabled: boolean;

  @Column({ name: 'notify_high_severity_risk', type: 'boolean', default: true })
  notifyHighSeverityRisk: boolean;

  @Column({ name: 'notify_new_dispute', type: 'boolean', default: true })
  notifyNewDispute: boolean;

  @Column({ name: 'notify_payout_digest', type: 'boolean', default: true })
  notifyPayoutDigest: boolean;

  @Column({ name: 'notify_failed_login', type: 'boolean', default: true })
  notifyFailedLogin: boolean;

  @Column({ name: 'notify_weekly_report', type: 'boolean', default: false })
  notifyWeeklyReport: boolean;

  @Column({ name: 'auto_freeze_wallet_risk_score', type: 'int', default: 85 })
  autoFreezeWalletRiskScore: number;

  @Column({ name: 'auto_escalate_dispute_above', type: 'int', default: 5000 })
  autoEscalateDisputeAbove: number;

  @Column({
    name: 'payout_manual_review_threshold',
    type: 'int',
    default: 10000,
  })
  payoutManualReviewThreshold: number;

  @Column({
    name: 'gift_ring_detection_window_hours',
    type: 'int',
    default: 2,
  })
  giftRingDetectionWindowHours: number;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
