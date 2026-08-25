jest.mock('nanoid', () => ({
  customAlphabet: () => () => '1234567890123456',
}));

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  SignJWT: jest.fn(),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({})),
}));

import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserCreateOptions } from 'src/modules/user/interfaces/user.interfaces';

describe('AuthService.validateAppleUser', () => {
  let authService: AuthService;
  const userService = {
    findByAppleId: jest.fn(),
    findByEmail: jest.fn(),
    linkAppleId: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    authService = Object.create(AuthService.prototype) as AuthService;
    (authService as any).userService = userService;
  });

  it('returns existing user when appleId matches', async () => {
    const existing = { id: 'u1', appleId: 'apple.sub.1', email: 'a@b.com' };
    userService.findByAppleId.mockResolvedValue(existing);

    const result = await authService.validateAppleUser({
      appleId: 'apple.sub.1',
      email: 'ignored@example.com',
    });

    expect(result).toBe(existing);
    expect(userService.findByEmail).not.toHaveBeenCalled();
    expect(userService.create).not.toHaveBeenCalled();
  });

  it('links appleId to existing email account', async () => {
    userService.findByAppleId.mockResolvedValue(null);
    const byEmail = { id: 'u2', email: 'same@example.com' };
    userService.findByEmail.mockResolvedValue(byEmail);
    const linked = { ...byEmail, appleId: 'apple.sub.2' };
    userService.linkAppleId.mockResolvedValue(linked);

    const result = await authService.validateAppleUser({
      appleId: 'apple.sub.2',
      email: 'same@example.com',
      firstName: 'Sam',
    });

    expect(userService.linkAppleId).toHaveBeenCalledWith('u2', 'apple.sub.2');
    expect(result).toEqual(linked);
    expect(userService.create).not.toHaveBeenCalled();
  });

  it('creates a new Apple user when email is new', async () => {
    userService.findByAppleId.mockResolvedValue(null);
    userService.findByEmail.mockResolvedValue(null);
    const created = {
      id: 'u3',
      email: 'new@privaterelay.appleid.com',
      appleId: 'apple.sub.3',
    };
    userService.create.mockResolvedValue(created);

    const result = await authService.validateAppleUser({
      appleId: 'apple.sub.3',
      email: 'new@privaterelay.appleid.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    expect(userService.create).toHaveBeenCalledWith({
      email: 'new@privaterelay.appleid.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      password: '',
      createOption: UserCreateOptions.APPLE,
      profilePicture: '',
      appleId: 'apple.sub.3',
    });
    expect(result).toBe(created);
  });

  it('rejects when email is missing and appleId is unknown', async () => {
    userService.findByAppleId.mockResolvedValue(null);

    await expect(
      authService.validateAppleUser({ appleId: 'apple.sub.unknown' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userService.create).not.toHaveBeenCalled();
  });
});
