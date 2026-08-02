import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/common/redis/redis.constants';

export type PresenceStatus = 'online' | 'away' | 'offline';

@Injectable()
export class PresenceService {
  /** TTL refreshed on connect, heartbeat, and WS activity while socket is open. */
  private readonly presenceTtlSeconds = 120;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private statusKey(userId: string) {
    return `presence:status:${userId}`;
  }

  async userConnected(userId: string) {
    const now = Date.now();
    await this.redis.set(
      this.statusKey(userId),
      `online:${now}`,
      'EX',
      this.presenceTtlSeconds,
    );
  }

  async userDisconnected(userId: string) {
    const now = Date.now();
    // keep a short-lived offline marker so other services can read "recently offline"
    await this.redis.set(
      this.statusKey(userId),
      `offline:${now}`,
      'EX',
      this.presenceTtlSeconds,
    );
  }

  async markAway(userId: string) {
    const now = Date.now();
    await this.redis.set(
      this.statusKey(userId),
      `away:${now}`,
      'EX',
      this.presenceTtlSeconds,
    );
  }

  /**
   * Extends Redis TTL for the current status.
   * Keeps `away` as away; refreshes `online`; restores `online` if the key expired
   * but the client is still connected and sending events.
   */
  async refreshPresence(userId: string): Promise<PresenceStatus> {
    const status = await this.getStatus(userId);
    if (status === 'away') {
      await this.markAway(userId);
      return 'away';
    }
    await this.userConnected(userId);
    return 'online';
  }

  async isOnline(userId: string): Promise<boolean> {
    const status = await this.getStatus(userId);
    return status === 'online';
  }

  /** Socket is likely open (foreground or background with presence.away). */
  async isReachableViaSocket(userId: string): Promise<boolean> {
    const status = await this.getStatus(userId);
    return status === 'online' || status === 'away';
  }

  async getStatus(userId: string): Promise<PresenceStatus> {
    const raw = await this.redis.get(this.statusKey(userId));
    if (!raw) return 'offline';
    const [status] = raw.split(':', 1) as [PresenceStatus];
    if (status === 'online' || status === 'away' || status === 'offline')
      return status;
    return 'offline';
  }

  async getStatuses(userIds: string[]): Promise<Map<string, PresenceStatus>> {
    const keys = userIds.map((id) => this.statusKey(id));
    const values = keys.length ? await this.redis.mget(keys) : [];
    const map = new Map<string, PresenceStatus>();
    for (let i = 0; i < userIds.length; i++) {
      const raw = values[i];
      const status = raw ? (raw.split(':', 1)[0] as PresenceStatus) : 'offline';
      map.set(
        userIds[i],
        status === 'online' || status === 'away' || status === 'offline'
          ? status
          : 'offline',
      );
    }
    return map;
  }

  /**
   * Scans Redis presence keys and returns counts by status.
   * Admin/metrics use only — not for hot-path per-request lookups.
   */
  async countByStatus(): Promise<Record<PresenceStatus, number>> {
    const entries = await this.listPresenceEntries();
    const counts: Record<PresenceStatus, number> = {
      online: 0,
      away: 0,
      offline: 0,
    };
    for (const entry of entries) {
      counts[entry.status] += 1;
    }
    return counts;
  }

  /**
   * Returns presence entries with userIds (for admin metrics that filter by role).
   */
  async listPresenceEntries(): Promise<
    Array<{ userId: string; status: PresenceStatus }>
  > {
    const entries: Array<{ userId: string; status: PresenceStatus }> = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'presence:status:*',
        'COUNT',
        200,
      );
      cursor = nextCursor;

      if (!keys.length) continue;

      const values = await this.redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const userId = keys[i].slice('presence:status:'.length);
        if (!userId) continue;
        const raw = values[i];
        if (!raw) {
          entries.push({ userId, status: 'offline' });
          continue;
        }
        const status = raw.split(':', 1)[0] as PresenceStatus;
        entries.push({
          userId,
          status:
            status === 'online' || status === 'away' || status === 'offline'
              ? status
              : 'offline',
        });
      }
    } while (cursor !== '0');

    return entries;
  }
}
