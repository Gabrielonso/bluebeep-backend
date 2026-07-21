import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleSignInDto {
  @ApiProperty({
    description: 'Google ID token from the mobile Sign-In SDK',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
