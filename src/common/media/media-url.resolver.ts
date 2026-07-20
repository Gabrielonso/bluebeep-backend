import { Injectable } from '@nestjs/common';
import { MediaStorageRegistry } from './media-storage.registry';
import { Media } from 'src/modules/media/entities/media.entity';
import { PlaybackUrls } from '../interfaces/media-provider.interface';
import {
  effectiveMediaStatus,
  hasDeliverableUpload,
  isPubliclyDeliverable,
} from 'src/modules/media/media-delivery.util';

export interface MediaPlaybackPayload {
  id: string;
  type: string;
  status: string;
  width?: number;
  height?: number;
  duration?: number;
  aspectRatio?: number | null;
  fileName?: string;
  playback: PlaybackUrls;
}

@Injectable()
export class MediaUrlResolver {
  constructor(private readonly registry: MediaStorageRegistry) {}

  resolve(media: Media): PlaybackUrls {
    return this.registry.get(media.provider).getPlaybackUrls(media);
  }

  toPlaybackPayload(media: Media): MediaPlaybackPayload {
    const playback = this.resolve(media);
    const { width, height, duration, aspectRatio, fileName } =
      this.mediaDimensions(media);

    return {
      id: media.id,
      type: media.type,
      status: effectiveMediaStatus(media),
      width,
      height,
      duration,
      aspectRatio,
      fileName,
      playback,
    };
  }

  /** Width / height / duration / aspectRatio as stored on the media row. */
  mediaDimensions(media: Media): {
    width?: number;
    height?: number;
    duration?: number;
    aspectRatio?: number | null;
    fileName?: string;
  } {
    const width = this.positiveNumber(media.width);
    const height = this.positiveNumber(media.height);
    const duration = this.positiveNumber(media.duration);

    return {
      width,
      height,
      duration,
      aspectRatio: width && height ? width / height : null,
      fileName: media.fileName ?? undefined,
    };
  }

  private positiveNumber(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  isPubliclyVisible(media: Media): boolean {
    return isPubliclyDeliverable(media);
  }

  hasPlayback(media: Media): boolean {
    return hasDeliverableUpload(media);
  }
}
