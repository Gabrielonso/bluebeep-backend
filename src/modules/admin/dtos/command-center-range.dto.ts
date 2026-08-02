import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

/** Optional UI presets. Prefer `from` + `to` for custom ranges. */
export enum CommandCenterRangePreset {
  HOURS_24 = '24h',
  DAYS_7 = '7d',
  DAYS_30 = '30d',
}

/**
 * Time window for Command Center metrics.
 *
 * Preferred: pass ISO `from` + `to` (half-open interval `[from, to)`).
 * Date-only values like `2026-06-23` are treated as UTC midnight, so
 * `from=2026-06-23&to=2026-06-24` is exactly one day (24h).
 * Multi-year ranges are allowed.
 *
 * Optional: `range=24h|7d|30d` relative to now.
 * Default when nothing is passed: **all time** (platform history so far).
 *
 * Activity-series auto-buckets by window length:
 * ≤48h → hour | ≤90d → day | ≤3y → month | longer → year.
 *
 * If both preset and from/to are sent, from/to win.
 */
export class CommandCenterRangeDto {
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
    enum: CommandCenterRangePreset,
    description:
      'Optional preset shorthand. Ignored when `from` or `to` is provided. If omitted with no from/to, all-time is used.',
    example: CommandCenterRangePreset.HOURS_24,
  })
  @IsOptional()
  @IsEnum(CommandCenterRangePreset)
  range?: CommandCenterRangePreset;
}
