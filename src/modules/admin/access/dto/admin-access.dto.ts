import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ADMIN_PERMISSIONS } from '../admin-permissions.catalog';
import { AdminDashboardRole } from '../enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from '../enums/admin-membership-status.enum';

const PERMISSION_KEYS = ADMIN_PERMISSIONS.map((item) => item.key).sort();

@ValidatorConstraint({ name: 'permissionGrants', async: false })
export class PermissionGrantsConstraint
  implements ValidatorConstraintInterface
{
  validate(grants: unknown): boolean {
    if (!grants || typeof grants !== 'object' || Array.isArray(grants)) {
      return false;
    }
    const record = grants as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    if (actual.length !== PERMISSION_KEYS.length) return false;
    if (actual.some((key, index) => key !== PERMISSION_KEYS[index])) {
      return false;
    }
    return Object.values(record).every((value) => typeof value === 'boolean');
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must include every permission key as a boolean`;
  }
}

export class InviteAdminDto {
  @ApiProperty({ example: 'ayaan@bluebeep.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({ enum: AdminDashboardRole })
  @IsEnum(AdminDashboardRole)
  role: AdminDashboardRole;
}

export class UpdateAdminDto {
  @ApiPropertyOptional({ enum: AdminDashboardRole })
  @IsOptional()
  @IsEnum(AdminDashboardRole)
  role?: AdminDashboardRole;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email?: string;
}

export class AdminRosterQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: AdminDashboardRole })
  @IsOptional()
  @IsEnum(AdminDashboardRole)
  role?: AdminDashboardRole;

  @ApiPropertyOptional({ enum: AdminMembershipStatus })
  @IsOptional()
  @IsEnum(AdminMembershipStatus)
  status?: AdminMembershipStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class UpdateRolePermissionsDto {
  @ApiProperty({
    description:
      'Full permission map for the role. Every catalog key is required.',
  })
  @IsObject()
  @Validate(PermissionGrantsConstraint)
  grants: Record<string, boolean>;
}

export class AdminAuditQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
