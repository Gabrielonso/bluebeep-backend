import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { AdminAuditAction } from './admin-permissions.catalog';
import { AdminActor, isValidIp, normalizeIp } from './admin-request.util';
import {
  UpdateConfigurationDto,
  UpdateNotificationSettingsDto,
  UpdatePlatformSettingsDto,
  UpdatePrivacyPolicyDto,
} from './dto/admin-settings.dto';
import { AdminMembershipStatus } from './enums/admin-membership-status.enum';
import { AdminAuditEvent } from './entities/admin-audit-event.entity';
import { AdminMembership } from './entities/admin-membership.entity';
import { PlatformSettings } from './entities/platform-settings.entity';
import {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTINGS_ID,
} from './platform-settings.defaults';

@Injectable()
export class AdminSettingsService {
  constructor(
    @InjectRepository(PlatformSettings)
    private readonly settingsRepo: Repository<PlatformSettings>,
    @InjectRepository(AdminAuditEvent)
    private readonly auditRepo: Repository<AdminAuditEvent>,
    @InjectRepository(AdminMembership)
    private readonly membershipRepo: Repository<AdminMembership>,
    private readonly configService: ConfigService,
  ) {}

  async getPlatform() {
    const settings = await this.getOrCreate();
    return successResponse('Operation successful', this.platformView(settings));
  }

  async updatePlatform(dto: UpdatePlatformSettingsDto, actor: AdminActor) {
    const settings = await this.getOrCreate();
    if (dto.platformName !== undefined) {
      settings.platformName = dto.platformName.trim();
    }
    if (dto.logoUrl !== undefined) settings.logoUrl = dto.logoUrl;
    if (dto.supportEmail !== undefined) {
      settings.supportEmail = dto.supportEmail
        ? dto.supportEmail.trim().toLowerCase()
        : null;
    }
    if (dto.supportPhone !== undefined) {
      settings.supportPhone = dto.supportPhone?.trim() || null;
    }
    settings.updatedById = actor.id;
    await this.settingsRepo.save(settings);
    await this.audit(actor, 'platform');
    return successResponse(
      'Platform settings saved',
      this.platformView(settings),
    );
  }

  async getNotifications() {
    const settings = await this.getOrCreate();
    return successResponse(
      'Operation successful',
      this.notificationView(settings),
    );
  }

  async updateNotifications(
    dto: UpdateNotificationSettingsDto,
    actor: AdminActor,
  ) {
    const settings = await this.getOrCreate();
    if (dto.emailNotifications !== undefined) {
      settings.emailNotificationsEnabled = dto.emailNotifications;
    }
    if (dto.pushNotifications !== undefined) {
      settings.pushNotificationsEnabled = dto.pushNotifications;
    }
    if (dto.smsNotifications !== undefined) {
      settings.smsNotificationsEnabled = dto.smsNotifications;
    }
    settings.updatedById = actor.id;
    await this.settingsRepo.save(settings);
    await this.audit(actor, 'notifications');
    return successResponse(
      'Notification settings saved',
      this.notificationView(settings),
    );
  }

  async getPrivacyPolicy() {
    const settings = await this.getOrCreate();
    return successResponse('Operation successful', {
      body: settings.privacyPolicy ?? '',
    });
  }

  async updatePrivacyPolicy(dto: UpdatePrivacyPolicyDto, actor: AdminActor) {
    const settings = await this.getOrCreate();
    settings.privacyPolicy = dto.body;
    settings.updatedById = actor.id;
    await this.settingsRepo.save(settings);
    await this.audit(actor, 'privacy_policy');
    return successResponse('Privacy policy saved', {
      body: settings.privacyPolicy,
    });
  }

  async getPublicPrivacyPolicy() {
    const settings = await this.settingsRepo.findOne({
      where: { id: PLATFORM_SETTINGS_ID },
    });
    return successResponse('Operation successful', {
      body: settings?.privacyPolicy ?? '',
    });
  }

  async getConfiguration() {
    const settings = await this.getOrCreate();
    return successResponse(
      'Operation successful',
      this.configurationView(settings),
    );
  }

  async updateConfiguration(dto: UpdateConfigurationDto, actor: AdminActor) {
    const settings = await this.getOrCreate();
    if (dto.security) {
      if (dto.security.require2fa !== undefined) {
        settings.require2fa = dto.security.require2fa;
      }
      if (dto.security.sessionTimeoutMinutes !== undefined) {
        settings.sessionTimeoutMinutes = dto.security.sessionTimeoutMinutes;
      }
      if (dto.security.ipAllowlistEnabled !== undefined) {
        settings.ipAllowlistEnabled = dto.security.ipAllowlistEnabled;
      }
      if (dto.security.ipAllowlist !== undefined) {
        settings.ipAllowlist = this.normalizeAllowlist(
          dto.security.ipAllowlist,
        );
      }
      if (dto.security.loginAttemptAlertsEnabled !== undefined) {
        settings.loginAttemptAlertsEnabled =
          dto.security.loginAttemptAlertsEnabled;
      }
    }
    if (dto.adminNotifications) {
      const notes = dto.adminNotifications;
      if (notes.highSeverityRisk !== undefined) {
        settings.notifyHighSeverityRisk = notes.highSeverityRisk;
      }
      if (notes.newDispute !== undefined) {
        settings.notifyNewDispute = notes.newDispute;
      }
      if (notes.payoutDigest !== undefined) {
        settings.notifyPayoutDigest = notes.payoutDigest;
      }
      if (notes.failedLogin !== undefined) {
        settings.notifyFailedLogin = notes.failedLogin;
      }
      if (notes.weeklyReport !== undefined) {
        settings.notifyWeeklyReport = notes.weeklyReport;
      }
    }
    if (dto.thresholds) {
      const thresholds = dto.thresholds;
      if (thresholds.autoFreezeWalletRiskScore !== undefined) {
        settings.autoFreezeWalletRiskScore =
          thresholds.autoFreezeWalletRiskScore;
      }
      if (thresholds.autoEscalateDisputeAbove !== undefined) {
        settings.autoEscalateDisputeAbove = thresholds.autoEscalateDisputeAbove;
      }
      if (thresholds.payoutManualReviewThreshold !== undefined) {
        settings.payoutManualReviewThreshold =
          thresholds.payoutManualReviewThreshold;
      }
      if (thresholds.giftRingDetectionWindowHours !== undefined) {
        settings.giftRingDetectionWindowHours =
          thresholds.giftRingDetectionWindowHours;
      }
    }

    settings.updatedById = actor.id;
    await this.settingsRepo.save(settings);
    await this.audit(actor, 'configuration');
    return successResponse(
      'Configuration saved',
      this.configurationView(settings),
    );
  }

  private normalizeAllowlist(values: string[]) {
    const normalized = values
      .map((value) => normalizeIp(value))
      .filter(Boolean);
    const invalid = normalized.filter((value) => !isValidIp(value));
    if (invalid.length) {
      throw new BadRequestException(`Invalid IP address: ${invalid[0]}`);
    }
    return [...new Set(normalized)];
  }

  private platformView(settings: PlatformSettings) {
    return {
      platformName: settings.platformName,
      logoUrl: settings.logoUrl,
      supportEmail: settings.supportEmail,
      supportPhone: settings.supportPhone,
    };
  }

  private notificationView(settings: PlatformSettings) {
    return {
      emailNotifications: settings.emailNotificationsEnabled,
      pushNotifications: settings.pushNotificationsEnabled,
      smsNotifications: settings.smsNotificationsEnabled,
    };
  }

  private configurationView(settings: PlatformSettings) {
    const allowlist = settings.ipAllowlist ?? [];
    return {
      security: {
        require2fa: settings.require2fa,
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        ipAllowlistEnabled: settings.ipAllowlistEnabled,
        ipAllowlist: allowlist,
        enforced: settings.ipAllowlistEnabled && allowlist.length > 0,
        loginAttemptAlertsEnabled: settings.loginAttemptAlertsEnabled,
      },
      adminNotifications: {
        highSeverityRisk: settings.notifyHighSeverityRisk,
        newDispute: settings.notifyNewDispute,
        payoutDigest: settings.notifyPayoutDigest,
        failedLogin: settings.notifyFailedLogin,
        weeklyReport: settings.notifyWeeklyReport,
      },
      thresholds: {
        autoFreezeWalletRiskScore: Number(settings.autoFreezeWalletRiskScore),
        autoEscalateDisputeAbove: Number(settings.autoEscalateDisputeAbove),
        payoutManualReviewThreshold: Number(
          settings.payoutManualReviewThreshold,
        ),
        giftRingDetectionWindowHours: Number(
          settings.giftRingDetectionWindowHours,
        ),
      },
      platformInfo: {
        version: this.configService.get<string>('APP_VERSION') || '0.0.1',
        lastDeploy: settings.updatedAt,
        environment:
          this.configService.get<string>('NODE_ENV') || 'development',
        uptimeSeconds: Math.floor(process.uptime()),
        dataRegion:
          this.configService.get<string>('DATA_REGION') || 'unspecified',
      },
    };
  }

  private async getOrCreate() {
    const existing = await this.settingsRepo.findOne({
      where: { id: PLATFORM_SETTINGS_ID },
    });
    if (existing) return existing;
    return this.settingsRepo.save(
      this.settingsRepo.create({ ...DEFAULT_PLATFORM_SETTINGS }),
    );
  }

  private async audit(actor: AdminActor, section: string) {
    const membership = await this.membershipRepo.findOne({
      where: { userId: actor.id, status: AdminMembershipStatus.ACTIVE },
    });
    await this.auditRepo.save(
      this.auditRepo.create({
        actorUserId: actor.id,
        actorMembershipId: membership?.id ?? null,
        action: AdminAuditAction.SETTINGS_UPDATED,
        targetType: 'platform_settings',
        targetId: String(PLATFORM_SETTINGS_ID),
        metadata: { section },
      }),
    );
  }
}
