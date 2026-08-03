import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AbuseReportStatus } from 'src/modules/reports/enums/abuse-report-status.enum';
import { AbuseReportType } from 'src/modules/reports/enums/abuse-report-type.enum';

export enum TrustQueueTypeFilter {
  ALL = 'all',
  ABUSE = AbuseReportType.ABUSE,
  HARASSMENT = AbuseReportType.HARASSMENT,
  IMPERSONATION = AbuseReportType.IMPERSONATION,
  STAGE_MISCONDUCT = AbuseReportType.STAGE_MISCONDUCT,
  SCAM = AbuseReportType.SCAM,
}

export enum TrustQueueSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
}

export class TrustQueueQueryDto {
  @ApiPropertyOptional({
    enum: TrustQueueTypeFilter,
    default: TrustQueueTypeFilter.ALL,
  })
  @IsOptional()
  @IsEnum(TrustQueueTypeFilter)
  type?: TrustQueueTypeFilter = TrustQueueTypeFilter.ALL;

  @ApiPropertyOptional({ enum: AbuseReportStatus })
  @IsOptional()
  @IsEnum(AbuseReportStatus)
  status?: AbuseReportStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'Search publicId, usernames, or summary',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: TrustQueueSort, default: TrustQueueSort.NEWEST })
  @IsOptional()
  @IsEnum(TrustQueueSort)
  sort?: TrustQueueSort = TrustQueueSort.NEWEST;

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
