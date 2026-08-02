import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum UserIntelligenceTab {
  ALL = 'all',
  FLAGGED = 'flagged',
  SUSPENDED = 'suspended',
  UNDER_REVIEW = 'under_review',
  /** Reserved for wallet freezes — returns empty until monetization. */
  FROZEN = 'frozen',
}

export enum UserIntelligenceSort {
  RISK_SCORE = 'risk_score',
  JOINED_DESC = 'joined_desc',
  JOINED_ASC = 'joined_asc',
}

export class UserIntelligenceQueryDto {
  @ApiPropertyOptional({ enum: UserIntelligenceTab, default: UserIntelligenceTab.ALL })
  @IsOptional()
  @IsEnum(UserIntelligenceTab)
  tab?: UserIntelligenceTab = UserIntelligenceTab.ALL;

  @ApiPropertyOptional({ description: 'Filter by country code' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'Search name, username, email, id, or userRefId',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: UserIntelligenceSort,
    default: UserIntelligenceSort.RISK_SCORE,
  })
  @IsOptional()
  @IsEnum(UserIntelligenceSort)
  sort?: UserIntelligenceSort = UserIntelligenceSort.RISK_SCORE;

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
