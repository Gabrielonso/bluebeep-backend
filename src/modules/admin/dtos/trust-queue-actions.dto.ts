import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AbuseReportResolutionOutcome } from 'src/modules/reports/enums/abuse-report-resolution.enum';

export class TrustQueueReassignDto {
  @ApiProperty()
  @IsUUID()
  assigneeId: string;
}

export class TrustQueueResolveDto {
  @ApiProperty({ enum: AbuseReportResolutionOutcome })
  @IsEnum(AbuseReportResolutionOutcome)
  outcome: AbuseReportResolutionOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class TrustQueueAddNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;
}
