import * as dotenv from 'dotenv';

dotenv.config();

export const openaiConfig = {
  apiKey: process.env.OPENAI_API_KEY ?? '',
  moderation: {
    enabled: process.env.TEXT_MODERATION_ENABLED !== 'false',
    model: process.env.OPENAI_MODERATION_MODEL ?? 'omni-moderation-latest',
    failClosed: process.env.TEXT_MODERATION_FAIL_CLOSED !== 'false',
    apiUrl:
      process.env.OPENAI_MODERATION_API_URL ??
      'https://api.openai.com/v1/moderations',
  },
};
