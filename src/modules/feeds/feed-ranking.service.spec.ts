import { FeedType } from './enums/feed-type.enum';
import { FeedRankingService } from './feed-ranking.service';
import { RankedFeedCandidate, SeenPostMap } from './types/feed.types';

function candidate(
  partial: Partial<RankedFeedCandidate> &
    Pick<RankedFeedCandidate, 'id' | 'pool'>,
): RankedFeedCandidate {
  return {
    type: FeedType.POST,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    finalScore: 10,
    ...partial,
  };
}

describe('FeedRankingService', () => {
  const service = new FeedRankingService();

  describe('isFreshForViewer', () => {
    it('treats ads and never-viewed posts as fresh', () => {
      const seen: SeenPostMap = new Map([
        ['seen-1', new Date('2026-08-20T00:00:00.000Z')],
      ]);

      expect(
        service.isFreshForViewer(
          candidate({ id: 'ad-1', pool: 'ad', type: FeedType.AD }),
          seen,
        ),
      ).toBe(true);
      expect(
        service.isFreshForViewer(
          candidate({ id: 'new-1', pool: 'discovery' }),
          seen,
        ),
      ).toBe(true);
      expect(
        service.isFreshForViewer(
          candidate({ id: 'seen-1', pool: 'following' }),
          seen,
        ),
      ).toBe(false);
    });

    it('treats a repost after the last view as fresh', () => {
      const seen: SeenPostMap = new Map([
        ['p1', new Date('2026-08-20T00:00:00.000Z')],
      ]);

      expect(
        service.isFreshForViewer(
          candidate({
            id: 'p1',
            pool: 'repost',
            type: 'repost',
            latestRepostAt: new Date('2026-08-21T00:00:00.000Z'),
          }),
          seen,
        ),
      ).toBe(true);
    });
  });

  describe('mergeBySlots', () => {
    it('serves all unseen posts before recycling seen ones', () => {
      const seen: SeenPostMap = new Map([
        ['follow-seen', new Date('2026-08-20T00:00:00.000Z')],
        ['disc-seen', new Date('2026-08-20T00:00:00.000Z')],
      ]);

      const pools = {
        following: [
          candidate({
            id: 'follow-seen',
            pool: 'following',
            finalScore: 100,
          }),
          candidate({
            id: 'follow-fresh',
            pool: 'following',
            finalScore: 5,
          }),
        ],
        discovery: [
          candidate({
            id: 'disc-seen',
            pool: 'discovery',
            finalScore: 90,
          }),
          candidate({
            id: 'disc-fresh-a',
            pool: 'discovery',
            finalScore: 8,
          }),
          candidate({
            id: 'disc-fresh-b',
            pool: 'discovery',
            finalScore: 7,
          }),
        ],
        repost: [],
        ad: [],
      };

      const merged = service.mergeBySlots(pools, 5, null, {
        seenMap: seen,
        seed: 'test-seed-unseen-first',
      });

      const ids = merged.map((c) => c.id);
      const firstSeenIdx = ids.findIndex(
        (id) => id === 'follow-seen' || id === 'disc-seen',
      );
      const lastFreshIdx = Math.max(
        ids.indexOf('follow-fresh'),
        ids.indexOf('disc-fresh-a'),
        ids.indexOf('disc-fresh-b'),
      );

      expect(ids).toEqual(
        expect.arrayContaining([
          'follow-fresh',
          'disc-fresh-a',
          'disc-fresh-b',
        ]),
      );
      expect(firstSeenIdx).toBeGreaterThan(lastFreshIdx);
    });

    it('does not pin the same following post first on every seed', () => {
      const pools = {
        following: [candidate({ id: 'f1', pool: 'following', finalScore: 50 })],
        discovery: [
          candidate({ id: 'd1', pool: 'discovery', finalScore: 40 }),
          candidate({ id: 'd2', pool: 'discovery', finalScore: 39 }),
        ],
        repost: [],
        ad: [],
      };

      const firstIds = new Set<string>();
      for (let i = 0; i < 24; i++) {
        const merged = service.mergeBySlots(pools, 3, null, {
          seed: `seed-${i}`,
        });
        firstIds.add(merged[0].id);
      }

      expect(firstIds.size).toBeGreaterThan(1);
    });

    it('falls back to seen content once fresh inventory is exhausted', () => {
      const seen: SeenPostMap = new Map([
        ['only-seen', new Date('2026-08-20T00:00:00.000Z')],
      ]);

      const pools = {
        following: [
          candidate({ id: 'only-seen', pool: 'following', finalScore: 10 }),
        ],
        discovery: [],
        repost: [],
        ad: [],
      };

      const merged = service.mergeBySlots(pools, 1, null, {
        seenMap: seen,
        seed: 'recycle',
      });

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('only-seen');
    });
  });

  describe('rankPool', () => {
    it('orders unseen ahead of seen even when seen has a higher raw score', () => {
      const seen: SeenPostMap = new Map([
        ['seen-hot', new Date('2026-08-20T00:00:00.000Z')],
      ]);
      const ctx = {
        followingIds: new Set<string>(),
        seenMap: seen,
        viewerId: 'viewer-1',
      };

      const ranked = service.rankPool(
        [
          candidate({
            id: 'seen-hot',
            pool: 'discovery',
            likeCount: 1000,
            createdAt: new Date(),
          }),
          candidate({
            id: 'fresh-quiet',
            pool: 'discovery',
            likeCount: 0,
            createdAt: new Date(),
          }),
        ],
        ctx,
        'rank-seed',
      );

      expect(ranked[0].id).toBe('fresh-quiet');
      expect(ranked[1].id).toBe('seen-hot');
    });
  });
});
