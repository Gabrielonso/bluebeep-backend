import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';

export class TextModerationQueryDto {
  @ApiPropertyOptional({ enum: ModerationStatus, default: ModerationStatus.PENDING })
  @IsOptional()
  @IsEnum(ModerationStatus)
  status?: ModerationStatus = ModerationStatus.PENDING;

  @ApiPropertyOptional({ enum: TextModerationSurface })
  @IsOptional()
  @IsEnum(TextModerationSurface)
  entity?: TextModerationSurface;

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
}
