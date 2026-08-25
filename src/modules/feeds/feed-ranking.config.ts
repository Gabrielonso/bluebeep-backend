export const FEED_RANKING = {
  WEIGHT_RECENCY: 2.0,
  WEIGHT_ENGAGEMENT: 1.2,
  /** Boost followed authors, but don't drown discovery among unseen. */
  WEIGHT_FOLLOWING: 1.5,
  WEIGHT_FOLLOWED_REPOST: 1.8,
  WEIGHT_VIEWS: 0.4,
  RECENCY_HALF_LIFE_HOURS: 48,
  /** Extra shuffle among similarly scored items (For You feel). */
  JITTER_MAX: 0.35,
  OVERFETCH_MULTIPLIER: 5,
  REPOST_MAX_AGE_DAYS: 7,
  REPOSTS_DISPLAY_CAP: 5,
  /**
   * Seen posts are buried until unseen inventory is exhausted.
   * Floors stay very low so recycled content rarely outranks fresh.
   */
  SEEN_PENALTY_DISCOVERY_MIN: 0.02,
  SEEN_PENALTY_FOLLOWING: 0.05,
  SEEN_PENALTY_REPOST_STALE: 0.04,
  /** How quickly a seen penalty relaxes back toward 1.0. */
  SEEN_DECAY_HOURS: 72,
  /** Own posts/ads at full strength within this age (same as any fresh content). */
  OWN_CONTENT_GRACE_HOURS: 48,
  /** Floor multiplier for older own posts/ads after grace period. */
  OWN_CONTENT_OLD_MIN: 0.25,
  /** How quickly own content beyond grace fades toward OWN_CONTENT_OLD_MIN. */
  OWN_CONTENT_EXTRA_DECAY_HOURS: 120,
} as const;

/**
 * Mix sources for a continuous For You scroll.
 * Discovery-heavy, with following / repost / ads interleaved — not following-first.
 */
export const FEED_SLOT_TEMPLATE = [
  'discovery',
  'following',
  'discovery',
  'repost',
  'discovery',
  'following',
  'ad',
  'discovery',
  'following',
  'discovery',
  'repost',
  'discovery',
  'following',
  'ad',
  'discovery',
  'repost',
  'discovery',
  'following',
  'discovery',
  'discovery',
] as const;

export type FeedPoolSource = (typeof FEED_SLOT_TEMPLATE)[number];
