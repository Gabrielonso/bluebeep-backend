import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminMembershipStatus } from './enums/admin-membership-status.enum';
import { AdminMembership } from './entities/admin-membership.entity';

@Injectable()
export class AdminSessionListener {
  private readonly logger = new Logger(AdminSessionListener.name);

  constructor(
    @InjectRepository(AdminMembership)
    private readonly membershipRepo: Repository<AdminMembership>,
  ) {}

  @OnEvent('auth.tokens.issued')
  async touch(payload: { userId?: string }) {
    if (!payload?.userId) return;
    try {
      await this.membershipRepo.update(
        {
          userId: payload.userId,
          status: AdminMembershipStatus.ACTIVE,
        },
        { lastActiveAt: new Date() },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to refresh admin session: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
