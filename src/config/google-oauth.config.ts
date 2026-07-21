import { registerAs } from '@nestjs/config';

export default registerAs('googleOAuth', () => ({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
  clientIds: (process.env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  frontendRedirectURL: process.env.GOOGLE_FRONTEND_REDIRECT_URL,
}));
