import { AbuseReportSeverity } from './enums/abuse-report-severity.enum';

const MS_HOUR = 60 * 60 * 1000;

/** SLA hours from severity (Critical 2h, High 6h, Medium 24h, Low 72h). */
export function slaHoursForSeverity(severity: AbuseReportSeverity): number {
  switch (severity) {
    case AbuseReportSeverity.CRITICAL:
      return 2;
    case AbuseReportSeverity.HIGH:
      return 6;
    case AbuseReportSeverity.LOW:
      return 72;
    case AbuseReportSeverity.MEDIUM:
    default:
      return 24;
  }
}

export function slaDeadlineFromSeverity(
  severity: AbuseReportSeverity,
  from: Date = new Date(),
): Date {
  return new Date(from.getTime() + slaHoursForSeverity(severity) * MS_HOUR);
}
