import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum AttentionUserReason {
  SUSPENDED = 'suspended',
  PENDING_MODERATION = 'pending_moderation',
  REJECTED_CONTENT = 'rejected_content',
}

export class CommandCenterAttentionUsersDto {
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
  limit?: number = 20;

  @ApiPropertyOptional({ enum: AttentionUserReason })
  @IsOptional()
  @IsEnum(AttentionUserReason)
  status?: AttentionUserReason;
}
