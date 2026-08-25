import {
  Injectable,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as jose from 'jose';
import appleOauthConfig from 'src/config/apple-oauth.config';

export interface AppleIdentityPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  iss: string;
  aud: string | string[];
  exp: number;
}

@Injectable()
export class AppleAuthService {
  private readonly logger = new Logger(AppleAuthService.name);
  private jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

  constructor(
    @Inject(appleOauthConfig.KEY)
    private readonly appleConfig: ConfigType<typeof appleOauthConfig>,
  ) {}

  private getJwks() {
    if (!this.jwks) {
      this.jwks = jose.createRemoteJWKSet(
        new URL('https://appleid.apple.com/auth/keys'),
      );
    }
    return this.jwks;
  }

  /**
   * Verify an Apple identity token (JWT) against Apple's JWKS.
   * Accepts aud = Bundle ID (iOS) or Services ID (web).
   */
  async verifyIdentityToken(
    identityToken: string,
  ): Promise<AppleIdentityPayload> {
    const audiences = this.appleConfig.audiences;
    if (!audiences?.length) {
      throw new UnauthorizedException('Apple sign-in is not configured');
    }

    try {
      const { payload } = await jose.jwtVerify(identityToken, this.getJwks(), {
        issuer: 'https://appleid.apple.com',
        audience: audiences,
      });

      const sub = payload.sub;
      if (!sub) {
        throw new UnauthorizedException('Apple identity token missing subject');
      }

      return {
        sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        email_verified: payload.email_verified as boolean | string | undefined,
        iss: String(payload.iss),
        aud: payload.aud as string | string[],
        exp: Number(payload.exp),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(
        `Apple identity token verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException('Invalid Apple identity token');
    }
  }

  /**
   * Client secret JWT required for Apple token endpoint (web code exchange).
   * Signed with the Sign in with Apple .p8 private key (ES256).
   */
  async createClientSecret(): Promise<string> {
    const { teamId, servicesId, keyId, privateKey } = this.appleConfig;
    if (!teamId || !servicesId || !keyId || !privateKey) {
      throw new UnauthorizedException(
        'Apple web sign-in is not configured (missing team/key/services credentials)',
      );
    }

    const key = await jose.importPKCS8(privateKey, 'ES256');
    const now = Math.floor(Date.now() / 1000);

    return new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setSubject(servicesId)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 5) // 5 minutes
      .sign(key);
  }

  buildAuthorizeUrl(state: string): string {
    const { servicesId, callbackURL } = this.appleConfig;
    if (!servicesId || !callbackURL) {
      throw new UnauthorizedException(
        'Apple web sign-in is not configured (missing services id or callback URL)',
      );
    }

    const params = new URLSearchParams({
      response_type: 'code id_token',
      response_mode: 'form_post',
      client_id: servicesId,
      redirect_uri: callbackURL,
      scope: 'name email',
      state,
    });

    return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
  }

  async exchangeAuthorizationCode(code: string): Promise<{
    id_token: string;
    access_token?: string;
    refresh_token?: string;
  }> {
    const { servicesId, callbackURL } = this.appleConfig;
    if (!servicesId || !callbackURL) {
      throw new UnauthorizedException(
        'Apple web sign-in is not configured (missing services id or callback URL)',
      );
    }

    const clientSecret = await this.createClientSecret();
    const body = new URLSearchParams({
      client_id: servicesId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackURL,
    });

    const response = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.warn(`Apple token exchange failed: ${text}`);
      throw new UnauthorizedException(
        'Apple authorization code exchange failed',
      );
    }

    const data = (await response.json()) as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
    };

    if (!data.id_token) {
      throw new UnauthorizedException('Apple token response missing id_token');
    }

    return {
      id_token: data.id_token,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    };
  }
}
