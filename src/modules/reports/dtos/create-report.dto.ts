import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AbuseReportSeverity } from '../enums/abuse-report-severity.enum';
import { AbuseReportTargetType } from '../enums/abuse-report-target-type.enum';
import { AbuseReportType } from '../enums/abuse-report-type.enum';

export class CreateReportDto {
  @ApiProperty({ description: 'User being reported' })
  @IsUUID()
  reportedUserId: string;

  @ApiPropertyOptional({
    enum: AbuseReportTargetType,
    description:
      'Content the report is about. Must be sent together with targetId.',
  })
  @ValidateIf(
    (o: CreateReportDto) => o.targetType != null || o.targetId != null,
  )
  @IsEnum(AbuseReportTargetType)
  targetType?: AbuseReportTargetType;

  @ApiPropertyOptional({
    description:
      'ID of the post, comment, thought, status, livestream, message, or ad. Must be sent together with targetType.',
  })
  @ValidateIf(
    (o: CreateReportDto) => o.targetType != null || o.targetId != null,
  )
  @IsUUID()
  targetId?: string;

  @ApiProperty({ enum: AbuseReportType })
  @IsEnum(AbuseReportType)
  type: AbuseReportType;

  @ApiProperty({ example: 'Threatening messages during livestream' })
  @IsString()
  @MinLength(3)
  @MaxLength(280)
  summary: string;

  @ApiProperty({ example: 'Full description of the incident...' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional({ enum: AbuseReportSeverity })
  @IsOptional()
  @IsEnum(AbuseReportSeverity)
  severity?: AbuseReportSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  liveStreamId?: string;

  @ApiPropertyOptional({ example: 'royalstage_room3' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  roomKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  viewerCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordingSaved?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  evidenceUrls?: string[];
}
