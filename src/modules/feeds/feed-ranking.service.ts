import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { FeedType } from './enums/feed-type.enum';
import {
  FEED_RANKING,
  FEED_SLOT_TEMPLATE,
  FeedPoolSource,
} from './feed-ranking.config';
import {
  RankedFeedCandidate,
  RankedFeedCursor,
  SeenPostMap,
} from './types/feed.types';

export type ScoreContext = {
  followingIds: Set<string>;
  seenMap: SeenPostMap;
  viewerId: string;
};

export type MergeBySlotsOptions = {
  seenMap?: SeenPostMap;
  seed?: string;
};

@Injectable()
export class FeedRankingService {
  generateSeed(existing?: string): string {
    if (existing) return existing;
    return randomBytes(16).toString('hex');
  }

  encodeRankedCursor(input: RankedFeedCursor): string {
    return Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  }

  decodeRankedCursor(cursor?: string): RankedFeedCursor | null {
    if (!cursor) return null;
    try {
      const raw = Buffer.from(cursor, 'base64').toString('utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const obj = parsed as Record<string, unknown>;
      if (
        typeof obj.score !== 'number' ||
        typeof obj.id !== 'string' ||
        typeof obj.seed !== 'string'
      ) {
        return null;
      }
      return { score: obj.score, id: obj.id, seed: obj.seed };
    } catch {
      return null;
    }
  }

  hashToUnitInterval(seed: string, candidateId: string): number {
    const hash = createHash('sha256').update(`${seed}:${candidateId}`).digest();
    return hash.readUInt32BE(0) / 0xffffffff;
  }

  /** Stable 0..n-1 offset so cold starts don't always open on the same slot. */
  slotOffsetForSeed(seed: string | undefined, templateLength: number): number {
    if (!seed || templateLength <= 0) return 0;
    const hash = createHash('sha256').update(`slot:${seed}`).digest();
    return hash.readUInt32BE(0) % templateLength;
  }

  recencyDecay(hoursSince: number, halfLifeHours: number): number {
    if (hoursSince <= 0) return 1;
    return Math.exp(-hoursSince / halfLifeHours);
  }

  /**
   * Fresh for the viewer: never viewed, or a followed repost that happened
   * after the last view (social signal worth resurfacing).
   */
  isFreshForViewer(
    candidate: RankedFeedCandidate,
    seenMap?: SeenPostMap,
  ): boolean {
    if (candidate.type === FeedType.AD || candidate.pool === 'ad') {
      return true;
    }
    if (!seenMap?.size) return true;

    const viewedAt = seenMap.get(candidate.id);
    if (!viewedAt) return true;

    if (
      candidate.pool === 'repost' &&
      candidate.latestRepostAt &&
      new Date(candidate.latestRepostAt).getTime() >
        new Date(viewedAt).getTime()
    ) {
      return true;
    }

    return false;
  }

  computeSeenMultiplier(
    pool: FeedPoolSource | 'ad',
    viewedAt?: Date,
    latestRepostAt?: Date,
  ): number {
    if (!viewedAt || pool === 'ad') return 1;

    const hoursSinceView =
      (Date.now() - new Date(viewedAt).getTime()) / (1000 * 60 * 60);
    const decay = Math.exp(-hoursSinceView / FEED_RANKING.SEEN_DECAY_HOURS);

    let minPenalty: number;
    if (pool === 'discovery') {
      minPenalty = FEED_RANKING.SEEN_PENALTY_DISCOVERY_MIN;
    } else if (pool === 'following') {
      minPenalty = FEED_RANKING.SEEN_PENALTY_FOLLOWING;
    } else if (pool === 'repost') {
      if (
        latestRepostAt &&
        new Date(latestRepostAt).getTime() > new Date(viewedAt).getTime()
      ) {
        return 1;
      }
      minPenalty = FEED_RANKING.SEEN_PENALTY_REPOST_STALE;
    } else {
      return 1;
    }

    return minPenalty + (1 - minPenalty) * decay;
  }

  /** Recent own posts/ads score normally; older own content gets an extra downrank. */
  computeOwnContentMultiplier(
    ownerId: string | undefined,
    viewerId: string,
    hoursSinceCreated: number,
  ): number {
    if (!ownerId || ownerId !== viewerId) return 1;
    if (hoursSinceCreated <= FEED_RANKING.OWN_CONTENT_GRACE_HOURS) return 1;

    const excessHours =
      hoursSinceCreated - FEED_RANKING.OWN_CONTENT_GRACE_HOURS;
    const decay = Math.exp(
      -excessHours / FEED_RANKING.OWN_CONTENT_EXTRA_DECAY_HOURS,
    );
    return (
      FEED_RANKING.OWN_CONTENT_OLD_MIN +
      (1 - FEED_RANKING.OWN_CONTENT_OLD_MIN) * decay
    );
  }

  scoreCandidate(candidate: RankedFeedCandidate, ctx: ScoreContext): number {
    const now = Date.now();
    const createdAt = new Date(candidate.createdAt).getTime();
    const hoursSincePost = Math.max(0, (now - createdAt) / (1000 * 60 * 60));

    const engagement = Math.log1p(
      (candidate.likeCount ?? 0) +
        2 * (candidate.commentCount ?? 0) +
        3 * (candidate.repostCount ?? 0),
    );

    const isFromFollowing =
      candidate.ownerId != null && ctx.followingIds.has(candidate.ownerId);
    const isFollowedRepost = candidate.pool === 'repost';

    const baseScore =
      FEED_RANKING.WEIGHT_RECENCY *
        this.recencyDecay(
          hoursSincePost,
          FEED_RANKING.RECENCY_HALF_LIFE_HOURS,
        ) +
      FEED_RANKING.WEIGHT_ENGAGEMENT * engagement +
      (isFromFollowing ? FEED_RANKING.WEIGHT_FOLLOWING : 0) +
      (isFollowedRepost ? FEED_RANKING.WEIGHT_FOLLOWED_REPOST : 0) +
      FEED_RANKING.WEIGHT_VIEWS * Math.log1p(candidate.viewCount ?? 0);

    const viewedAt = ctx.seenMap.get(candidate.id);
    const seenMultiplier = this.computeSeenMultiplier(
      candidate.pool,
      viewedAt,
      candidate.latestRepostAt,
    );

    const ownMultiplier = this.computeOwnContentMultiplier(
      candidate.ownerId,
      ctx.viewerId,
      hoursSincePost,
    );

    return baseScore * seenMultiplier * ownMultiplier;
  }

  applyJitter(
    candidates: RankedFeedCandidate[],
    seed: string,
  ): RankedFeedCandidate[] {
    return candidates.map((c) => {
      const baseScore = c.baseScore ?? 0;
      const jitter =
        this.hashToUnitInterval(seed, c.id) *
        FEED_RANKING.JITTER_MAX *
        Math.max(baseScore, 0.01);
      return { ...c, finalScore: baseScore + jitter };
    });
  }

  rankPool(
    candidates: RankedFeedCandidate[],
    ctx: ScoreContext,
    seed: string,
  ): RankedFeedCandidate[] {
    const scored = candidates.map((c) => ({
      ...c,
      baseScore: this.scoreCandidate(c, ctx),
    }));
    const jittered = this.applyJitter(scored, seed);
    return jittered.sort((a, b) => {
      // Unseen before seen within the same pool (For You / continuous scroll).
      const aFresh = this.isFreshForViewer(a, ctx.seenMap) ? 1 : 0;
      const bFresh = this.isFreshForViewer(b, ctx.seenMap) ? 1 : 0;
      if (aFresh !== bFresh) return bFresh - aFresh;

      const scoreDiff = (b.finalScore ?? 0) - (a.finalScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return b.id.localeCompare(a.id);
    });
  }

  isBeforeCursor(
    candidate: RankedFeedCandidate,
    cursor: RankedFeedCursor,
  ): boolean {
    const score = candidate.finalScore ?? 0;
    if (score < cursor.score) return true;
    if (score > cursor.score) return false;
    return candidate.id < cursor.id;
  }

  /**
   * Interleave pools with a slot template.
   * Phase 1: only fresh (unseen) posts — TikTok/IG style.
   * Phase 2: recycle seen posts only after fresh inventory is exhausted.
   * Slot start is rotated by seed so refreshes don't always open on the same source.
   */
  mergeBySlots(
    pools: Record<FeedPoolSource, RankedFeedCandidate[]>,
    limit: number,
    cursor?: RankedFeedCursor | null,
    options: MergeBySlotsOptions = {},
  ): RankedFeedCandidate[] {
    const { seenMap, seed } = options;
    const usedPostIds = new Set<string>();
    const result: RankedFeedCandidate[] = [];
    const templateLen = FEED_SLOT_TEMPLATE.length;
    const slotOffset = this.slotOffsetForSeed(seed, templateLen);

    const isPostLike = (c: RankedFeedCandidate) =>
      c.type === FeedType.POST || c.type === 'repost';

    const takeFromPool = (
      pool: FeedPoolSource,
      onlyFresh: boolean,
    ): RankedFeedCandidate | null => {
      const list = pools[pool] ?? [];
      for (const candidate of list) {
        if (cursor && !this.isBeforeCursor(candidate, cursor)) continue;
        if (isPostLike(candidate) && usedPostIds.has(candidate.id)) continue;
        if (onlyFresh && !this.isFreshForViewer(candidate, seenMap)) continue;
        return candidate;
      }
      return null;
    };

    const resolveDedup = (
      candidate: RankedFeedCandidate,
      slot: FeedPoolSource,
    ): boolean => {
      if (!isPostLike(candidate)) return true;

      const existingIdx = result.findIndex(
        (r) => isPostLike(r) && r.id === candidate.id,
      );

      if (existingIdx === -1) {
        usedPostIds.add(candidate.id);
        return true;
      }

      const existing = result[existingIdx];

      if (slot === 'following' && existing.pool === 'repost') {
        result[existingIdx] = candidate;
        return false;
      }

      if (slot === 'repost' && existing.pool === 'following') {
        return false;
      }

      if (slot === 'repost' && existing.pool === 'discovery') {
        result[existingIdx] = candidate;
        return false;
      }

      return false;
    };

    const fillPhase = (onlyFresh: boolean) => {
      let slotIdx = 0;
      let safety = 0;
      const maxIterations = limit * templateLen * 3;
      let idleRounds = 0;

      while (result.length < limit && safety < maxIterations) {
        safety++;
        const slot = FEED_SLOT_TEMPLATE[(slotOffset + slotIdx) % templateLen];
        slotIdx++;

        let candidate = takeFromPool(slot, onlyFresh);

        // Prefer another fresh source over inserting seen early.
        if (!candidate && slot !== 'discovery') {
          candidate = takeFromPool('discovery', onlyFresh);
        }
        if (!candidate && slot !== 'following' && onlyFresh) {
          candidate = takeFromPool('following', onlyFresh);
        }
        if (!candidate && slot !== 'repost' && onlyFresh) {
          candidate = takeFromPool('repost', onlyFresh);
        }

        if (!candidate) {
          idleRounds++;
          // One full template with nothing usable → inventory for this phase is done.
          if (idleRounds >= templateLen) break;
          continue;
        }

        idleRounds = 0;
        if (resolveDedup(candidate, slot)) {
          result.push(candidate);
        }
      }
    };

    // Unseen / fresh first, then recycle seen for continuous scrolling.
    fillPhase(true);
    if (result.length < limit) {
      fillPhase(false);
    }

    return result;
  }

  toRawFeedRows(candidates: RankedFeedCandidate[]) {
    return candidates.map((c) => ({
      id: c.id,
      type: c.type,
      createdAt: c.createdAt,
      repostedById: c.repostedById,
      latestRepostAt: c.latestRepostAt,
    }));
  }
}
