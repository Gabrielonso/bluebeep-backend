import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { UserCreateOptions } from '../interfaces/user.interfaces';

export class CreateUserDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  profilePicture?: string;

  @IsEmail()
  email: string;

  @IsEnum(UserCreateOptions)
  createOption: UserCreateOptions;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  appleId?: string;
}
