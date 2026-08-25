jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  SignJWT: jest.fn(),
}));

import { UnauthorizedException } from '@nestjs/common';
import { AppleAuthService } from './apple-auth.service';

describe('AppleAuthService', () => {
  const appleConfig = {
    bundleId: 'com.bluebeep.app',
    servicesId: 'com.bluebeep.web',
    teamId: 'TEAM123',
    keyId: 'KEY123',
    privateKey: undefined as string | undefined,
    callbackURL: 'https://api.example.com/v1/auth/apple/web/callback',
    frontendRedirectURL: 'https://app.example.com/auth/callback',
    audiences: ['com.bluebeep.app', 'com.bluebeep.web'],
  };

  let service: AppleAuthService;

  beforeEach(() => {
    service = new AppleAuthService(appleConfig as any);
  });

  it('builds authorize URL with form_post and services id', () => {
    const url = service.buildAuthorizeUrl('state-abc');
    expect(url).toContain('https://appleid.apple.com/auth/authorize?');
    expect(url).toContain('client_id=com.bluebeep.web');
    expect(url).toContain('response_mode=form_post');
    expect(url).toContain('response_type=code+id_token');
    expect(url).toContain('state=state-abc');
    expect(url).toContain('scope=name+email');
  });

  it('rejects identity token when audiences are not configured', async () => {
    const bare = new AppleAuthService({ audiences: [] } as any);
    await expect(bare.verifyIdentityToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects client secret creation when private key is missing', async () => {
    await expect(service.createClientSecret()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
