import { UserRoles } from '../enums/user-roles.constants';
import { ModerationStatus } from '../../modules/media/enums/moderation-status.enum';
import {
  isPublicTextVisible,
  isTextModerationVisible,
  resolveDisplayBio,
  resolveDisplayText,
  textModerationVisibleSql,
} from './text-moderation-visibility.util';

describe('text-moderation-visibility.util', () => {
  it('builds aliased SQL fragment', () => {
    expect(textModerationVisibleSql('p')).toBe(
      "(p.text_moderation_status IS NULL OR p.text_moderation_status IN ('passed', 'skipped'))",
    );
  });

  it('treats passed and legacy statuses as public', () => {
    expect(isPublicTextVisible(null)).toBe(true);
    expect(isPublicTextVisible(ModerationStatus.PASSED)).toBe(true);
    expect(isPublicTextVisible(ModerationStatus.PENDING)).toBe(false);
  });

  it('allows owners and admins to see pending text', () => {
    expect(
      isTextModerationVisible(
        ModerationStatus.PENDING,
        'owner-1',
        'owner-1',
      ),
    ).toBe(true);
    expect(
      isTextModerationVisible(
        ModerationStatus.PENDING,
        'owner-1',
        'viewer-2',
        UserRoles.ADMIN,
      ),
    ).toBe(true);
    expect(
      isTextModerationVisible(
        ModerationStatus.PENDING,
        'owner-1',
        'viewer-2',
      ),
    ).toBe(false);
  });

  it('resolves pending display text for owners', () => {
    const display = resolveDisplayText(
      {
        content: 'old caption',
        contentPending: 'new caption',
        textModerationStatus: ModerationStatus.PENDING,
      },
      'owner-1',
      'owner-1',
    );

    expect(display.content).toBe('new caption');
    expect(display.moderationPending).toBe(true);
  });

  it('hides pending bio from other viewers', () => {
    const display = resolveDisplayBio(
      {
        bio: 'approved bio',
        bioPending: 'pending bio',
        bioModerationStatus: ModerationStatus.PENDING,
      },
      'owner-1',
      'viewer-2',
    );

    expect(display.bio).toBeNull();
    expect(display.bioModerationPending).toBe(false);
  });
});
