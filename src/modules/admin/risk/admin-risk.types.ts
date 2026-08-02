import { UserStatusEnum } from 'src/modules/user/interfaces/user.interfaces';

/** Shared risk contract for Command Center + User Intelligence. */
export type RiskLabel = 'low' | 'medium' | 'high' | 'critical';

export type RiskTrigger =
  | 'suspended'
  | 'pending_moderation'
  | 'rejected_content'
  | 'repeat_offender'
  | 'media_nsfw'
  | 'bio_flagged'
  | 'content_flagged';

export type RiskBadge =
  | 'high_risk'
  | 'critical_risk'
  | 'email_verified'
  | 'phone_verified'
  | 'suspended'
  | 'under_review'
  | 'deactivated';

export interface ModerationSignals {
  pendingText: number;
  rejectedText: number;
  pendingMedia: number;
  rejectedMedia: number;
  bioPending: boolean;
  bioRejected: boolean;
  /** Max OpenAI category scores seen on this user's content. */
  topCategoryScores: Record<string, number>;
  /** Rekognition / rejection reason snippets. */
  mediaRejectionReasons: string[];
}

export interface UserRiskCategories {
  /** Content / trust integrity from moderation. Primary live signal. */
  contentTrust: number;
  /** Suspension + repeat rejects. */
  accountEnforcement: number;
  /**
   * Reserved for monetization / device domains.
   * Always null until those systems exist — FE should hide.
   */
  loginSecurity: number | null;
  paymentFraud: number | null;
  giftAbuse: number | null;
  payoutRisk: number | null;
}

export interface UserRiskProfile {
  overall: number;
  label: RiskLabel;
  categories: UserRiskCategories;
  badges: RiskBadge[];
  triggers: RiskTrigger[];
  openItems: { pending: number; rejected: number };
  topLabels: string[];
  primaryTrigger: RiskTrigger | null;
}

/** Extensible platform metric — always return full shape; null when unavailable. */
export type PlatformRiskMetric = {
  count: number;
  percentage: number | null;
  of: 'users' | 'moderation_items' | string | null;
  inWindow: { count: number; percentage: number | null } | null;
  breakdown: Record<string, unknown> | null;
};

export type PlatformRiskSummary = {
  suspendedUsers: PlatformRiskMetric;
  pendingModeration: PlatformRiskMetric;
  rejectedModeration: PlatformRiskMetric;
  flaggedAccounts: PlatformRiskMetric;
  totals: {
    users: number;
    moderationItems: number;
  };
  loginSecurity: null;
  paymentFraud: null;
  giftAbuse: null;
  payoutRisk: null;
};

export function emptyModerationSignals(): ModerationSignals {
  return {
    pendingText: 0,
    rejectedText: 0,
    pendingMedia: 0,
    rejectedMedia: 0,
    bioPending: false,
    bioRejected: false,
    topCategoryScores: {},
    mediaRejectionReasons: [],
  };
}

export function riskLabelFromScore(score: number): RiskLabel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function isFlaggedStatus(status: UserStatusEnum): boolean {
  return status === UserStatusEnum.SUSPENDED;
}

/** Lightweight SQL-sortable proxy aligned with scoreUser weights. */
export function riskProxySqlExpression(alias = 'u'): string {
  return `
    LEAST(100, GREATEST(0,
      CASE WHEN ${alias}.status = 'suspended' THEN 40 ELSE 0 END
      + COALESCE(mod.rejected_total, 0) * 12
      + COALESCE(mod.pending_total, 0) * 5
      + CASE WHEN COALESCE(mod.rejected_media, 0) > 0 THEN 18 ELSE 0 END
      + CASE WHEN COALESCE(mod.rejected_total, 0) >= 3 THEN 20 ELSE 0 END
    ))
  `;
}
