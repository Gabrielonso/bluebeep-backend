import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { AdminAccessService } from './admin-access.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/access/invites')
@UseGuards(JwtAuthGuard)
export class AdminInviteController {
  constructor(private readonly adminAccessService: AdminAccessService) {}

  @Post('accept')
  @ApiOperation({
    summary: 'Accept a pending admin invite for the current user',
  })
  accept(@Req() req) {
    return this.adminAccessService.acceptInvite(req.user.id);
  }
}
