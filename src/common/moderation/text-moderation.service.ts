import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { openaiConfig } from 'src/config/openai.config';
import { TextModerationApiResult } from './text-moderation.types';

interface OpenAiModerationResponse {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
}

@Injectable()
export class TextModerationService {
  private readonly logger = new Logger(TextModerationService.name);

  async moderate(text: string): Promise<TextModerationApiResult> {
    const trimmed = text?.trim();
    if (!trimmed) {
      return {
        flagged: false,
        categories: {},
        categoryScores: {},
      };
    }

    if (!openaiConfig.apiKey) {
      this.logger.warn('OPENAI_API_KEY is not configured');
      throw new Error('OpenAI API key is not configured');
    }

    const response = await axios.post<OpenAiModerationResponse>(
      openaiConfig.moderation.apiUrl,
      {
        model: openaiConfig.moderation.model,
        input: trimmed,
      },
      {
        headers: {
          Authorization: `Bearer ${openaiConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    const result = response.data.results?.[0];
    if (!result) {
      throw new Error('OpenAI moderation returned no results');
    }

    return {
      flagged: Boolean(result.flagged),
      categories: result.categories ?? {},
      categoryScores: result.category_scores ?? {},
    };
  }
}
