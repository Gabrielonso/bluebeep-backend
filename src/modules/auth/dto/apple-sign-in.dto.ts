import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AppleSignInDto {
  @ApiProperty({
    description: 'Apple identity token (JWT) from Sign in with Apple',
    example: 'eyJraWQiOiJlWGF1bm1...',
  })
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @ApiPropertyOptional({
    description:
      'Given name from Apple (only provided on first authorization consent)',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    description:
      'Family name from Apple (only provided on first authorization consent)',
  })
  @IsOptional()
  @IsString()
  lastName?: string;
}
