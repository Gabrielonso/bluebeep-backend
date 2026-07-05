import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { TextModerationService } from './text-moderation.service';

jest.mock('axios');
jest.mock('../../config/openai.config', () => ({
  openaiConfig: {
    apiKey: 'test-key',
    moderation: {
      enabled: true,
      model: 'omni-moderation-latest',
      failClosed: true,
      apiUrl: 'https://api.openai.com/v1/moderations',
    },
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TextModerationService', () => {
  let service: TextModerationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TextModerationService],
    }).compile();

    service = module.get(TextModerationService);
  });

  it('returns not flagged for empty text', async () => {
    const result = await service.moderate('   ');
    expect(result.flagged).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns flagged result from OpenAI', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        results: [
          {
            flagged: true,
            categories: { harassment: true },
            category_scores: { harassment: 0.99 },
          },
        ],
      },
    });

    const result = await service.moderate('offensive text');
    expect(result.flagged).toBe(true);
    expect(result.categories.harassment).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/moderations'),
      expect.objectContaining({ input: 'offensive text' }),
      expect.any(Object),
    );
  });

  it('throws when API key is missing', async () => {
    const { openaiConfig } = await import('../../config/openai.config');
    const originalKey = openaiConfig.apiKey;
    openaiConfig.apiKey = '';
    await expect(service.moderate('hello')).rejects.toThrow(
      'OpenAI API key is not configured',
    );
    openaiConfig.apiKey = originalKey;
  });
});
