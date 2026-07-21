import {
  Controller,
  Get,
  Res,
  UseGuards,
  Query,
  Req,
  Post,
  Body,
  Patch,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SignupUserDto } from './dto/signup-user.dto';
import { ResendEmailOtpDto, VerifyEmailDto } from './dto/user-verification.dto';
import { LoginUserDto } from './dto/login-user.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password-recovery.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { Public } from 'src/common/decorators/public.decorator';
import { GoogleAuthGuard } from 'src/common/guards/google-auth.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('/google')
  @ApiOperation({ summary: 'Sign in with Google ID token (mobile)' })
  @ApiBody({ type: GoogleSignInDto })
  async googleSignIn(@Body() googleSignInDto: GoogleSignInDto) {
    return this.authService.signInWithGoogle(googleSignInDto);
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/web')
  @ApiOperation({ summary: 'Start Google OAuth (web)' })
  googleWebLogin() {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/web/callback')
  @ApiOperation({ summary: 'Google OAuth callback (web)' })
  async googleWebCallback(@Req() req, @Res() res: Response) {
    await this.authService.handleGoogleCallback(req.user, res);
  }

  @Post('/signup')
  @ApiOperation({ summary: 'Signup as a new user' })
  @ApiBody({ type: SignupUserDto })
  async signup(@Body() signUpUserDto: SignupUserDto) {
    return this.authService.signUp(signUpUserDto);
  }

  @Post('/verify-signup-email')
  @ApiOperation({ summary: `Verify signup email OTP` })
  @ApiBody({ type: VerifyEmailDto })
  async verifySignUpEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifySignUpEmailOtp(verifyEmailDto);
  }

  @Get('/resend-email-otp')
  @ApiOperation({ summary: `Resend email OTP` })
  @ApiBody({ type: ResendEmailOtpDto })
  @ApiQuery({ name: 'email', description: 'email of the user' })
  async resendEmailOtp(@Query() resendEmailDto: ResendEmailOtpDto) {
    return this.authService.resendVerifyOtp(resendEmailDto.email);
  }

  @Post('/login')
  @ApiOperation({ summary: `Login with email and password` })
  @ApiBody({ type: LoginUserDto })
  async login(@Body() loginUserDto: LoginUserDto) {
    return this.authService.login(loginUserDto);
  }

  @Post('/forgot-password')
  @ApiOperation({ summary: `Initiate forgot password request` })
  @ApiBody({ type: ForgotPasswordDto })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('/reset-password')
  @ApiOperation({ summary: `Reset password with OTP` })
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('/change-password')
  @ApiOperation({ summary: `Change existing Password` })
  @ApiBody({ type: ChangePasswordDto })
  @ApiBearerAuth()
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req,
  ) {
    const userId = req.user.id;
    return this.authService.changePassword(userId, changePasswordDto);
  }
}
