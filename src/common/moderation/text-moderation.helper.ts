import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { TextModerationEvaluation } from './text-moderation.types';

export interface TextModerationFields {
  content?: string;
  contentPending?: string;
  textModerationStatus?: ModerationStatus;
  textModerationLabels?: Record<string, unknown>;
  textModeratedAt?: Date;
}

export interface BioModerationFields {
  bio?: string;
  bioPending?: string;
  bioModerationStatus?: ModerationStatus;
  bioModerationLabels?: Record<string, unknown>;
  bioModeratedAt?: Date;
}

export function buildTextModerationMeta(
  evaluation: TextModerationEvaluation,
): Pick<
  TextModerationFields,
  'textModerationStatus' | 'textModerationLabels' | 'textModeratedAt'
> {
  return {
    textModerationStatus: evaluation.status,
    textModerationLabels: evaluation.labels,
    textModeratedAt: new Date(),
  };
}

export function buildCreateTextFields(
  evaluation: TextModerationEvaluation,
  content: string,
): TextModerationFields {
  return {
    content,
    textModerationStatus: evaluation.status,
    textModerationLabels: evaluation.labels,
    textModeratedAt: new Date(),
  };
}

export function buildUpdateTextFields(
  evaluation: TextModerationEvaluation,
  newContent: string,
  existingContent?: string | null,
): TextModerationFields {
  if (evaluation.moderationPending) {
    return {
      content: existingContent ?? undefined,
      contentPending: newContent,
      textModerationStatus: evaluation.status,
      textModerationLabels: evaluation.labels,
      textModeratedAt: new Date(),
    };
  }

  return {
    content: newContent,
    contentPending: undefined,
    textModerationStatus: evaluation.status,
    textModerationLabels: evaluation.labels,
    textModeratedAt: new Date(),
  };
}

export function buildBioUpdateFields(
  evaluation: TextModerationEvaluation,
  newBio: string,
  existingBio?: string | null,
): BioModerationFields {
  if (evaluation.moderationPending) {
    return {
      bio: existingBio ?? undefined,
      bioPending: newBio,
      bioModerationStatus: evaluation.status,
      bioModerationLabels: evaluation.labels,
      bioModeratedAt: new Date(),
    };
  }

  return {
    bio: newBio,
    bioPending: undefined,
    bioModerationStatus: evaluation.status,
    bioModerationLabels: evaluation.labels,
    bioModeratedAt: new Date(),
  };
}

export function moderationSuccessMessage(
  baseMessage: string,
  moderationPending: boolean,
): string {
  if (!moderationPending) {
    return baseMessage;
  }
  return `${baseMessage}. Your content is pending review.`;
}
