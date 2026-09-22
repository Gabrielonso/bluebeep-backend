import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminSettingsService } from './admin-settings.service';

@ApiTags('Platform')
@Controller('platform')
export class PlatformController {
  constructor(private readonly adminSettingsService: AdminSettingsService) {}

  @Get('privacy-policy')
  @ApiOperation({ summary: 'Public privacy policy' })
  getPrivacyPolicy() {
    return this.adminSettingsService.getPublicPrivacyPolicy();
  }
}
