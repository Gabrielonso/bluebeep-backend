import { UpdateResult } from 'typeorm';

/**
 * Throws if a media row update did not change exactly one row.
 * Prevents Bull jobs from completing when the durable DB transition failed.
 */
export function assertMediaUpdated(
  result: UpdateResult,
  mediaId: string,
  context: string,
): void {
  if (result.affected !== 1) {
    throw new Error(
      `Media update affected ${result.affected ?? 0} rows for ${mediaId} (${context})`,
    );
  }
}
