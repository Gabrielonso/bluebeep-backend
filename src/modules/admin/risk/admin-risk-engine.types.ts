import { AbuseReportSeverity } from 'src/modules/reports/enums/abuse-report-severity.enum';
import { AbuseReportStatus } from 'src/modules/reports/enums/abuse-report-status.enum';
import { AbuseReportType } from 'src/modules/reports/enums/abuse-report-type.enum';
import { RiskLabel, UserRiskProfile } from './admin-risk.types';

/** Display band for platform risk index (UI-friendly). */
export type RiskBand = 'low' | 'medium' | 'medium-high' | 'high' | 'critical';

export type RiskSignalType =
  | 'open_abuse_report'
  | 'high_severity_report'
  | 'escalated_report'
  | 'scam_report'
  | 'impersonation_report'
  | 'suspended_account'
  | 'rejected_content'
  | 'media_nsfw'
  | 'repeat_offender'
  | 'pending_moderation_spike';

export type RiskSignalSeverity = 'critical' | 'warning' | 'info';

export type RiskSignalStatus =
  | 'open'
  | 'under_review'
  | 'escalated'
  | 'monitoring'
  | 'resolved';

/** Investigation display status mapped from Trust Queue report status. */
export type InvestigationDisplayStatus =
  | 'active'
  | 'pending_review'
  | 'escalated'
  | 'resolved';

export type RiskEngineScoreBreakdown = {
  accountRisk: number | null;
  trustIntegrity: number | null;
  loginSecurity: null;
  paymentFraud: null;
  giftAbuse: null;
  payoutRisk: null;
};

export type RiskEngineAccountRow = {
  id: string;
  username: string | null;
  userRefId: string | null;
  profilePicture: string | null;
  status: string;
  accountRisk: number;
  trustIntegrity: number;
  loginSecurity: null;
  paymentFraud: null;
  giftAbuse: null;
  payoutRisk: null;
  overall: number;
  label: RiskLabel;
  primaryTrigger: string | null;
  badges: string[];
};

export type RiskEngineOverview = {
  platformRisk: {
    index: number;
    label: RiskLabel;
    band: RiskBand;
  };
  activeAlerts: {
    count: number;
    newInWindow: number;
    windowHours: number;
  };
  scoreBreakdown: RiskEngineScoreBreakdown;
  alertsByCategory: {
    accountRisk: number;
    trustIntegrity: number;
    loginSecurity: null;
    paymentFraud: null;
    giftAbuse: null;
    payoutRisk: null;
  };
  automatedActions: {
    windowHours: number;
    suspensions: number;
    escalations: number;
    resolves: number;
    /** Reserved money actions — always null until those systems exist. */
    freezeWallet: null;
    blockPayments: null;
  };
  highestRiskAccounts: RiskEngineAccountRow[];
};

export type RiskEngineSignal = {
  id: string;
  type: RiskSignalType;
  severity: RiskSignalSeverity;
  status: RiskSignalStatus;
  details: string;
  occurredAt: string;
  accounts: Array<{
    id: string;
    username: string | null;
    userRefId: string | null;
  }>;
  autoAction: string | null;
  source: 'abuse_report' | 'account_activity' | 'moderation';
  sourceId: string | null;
};

export type RiskEngineSignalThreshold = {
  key: string;
  label: string;
  description: string;
  value: number;
  unit: string;
};

export type InvestigationCaseByType = {
  type: AbuseReportType;
  open: number;
  closed: number;
};

export type RiskEngineInvestigationsSummary = {
  openInvestigations: {
    total: number;
    openedToday: number;
  };
  casesClosed30d: {
    total: number;
    thisWeek: number;
  };
  casesByType: InvestigationCaseByType[];
  /** Reserved money KPIs — always null. */
  victimsIdentified: null;
  bvAtRisk: null;
};

export type RiskEngineInvestigationRow = {
  id: string;
  publicId: string;
  type: AbuseReportType;
  severity: AbuseReportSeverity;
  status: AbuseReportStatus;
  displayStatus: InvestigationDisplayStatus;
  summary: string;
  openedAt: string;
  suspect: {
    id: string;
    username: string | null;
    userRefId: string | null;
    profilePicture: string | null;
  } | null;
  investigator: {
    id: string;
    displayName: string;
  } | null;
  /** Reserved — always null until victim mapping exists. */
  victims: null;
  bvInvolved: null;
};

export type RiskEngineInvestigationDetail = {
  id: string;
  publicId: string;
  type: AbuseReportType;
  severity: AbuseReportSeverity;
  status: AbuseReportStatus;
  displayStatus: InvestigationDisplayStatus;
  summary: string;
  description: string;
  openedAt: string;
  tags: string[];
  suspect: {
    id: string;
    username: string | null;
    userRefId: string | null;
    profilePicture: string | null;
    status: string | null;
    countryCode: string | null;
    memberSince: string | null;
    reports: number;
    risk: UserRiskProfile | null;
  } | null;
  investigator: {
    id: string;
    displayName: string;
  } | null;
  timeline: Array<{
    id: string;
    kind: 'note' | 'system';
    body: string;
    createdAt: string;
    author: { id: string; displayName: string } | null;
  }>;
  linkedAccounts: null;
  devices: null;
  enforcement: {
    available: Array<'suspend_account' | 'resolve_and_close'>;
    reserved: Array<
      | 'require_reverification'
      | 'block_payment_methods'
      | 'freeze_wallet'
      | 'escalate_investigation'
    >;
  };
};

export type RiskEngineBadge = {
  criticalSignals: number;
  openInvestigations: number;
};

export function riskBandFromScore(score: number): RiskBand {
  if (score >= 75) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 45) return 'medium-high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function mapInvestigationDisplayStatus(
  status: AbuseReportStatus,
): InvestigationDisplayStatus {
  switch (status) {
    case AbuseReportStatus.ESCALATED:
      return 'escalated';
    case AbuseReportStatus.IN_REVIEW:
      return 'pending_review';
    case AbuseReportStatus.RESOLVED:
      return 'resolved';
    case AbuseReportStatus.OPEN:
    default:
      return 'active';
  }
}
