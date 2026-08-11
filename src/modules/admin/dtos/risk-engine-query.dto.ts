import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AbuseReportStatus } from 'src/modules/reports/enums/abuse-report-status.enum';
import { AbuseReportType } from 'src/modules/reports/enums/abuse-report-type.enum';

export enum RiskEngineInvestigationSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
}

/** Optional presets for signal history. Prefer `from` + `to` for custom ranges. */
export enum RiskEngineSignalHistoryRangePreset {
  HOURS_24 = '24h',
  DAYS_7 = '7d',
  DAYS_30 = '30d',
}

export class RiskEngineOverviewQueryDto {
  @ApiPropertyOptional({
    default: 10,
    description: 'Number of highest-risk accounts to include',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

export class RiskEngineSignalsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * Signal history window.
 *
 * Preferred: ISO `from` + `to` (half-open `[from, to)`).
 * Optional: `range=24h|7d|30d` relative to now.
 * Default (nothing passed): all time.
 * If both preset and from/to are sent, from/to win.
 */
export class RiskEngineSignalHistoryQueryDto extends RiskEngineSignalsQueryDto {
  @ApiPropertyOptional({
    description:
      'Window start (inclusive). ISO 8601 datetime or date (YYYY-MM-DD).',
    example: '2026-06-23T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Window end (exclusive). ISO 8601 datetime or date (YYYY-MM-DD).',
    example: '2026-06-24T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: RiskEngineSignalHistoryRangePreset,
    description:
      'Optional preset shorthand. Ignored when `from` or `to` is provided. If omitted with no from/to, all-time is used.',
    example: RiskEngineSignalHistoryRangePreset.HOURS_24,
  })
  @IsOptional()
  @IsEnum(RiskEngineSignalHistoryRangePreset)
  range?: RiskEngineSignalHistoryRangePreset;
}

export class RiskEngineInvestigationsQueryDto {
  @ApiPropertyOptional({ enum: AbuseReportType })
  @IsOptional()
  @IsEnum(AbuseReportType)
  type?: AbuseReportType;

  @ApiPropertyOptional({ enum: AbuseReportStatus })
  @IsOptional()
  @IsEnum(AbuseReportStatus)
  status?: AbuseReportStatus;

  @ApiPropertyOptional({
    description: 'Search publicId, summary, or suspect username',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: RiskEngineInvestigationSort,
    default: RiskEngineInvestigationSort.NEWEST,
  })
  @IsOptional()
  @IsEnum(RiskEngineInvestigationSort)
  sort?: RiskEngineInvestigationSort = RiskEngineInvestigationSort.NEWEST;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
