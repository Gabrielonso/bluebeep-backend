import { Injectable } from '@nestjs/common';
import { openaiConfig } from 'src/config/openai.config';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { TextModerationService } from './text-moderation.service';
import {
  TextModerationApiResult,
  TextModerationEvaluation,
  TextModerationSurface,
} from './text-moderation.types';

@Injectable()
export class TextModerationPolicyService {
  constructor(private readonly textModerationService: TextModerationService) {}

  shouldModerate(_surface: TextModerationSurface): boolean {
    return openaiConfig.moderation.enabled;
  }

  resolveStatus(result: TextModerationApiResult): ModerationStatus {
    if (!openaiConfig.moderation.enabled) {
      return ModerationStatus.SKIPPED;
    }
    return result.flagged ? ModerationStatus.PENDING : ModerationStatus.PASSED;
  }

  buildLabels(result: TextModerationApiResult): Record<string, unknown> {
    return {
      flagged: result.flagged,
      categories: result.categories,
      categoryScores: result.categoryScores,
    };
  }

  async evaluateText(
    text: string | undefined | null,
    surface: TextModerationSurface,
  ): Promise<TextModerationEvaluation> {
    const trimmed = text?.trim();
    if (!trimmed) {
      return {
        status: ModerationStatus.SKIPPED,
        labels: { skipped: true, reason: 'empty_text' },
        moderationPending: false,
      };
    }

    if (!this.shouldModerate(surface)) {
      return {
        status: ModerationStatus.SKIPPED,
        labels: { skipped: true, reason: 'disabled' },
        moderationPending: false,
      };
    }

    try {
      const result = await this.textModerationService.moderate(trimmed);
      const status = this.resolveStatus(result);
      return {
        status,
        labels: this.buildLabels(result),
        moderationPending: status === ModerationStatus.PENDING,
      };
    } catch (error) {
      if (openaiConfig.moderation.failClosed) {
        return {
          status: ModerationStatus.PENDING,
          labels: {
            flagged: true,
            error: error instanceof Error ? error.message : String(error),
            reason: 'moderation_unavailable',
          },
          moderationPending: true,
        };
      }

      return {
        status: ModerationStatus.SKIPPED,
        labels: {
          skipped: true,
          reason: 'moderation_unavailable',
          error: error instanceof Error ? error.message : String(error),
        },
        moderationPending: false,
      };
    }
  }

  combineText(parts: Array<string | undefined | null>): string {
    return parts
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join('\n');
  }
}
