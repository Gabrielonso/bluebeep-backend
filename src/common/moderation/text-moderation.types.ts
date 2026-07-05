import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';

export enum TextModerationSurface {
  COMMENT = 'comment',
  POST = 'post',
  AD = 'ad',
  THOUGHT = 'thought',
  STATUS = 'status',
  BIO = 'bio',
}

export interface TextModerationApiResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
}

export interface TextModerationEvaluation {
  status: ModerationStatus;
  labels: Record<string, unknown>;
  moderationPending: boolean;
}

export interface TextModerationEntity {
  content?: string | null;
  contentPending?: string | null;
  textModerationStatus?: ModerationStatus | null;
}

export interface BioModerationEntity {
  bio?: string | null;
  bioPending?: string | null;
  bioModerationStatus?: ModerationStatus | null;
}
