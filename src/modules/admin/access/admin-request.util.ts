import { isIP } from 'node:net';
import { Request } from 'express';
import { AdminMembership } from './entities/admin-membership.entity';

export type AdminActor = {
  id: string;
  email?: string;
  role?: string;
};

export type AdminHttpRequest = Request & {
  user?: AdminActor;
  adminMembership?: AdminMembership | null;
};

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : req.ip;
  return normalizeIp(raw || '');
}

export function normalizeIp(value: string): string {
  return value.trim().replace(/^::ffff:/i, '');
}

export function isValidIp(value: string): boolean {
  return isIP(normalizeIp(value)) !== 0;
}

export function displayName(
  user:
    | {
        firstName?: string | null;
        lastName?: string | null;
        username?: string | null;
      }
    | null
    | undefined,
  email?: string | null,
): string {
  const name = [user?.firstName, user?.lastName]
    .filter((part) => !!part && part.trim())
    .join(' ')
    .trim();
  if (name) return name;
  if (user?.username) return user.username;
  const local = (email || '').split('@')[0];
  return local || 'Admin';
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
