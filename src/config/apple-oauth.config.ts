import { registerAs } from '@nestjs/config';

function normalizePem(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/\\n/g, '\n');
}

export default registerAs('appleOAuth', () => ({
  bundleId: process.env.APPLE_BUNDLE_ID,
  servicesId: process.env.APPLE_SERVICES_ID,
  teamId: process.env.APPLE_TEAM_ID,
  keyId: process.env.APPLE_KEY_ID,
  privateKey: normalizePem(process.env.APPLE_PRIVATE_KEY),
  callbackURL: process.env.APPLE_CALLBACK_URL,
  frontendRedirectURL: process.env.APPLE_FRONTEND_REDIRECT_URL,
  /** Audiences accepted for identity-token verification (iOS Bundle ID + web Services ID). */
  audiences: [process.env.APPLE_BUNDLE_ID, process.env.APPLE_SERVICES_ID]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id)),
}));
