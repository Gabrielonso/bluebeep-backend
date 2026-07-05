import { UserRoles } from 'src/common/enums/user-roles.constants';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import {
  BioModerationEntity,
  TextModerationEntity,
} from './text-moderation.types';

export const TEXT_MODERATION_VISIBLE_SQL =
  "(text_moderation_status IS NULL OR text_moderation_status IN ('passed', 'skipped'))";

export function textModerationVisibleSql(alias?: string): string {
  const column = alias
    ? `${alias}.text_moderation_status`
    : 'text_moderation_status';
  return `(${column} IS NULL OR ${column} IN ('passed', 'skipped'))`;
}

export function isAdminRole(role?: string | null): boolean {
  return role === UserRoles.ADMIN || role === UserRoles.SUPER_ADMIN;
}

export function isTextModerationVisible(
  status: ModerationStatus | null | undefined,
  ownerId: string | undefined,
  viewerId: string | undefined,
  viewerRole?: string | null,
): boolean {
  if (
    status == null ||
    status === ModerationStatus.PASSED ||
    status === ModerationStatus.SKIPPED
  ) {
    return true;
  }

  if (isAdminRole(viewerRole)) {
    return true;
  }

  if (viewerId && ownerId && viewerId === ownerId) {
    return true;
  }

  return false;
}

export function isBioModerationVisible(
  status: ModerationStatus | null | undefined,
  ownerId: string | undefined,
  viewerId: string | undefined,
  viewerRole?: string | null,
): boolean {
  return isTextModerationVisible(status, ownerId, viewerId, viewerRole);
}

export function resolveDisplayText(
  entity: TextModerationEntity,
  ownerId: string | undefined,
  viewerId: string | undefined,
  viewerRole?: string | null,
): {
  content: string | null;
  moderationPending: boolean;
  textModerationStatus?: ModerationStatus | null;
} {
  const status = entity.textModerationStatus ?? null;
  const canSeePending = isTextModerationVisible(
    status,
    ownerId,
    viewerId,
    viewerRole,
  );

  if (!canSeePending) {
    return {
      content: null,
      moderationPending: false,
      textModerationStatus: status,
    };
  }

  if (status === ModerationStatus.PENDING && entity.contentPending) {
    return {
      content: entity.contentPending,
      moderationPending: true,
      textModerationStatus: status,
    };
  }

  if (status === ModerationStatus.PENDING) {
    return {
      content: entity.content ?? null,
      moderationPending: true,
      textModerationStatus: status,
    };
  }

  return {
    content: entity.content ?? null,
    moderationPending: false,
    textModerationStatus: status,
  };
}

export function resolveDisplayBio(
  entity: BioModerationEntity,
  ownerId: string | undefined,
  viewerId: string | undefined,
  viewerRole?: string | null,
): {
  bio: string | null;
  bioModerationPending: boolean;
  bioModerationStatus?: ModerationStatus | null;
} {
  const status = entity.bioModerationStatus ?? null;
  const canSeePending = isBioModerationVisible(
    status,
    ownerId,
    viewerId,
    viewerRole,
  );

  if (!canSeePending) {
    return {
      bio: null,
      bioModerationPending: false,
      bioModerationStatus: status,
    };
  }

  if (status === ModerationStatus.PENDING && entity.bioPending) {
    return {
      bio: entity.bioPending,
      bioModerationPending: true,
      bioModerationStatus: status,
    };
  }

  if (status === ModerationStatus.PENDING) {
    return {
      bio: entity.bio ?? null,
      bioModerationPending: true,
      bioModerationStatus: status,
    };
  }

  return {
    bio: entity.bio ?? null,
    bioModerationPending: false,
    bioModerationStatus: status,
  };
}

export function isPublicTextVisible(
  status: ModerationStatus | null | undefined,
): boolean {
  return (
    status == null ||
    status === ModerationStatus.PASSED ||
    status === ModerationStatus.SKIPPED
  );
}
