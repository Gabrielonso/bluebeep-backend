import { Module } from '@nestjs/common';
import { ModerationPolicyService } from './moderation-policy.service';
import { MediaModerationService } from './media-moderation.service';
import { TextModerationService } from './text-moderation.service';
import { TextModerationPolicyService } from './text-moderation-policy.service';

@Module({
  providers: [
    ModerationPolicyService,
    MediaModerationService,
    TextModerationService,
    TextModerationPolicyService,
  ],
  exports: [
    ModerationPolicyService,
    MediaModerationService,
    TextModerationService,
    TextModerationPolicyService,
  ],
})
export class ModerationModule {}
