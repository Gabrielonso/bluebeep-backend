import {
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from 'src/modules/user/dto/create-user.dto';
import { UserService } from 'src/modules/user/user.service';
import {
  UserCreateOptions,
  UserStatusEnum,
} from 'src/modules/user/interfaces/user.interfaces';
import axios from 'axios';
import * as qs from 'querystring';
import { Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import {
  TikTokTokenResponse,
  TikTokUserInfo,
} from '../../common/interfaces/tik-tok.interface';
import { SignupUserDto } from './dto/signup-user.dto';
import { DataSource, Repository } from 'typeorm';
import { User } from 'src/modules/user/entity/user.entity';
import { generateOtp } from 'src/common/utils/globals';
import { VerifyEmailDto } from './dto/user-verification.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { InvalidCredentialsExceptions } from '../../common/exceptions/invalid-credentials.exception';
import {
  ChangePasswordDto,
  ResetPasswordDto,
} from './dto/password-recovery.dto';
import { compare, hash } from 'bcryptjs';
import { JWTTokens } from '../../common/interfaces/jwt.interface';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { baseUsername } from 'src/common/utils/utilityFunctions';
import { customAlphabet } from 'nanoid';
import { AccountActivityService } from '../account-activity/account-activity.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobQueue, JobType } from 'src/common/enums/jobs.enum';

const EMAIL_TEMPLATES = {
  VERIFY_EMAIL_OTP:
    '2d6f.11a8fc9fee352c53.k1.df1fb710-8386-11f1-89fd-525400a229b1.19f7b00b501',
  WELCOME:
    '2d6f.11a8fc9fee352c53.k1.268e4e40-8387-11f1-89fd-525400a229b1.19f7b028924',
  PASSWORD_RESET_OTP:
    '2d6f.11a8fc9fee352c53.k1.4c8f9d60-8387-11f1-89fd-525400a229b1.19f7b038236',
};

const EMAIL_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: false,
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 3000,
  },
};

@Injectable()
export class AuthService {
  private nanoid: any;
  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private jwtService: JwtService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private readonly accountActivityService: AccountActivityService,
    @InjectQueue(JobQueue.EMAILS)
    private readonly emailQueue: Queue,
  ) {
    const alphabet = '0123456789';
    this.nanoid = customAlphabet(alphabet, 16);
  }

  async validateGoogleUser(googleUser: CreateUserDto) {
    const user = await this.userService.findByEmail(googleUser.email);
    if (user) return user;

    return await this.userService.create(googleUser);
  }

  async handleGoogleCallback(user: User, res: Response) {
    const data = await this.getTokens(user);
    console.log(data);
    res.redirect(`http://localhost:5173?token=${data.token}`);
  }

  handleTikTokLogin(res: Response) {
    try {
      const csrfState = Math.random().toString(36).substring(2);
      res.cookie('csrfState', csrfState, { maxAge: 60000 });

      const clientKey = this.configService.get<string>('TIKTOK_CLIENT_KEY');
      const redirectUri = this.configService.get<string>('TIKTOK_REDIRECT_URI');

      let url = 'https://www.tiktok.com/v2/auth/authorize/';
      url += `?client_key=${clientKey}`;
      url +=
        '&scope=user.info.basic,user.info.profile,user.info.stats,video.list';
      url += '&response_type=code';
      url += `&redirect_uri=${redirectUri}`;
      url += `&state=${csrfState}`;

      res.json({ url: url });
    } catch (error) {
      throw error;
    }
  }

  private base64URLEncode(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private generateCodeVerifier(): string {
    return this.base64URLEncode(randomBytes(32)); // 43–128 characters recommended
  }

  private generateCodeChallenge(verifier: string): string {
    const hash = createHash('sha256').update(verifier).digest('hex');
    return hash;
  }

  handleTikTokLogin2(res: Response) {
    try {
      const csrfState = Math.random().toString(36).substring(2);
      res.cookie('csrfState', csrfState, { maxAge: 60000 });

      const clientKey = this.configService.get<string>('TIKTOK_CLIENT_KEY');
      const redirectUri = this.configService.get<string>('TIKTOK_REDIRECT_URI');

      // Generate PKCE values
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);

      // Store codeVerifier securely (cookie, session, Redis, etc.)
      res.cookie('tiktok_code_verifier', codeVerifier, {
        maxAge: 600000,
        httpOnly: true,
      });

      let url = 'https://www.tiktok.com/v2/auth/authorize/';
      url += `?client_key=${clientKey}`;
      url +=
        '&scope=user.info.basic,user.info.profile,user.info.stats,video.list';
      url += '&response_type=code';
      url += `&redirect_uri=${redirectUri}`;
      url += `&state=${csrfState}`;
      url += `&code_challenge=${codeChallenge}`;
      url += `&code_challenge_method=S256`;
      url += `&client_key=${clientKey}`;

      res.json({ url });
    } catch (error) {
      throw error;
    }
  }

  async handleTikTokCallback(code: string) {
    try {
      // Exchange code for access token
      const tokenResponse = await this.exchangeCodeForToken(code);

      // Get user info using access token
      const userInfo = await this.getTikTokUserInfo(tokenResponse.access_token);

      // Create or find user
      const user = await this.createOrFindTikTokUser(userInfo);

      // Generate JWT token (you'll need to implement this)
      const token = await this.getTokens(user);

      return { user, token };
    } catch (error) {
      console.log(error);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Failed to authenticate with TikTok',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async exchangeCodeForToken(
    code: string,
  ): Promise<TikTokTokenResponse> {
    const clientKey = this.configService.get<string>('TIKTOK_CLIENT_KEY');
    const clientSecret = this.configService.get<string>('TIKTOK_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('TIKTOK_REDIRECT_URI');

    const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
    const data = {
      client_key: clientKey,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };

    const response = await axios.post(tokenUrl, qs.stringify(data), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
    });

    return response.data;
  }

  private async getTikTokUserInfo(
    accessToken: string,
  ): Promise<TikTokUserInfo> {
    const userInfoUrl = 'https://open.tiktokapis.com/v2/user/info/';

    const response = await axios.get(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.data;
  }

  private async createOrFindTikTokUser(userInfo: TikTokUserInfo) {
    const email = `${userInfo.user.open_id}@tiktok.user`;
    const firstName = userInfo.user.display_name?.split(' ')[0] ?? '';
    const lastName =
      userInfo.user.display_name?.split(' ').slice(1).join(' ') ?? '';

    const user = await this.userService.findByEmail(email);
    if (user) return user;

    const createUserDto: CreateUserDto = {
      email,
      firstName: firstName,
      lastName: lastName,
      password: '', // TikTok users don't need password
      createOption: UserCreateOptions.TIKTOK,
      profilePicture: userInfo.user.avatar_url,
    };

    return await this.userService.create(createUserDto);
  }

  async signUp(signupUserDto: SignupUserDto) {
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);
          const { email, firstName, lastName } = signupUserDto;
          const existingUser = await userRepo.findOne({
            where: { email },
            withDeleted: true,
          });

          if (existingUser?.email == email && existingUser?.deletedAt) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message:
                  'User with this email already exist but might have been deleted or deactivated. Please contact the admin if you wish to resolve this.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          if (existingUser?.email == email && existingUser?.verified) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'User with this email already exist',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          const dob = new Date(signupUserDto.dob);
          dob.setHours(1, 0, 0, 0);
          const encryptedPassword = await this.hashPassword(
            signupUserDto.password,
          );
          const otp = generateOtp();

          await userRepo.delete({
            id: existingUser?.id,
            ...(existingUser?.email == email && { email }),
            verified: false,
          });

          await userRepo.save({
            email,
            password: encryptedPassword,
            firstName,
            lastName,
            otp,
            otpExpiresAt: new Date(new Date().getTime() + 15 * 60000),
            dob,
          });

          await this.emailQueue.add(
            JobType.SEND_EMAIL_ZEPTO,
            {
              recipient: email,
              subject: 'Verify your BlueBeep account',
              templateId: EMAIL_TEMPLATES.VERIFY_EMAIL_OTP,
              templateVariables: {
                name: firstName,
                otp,
              },
            },
            EMAIL_JOB_OPTIONS,
          );
          return {
            statusCode: HttpStatus.OK,
            message: 'Signup was successful. Proceed to verify your email',
          };
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async verifySignUpEmailOtp(verifyEmailDto: VerifyEmailDto) {
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);
          const { email, otp } = verifyEmailDto;

          const user = await userRepo.findOne({
            where: { email },
            select: [
              'id',
              'email',
              'role',
              'verified',
              'otp',
              'otpExpiresAt',
              'phoneCode',
              'phoneNumber',
              'firstName',
              'lastName',
              'dob',
              'status',
            ],
          });

          if (!user) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'User not found',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          if (!user || !user.otp || user.otp !== otp) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'Invalid otp',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          const date = new Date().getTime();
          const otpExpiresAt = new Date(user.otpExpiresAt).getTime();

          if (date - otpExpiresAt > 900000)
            throw new HttpException(
              {
                statusCode: HttpStatus.PRECONDITION_FAILED,
                message: 'OTP expired',
              },
              HttpStatus.PRECONDITION_FAILED,
            );
          const { firstName, lastName } = user;
          let unique = false;
          let finalUsername: string = '';
          while (!unique) {
            const randNum = this.nanoid(5);
            const base = baseUsername(firstName, lastName);
            const username = `${base}${randNum}`;

            const existingUserName = await userRepo.findOne({
              where: { username },
            });
            if (!existingUserName) {
              finalUsername = username;
              unique = true;
            }
          }
          user.verified = true;
          user.username = finalUsername;

          const updatedUser = await userRepo.save(user);
          // await this.walletQueue.add(
          //   'create-payment-account',
          //   {},
          //   {
          //     jobId: `create-payment-account:${updatedUser.id}`,
          //     removeOnComplete: true,
          //     removeOnFail: false,
          //   },
          // );

          const { token } = await this.getTokens(user);

          const { ...rest } = updatedUser;
          delete (rest as any).role;
          await this.emailQueue.add(
            JobType.SEND_EMAIL_ZEPTO,
            {
              recipient: email,
              subject: 'Welcome to BlueBeep!',
              templateId: EMAIL_TEMPLATES.WELCOME,
              templateVariables: {
                username: user.firstName,
              },
            },
            EMAIL_JOB_OPTIONS,
          );

          return {
            statusCode: HttpStatus.OK,
            message: 'User otp verified successfully',
            data: {
              user: {
                ...rest,
              },
              token,
            },
          };
        },
      );
    } catch (error) {
      throw error;
    }
  }

  resendVerifyOtp = async (email: string) => {
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);

          const user = await userRepo.findOne({
            where: { email },
          });

          if (!user) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'User not found',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          const otp = generateOtp();

          await userRepo.update(
            { id: user.id },
            { otp, otpExpiresAt: new Date(new Date().getTime() + 15 * 60000) },
          );

          await this.emailQueue.add(
            JobType.SEND_EMAIL_ZEPTO,
            {
              recipient: user.email,
              subject: 'Verify your BlueBeep account',
              templateId: EMAIL_TEMPLATES.VERIFY_EMAIL_OTP,
              templateVariables: {
                name: user?.firstName,
                otp,
              },
            },
            EMAIL_JOB_OPTIONS,
          );

          return {
            statusCode: HttpStatus.OK,
            message: 'OTP sent successfully',
          };
        },
      );
    } catch (error) {
      throw error;
    }
  };

  async login(loginUserDto: LoginUserDto) {
    const { email, password } = loginUserDto;
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);

          const user = await userRepo.findOne({
            where: { email },
            select: [
              'id',
              'email',
              'role',
              'password',
              'verified',
              'firstName',
              'lastName',
              'dob',
              'phoneCode',
              'phoneNumber',
              'status',
              'deletedAt',
            ],
            withDeleted: true,
          });

          if (!user) {
            throw new InvalidCredentialsExceptions();
          }

          if (user.deletedAt) {
            throw new UnauthorizedException(
              'This account might have been deleted or deactivated. Please contact the admin if you wish to resolve this.',
            );
          }

          if (!user.verified) {
            const otp = generateOtp();
            await userRepo.update(
              { id: user.id },
              {
                otp,
                otpExpiresAt: new Date(new Date().getTime() + 15 * 60000),
              },
            );
            await this.emailQueue.add(
              JobType.SEND_EMAIL_ZEPTO,
              {
                recipient: user.email,
                subject: 'Verify your BlueBeep account',
                templateId: EMAIL_TEMPLATES.VERIFY_EMAIL_OTP,
                templateVariables: {
                  name: user?.firstName,
                  otp,
                },
              },
              EMAIL_JOB_OPTIONS,
            );

            throw new HttpException(
              {
                statusCode: HttpStatus.UNAUTHORIZED,
                message:
                  'User has not yet been verified. Pls proceed to verify your email',
              },
              HttpStatus.UNAUTHORIZED,
            );
          }

          if (![UserStatusEnum.ACTIVATED].includes(user.status)) {
            throw new HttpException(
              {
                statusCode: HttpStatus.UNAUTHORIZED,
                message: `Your user account has being ${user.status}. Please contact the admin`,
              },
              HttpStatus.UNAUTHORIZED,
            );
          }
          const validatePassword = await compare(password, user.password);

          if (!validatePassword) {
            throw new InvalidCredentialsExceptions();
          }
          await this.accountActivityService.log({
            userId: user.id,
            action: 'user.logged-in',
            metadata: { userId: user.id, type: 'email-password-login' },
          });
          const { token } = await this.getTokens(user);
          const { ...rest } = user;
          return {
            statusCode: HttpStatus.OK,
            message: 'Successfully logged in',
            data: {
              user: { ...rest },
              token,
            },
          };
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async forgotPassword(email: string) {
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);

          const existingUser = await userRepo.findOne({
            where: { email },
          });

          if (!existingUser) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'User not found',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          const otp = generateOtp();

          await userRepo.update(
            { id: existingUser.id },
            {
              resetOtp: otp,
              resetOtpExpiresAt: new Date(new Date().getTime() + 15 * 60000),
            },
          );

          await this.emailQueue.add(
            JobType.SEND_EMAIL_ZEPTO,
            {
              recipient: existingUser?.email,
              subject: 'Reset your BlueBeep password',
              templateId: EMAIL_TEMPLATES.PASSWORD_RESET_OTP,
              templateVariables: {
                name: existingUser.firstName,
                otp,
              },
            },
            EMAIL_JOB_OPTIONS,
          );

          return {
            statusCode: HttpStatus.OK,
            message: 'Successfully sent code to reset your password',
          };
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { email, resetOtp, password } = resetPasswordDto;
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);

          const user = await userRepo.findOne({
            where: { email },
            select: [
              'id',
              'email',
              'role',
              'verified',
              'resetOtp',
              'resetOtpExpiresAt',
            ],
          });

          if (!user) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'User not found',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          if (user.resetOtp !== resetOtp) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'Invalid otp',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          const date = new Date().getTime();
          const resetOtpExpiresAt = new Date(user.resetOtpExpiresAt).getTime();

          if (date - resetOtpExpiresAt > 900000)
            throw new HttpException(
              {
                statusCode: HttpStatus.PRECONDITION_FAILED,
                message: 'OTP expired',
              },
              HttpStatus.PRECONDITION_FAILED,
            );

          const encryptedPassword = await this.hashPassword(password);

          await userRepo.update(
            { id: user.id },
            { password: encryptedPassword },
          );
          return {
            statusCode: HttpStatus.OK,
            message: 'Successfully reset password',
          };
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const { oldPassword, newPassword } = changePasswordDto;
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const userRepo = entityManager.getRepository(User);
          const user = await userRepo.findOne({
            where: { id: userId },
            select: ['id', 'password'],
          });

          if (!user) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'User not found',
              },
              HttpStatus.NOT_FOUND,
            );
          }

          const validatePassword = await compare(oldPassword, user.password);
          if (!validatePassword) {
            throw new HttpException(
              {
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Your old password does not match',
              },
              HttpStatus.FORBIDDEN,
            );
          }

          const encryptedPassword = await this.hashPassword(newPassword);

          await userRepo.update(
            { id: user.id },
            { password: encryptedPassword },
          );
          return {
            statusCode: HttpStatus.OK,
            message: 'Successfully changed password',
          };
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async refreshTokens(token: string): Promise<JWTTokens> {
    try {
      const { id, email } = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_REFRESH_TOKEN_SECRET'),
      });

      const user = await this.userRepo.findOneOrFail({
        where: { id, email },
      });

      return this.getTokens(user);
    } catch (error) {
      throw error;
    }
  }

  private hashPassword(password: string): Promise<string> {
    return hash(password, 10);
  }

  private async getTokens(user: User): Promise<JWTTokens> {
    const [token] = await Promise.all([
      this.jwtService.sign(
        { id: user.id, email: user.email, role: user.role },
        {
          secret: this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET'),
          expiresIn: this.configService.get<string>(
            'JWT_ACCESS_TOKEN_EXPIRATION',
          ),
        },
      ),
    ]);

    return { token };
  }
}
