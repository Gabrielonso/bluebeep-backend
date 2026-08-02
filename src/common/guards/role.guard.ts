import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const userRole = request.user.role;

    if (!roles.some((r) => r === userRole)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'You are not authorized to use this resource',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
