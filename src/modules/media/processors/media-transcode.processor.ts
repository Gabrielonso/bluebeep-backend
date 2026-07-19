import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as sharp from 'sharp';
import { createWriteStream } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { PassThrough } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MEDIA_TRANSCODE_QUEUE } from '../media.queue';
import { MEDIA_JOB_TRANSCODE } from '../media-pipeline.service';
import { Media } from '../entities/media.entity';
import { MediaStatus } from '../enums/media-status.enum';
import { MediaType } from '../enums/media-type.enum';
import { MediaProvider } from '../enums/media-provider.enum';
import { ContentPublishService } from '../content-publish.service';
import { assertMediaUpdated } from '../media-update.util';
import { getS3Bucket, getS3Client } from 'src/common/s3/s3.client';
import { S3Provider } from 'src/common/s3/s3.provider';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/** BullMQ default lock is 30s — video transcode can run many minutes. */
const TRANSCODE_WORKER_OPTIONS = {
  concurrency: 1,
  lockDuration: 1_800_000,
  stalledInterval: 600_000,
  maxStalledCount: 1,
} as const;

@Processor(MEDIA_TRANSCODE_QUEUE, TRANSCODE_WORKER_OPTIONS)
export class MediaTranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaTranscodeProcessor.name);

  constructor(
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    private readonly s3Provider: S3Provider,
    private readonly contentPublishService: ContentPublishService,
  ) {
    super();
  }

  async process(job: Job<{ mediaId: string }>) {
    if (job.name !== MEDIA_JOB_TRANSCODE) {
      return;
    }

    const media = await this.mediaRepo.findOne({
      where: { id: job.data.mediaId },
    });

    if (!media) {
      return;
    }

    if (media.provider !== MediaProvider.S3) {
      return;
    }

    if (this.isTranscodeComplete(media)) {
      this.logger.log(`Transcode already complete for ${media.id}, skipping`);
      if (media.status !== MediaStatus.READY) {
        const ready = await this.mediaRepo.update(media.id, {
          status: MediaStatus.READY,
        });
        assertMediaUpdated(ready, media.id, 'transcode skip → ready');
        this.logger.log(
          `media lifecycle mediaId=${media.id} processing→ready`,
        );
        await this.contentPublishService.onMediaEnriched(media.id);
      }
      return;
    }

    try {
      if (media.type === MediaType.IMAGE) {
        await this.processImage(media);
      } else if (media.type === MediaType.VIDEO) {
        await this.processVideo(media);
      } else {
        await this.processPassthrough(media);
      }

      const stillExists = await this.mediaRepo.findOne({
        where: { id: media.id },
      });
      if (!stillExists) {
        return;
      }

      const ready = await this.mediaRepo.update(media.id, {
        status: MediaStatus.READY,
      });
      assertMediaUpdated(ready, media.id, 'transcode → ready');
      this.logger.log(`media lifecycle mediaId=${media.id} processing→ready`);
      await this.contentPublishService.onMediaEnriched(media.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const fresh = await this.mediaRepo.findOne({
        where: { id: media.id },
      });
      if (fresh && this.isTranscodeComplete(fresh)) {
        this.logger.warn(
          `Transcode job errored after output was written for ${media.id}: ${message}`,
        );
        if (fresh.status !== MediaStatus.READY) {
          const ready = await this.mediaRepo.update(media.id, {
            status: MediaStatus.READY,
          });
          assertMediaUpdated(ready, media.id, 'transcode recovery → ready');
          this.logger.log(
            `media lifecycle mediaId=${media.id} processing→ready`,
          );
          await this.contentPublishService.onMediaEnriched(media.id);
        }
        return;
      }

      this.logger.error(`Transcode failed for ${media.id}: ${message}`);
      this.logger.warn(
        `Keeping media ${media.id} deliverable via original after transcode failure`,
      );

      await this.mediaRepo.update(media.id, {
        status: MediaStatus.PROCESSING,
        originalUrl: this.s3Provider.getPublicUrl(media.sourceIdOrKey),
      });
      await this.contentPublishService.onTranscodeFailed(media.id, message);
    }
  }

  private isTranscodeComplete(media: Media): boolean {
    const variants = (media.variants ?? {}) as Record<string, string>;
    if (media.type === MediaType.VIDEO) {
      return Boolean(variants.hls && variants.poster);
    }
    if (media.type === MediaType.IMAGE) {
      return Boolean(variants.low);
    }
    return media.status === MediaStatus.READY;
  }

  private async processPassthrough(media: Media) {
    const originalUrl = this.s3Provider.getPublicUrl(media.sourceIdOrKey);
    await this.mediaRepo.update(media.id, {
      originalUrl,
      streamUrl: media.type === MediaType.AUDIO ? originalUrl : media.streamUrl,
    });
  }

  private async processImage(media: Media) {
    const bucket = getS3Bucket();
    const key = media.sourceIdOrKey;
    const file = await getS3Client()
      .getObject({ Bucket: bucket, Key: key })
      .promise();
    const buffer = file.Body as Buffer;
    const baseKey = key.replace(/\.[^/.]+$/, '');

    const thumbnailBuffer = await sharp(buffer)
      .resize(400, 400, { fit: 'inside' })
      .webp({ quality: 70 })
      .toBuffer();

    const lowBuffer = await sharp(buffer)
      .resize(800, 800, { fit: 'inside' })
      .webp({ quality: 75 })
      .toBuffer();

    const thumbKey = `${baseKey}-thumb.webp`;
    const lowKey = `${baseKey}-low.webp`;

    await this.putObject(thumbKey, thumbnailBuffer, 'image/webp');
    await this.putObject(lowKey, lowBuffer, 'image/webp');

    await this.mediaRepo.update(media.id, {
      originalUrl: this.s3Provider.getPublicUrl(key),
      thumbnailUrl: this.s3Provider.getPublicUrl(thumbKey),
      lowUrl: this.s3Provider.getPublicUrl(lowKey),
      variants: { poster: thumbKey, low: lowKey },
    });
  }

  private async processVideo(media: Media) {
    const bucket = getS3Bucket();
    const key = media.sourceIdOrKey;
    const baseKey = key.replace(/\.[^/.]+$/, '');
    const outputPrefix = `${baseKey}/hls`;
    const mp4Key = `${outputPrefix}/stream.mp4`;
    const playlistKey = `${outputPrefix}/index.m3u8`;
    const posterKey = `${baseKey}-poster.webp`;

    await this.withLocalInputFile(bucket, key, async (localPath) => {
      await this.transcodeMp4FromFile(localPath, mp4Key);
      await this.generateVideoPosterFromFile(localPath, posterKey);
    });

    await this.putObject(
      playlistKey,
      Buffer.from(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:10',
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-PLAYLIST-TYPE:VOD',
          '#EXTINF:10.0,',
          'stream.mp4',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      'application/vnd.apple.mpegurl',
    );

    await this.mediaRepo.update(media.id, {
      originalUrl: this.s3Provider.getPublicUrl(key),
      streamUrl: this.s3Provider.getPublicUrl(playlistKey),
      thumbnailUrl: this.s3Provider.getPublicUrl(posterKey),
      variants: { hls: playlistKey, poster: posterKey },
    });
  }

  private async withLocalInputFile(
    bucket: string,
    key: string,
    fn: (localPath: string) => Promise<void>,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'media-transcode-'));
    const ext = key.includes('.') ? key.slice(key.lastIndexOf('.')) : '.bin';
    const localPath = join(dir, `input${ext}`);

    try {
      const readStream = getS3Client()
        .getObject({ Bucket: bucket, Key: key })
        .createReadStream();
      await pipeline(readStream, createWriteStream(localPath));
      await fn(localPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private putObject(key: string, body: Buffer, contentType: string) {
    return getS3Client()
      .putObject({
        Bucket: getS3Bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      })
      .promise();
  }

  private transcodeMp4FromFile(
    localPath: string,
    outputKey: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const outputStream = new PassThrough();

      outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));

      ffmpeg(localPath)
        .inputOptions(['-analyzeduration', '100M', '-probesize', '100M'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .size('?x720')
        .format('mp4')
        .outputOptions('-movflags', 'frag_keyframe+empty_moov')
        .on('error', reject)
        .pipe(outputStream, { end: true });

      outputStream.on('end', async () => {
        try {
          await this.putObject(outputKey, Buffer.concat(chunks), 'video/mp4');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async generateVideoPosterFromFile(
    localPath: string,
    posterKey: string,
  ): Promise<void> {
    const posterDir = await mkdtemp(join(tmpdir(), 'media-poster-'));

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(localPath)
          .screenshots({
            timestamps: ['00:00:01.000'],
            filename: 'frame.jpg',
            folder: posterDir,
            size: '640x?',
          })
          .on('end', () => resolve())
          .on('error', reject);
      });

      const framePath = join(posterDir, 'frame.jpg');
      const poster = await sharp(await readFile(framePath))
        .resize(640, 360, { fit: 'cover' })
        .webp()
        .toBuffer();
      await this.putObject(posterKey, poster, 'image/webp');
    } catch {
      const placeholder = await sharp({
        create: {
          width: 640,
          height: 360,
          channels: 3,
          background: { r: 20, g: 20, b: 20 },
        },
      })
        .webp()
        .toBuffer();
      await this.putObject(posterKey, placeholder, 'image/webp');
    } finally {
      await rm(posterDir, { recursive: true, force: true });
    }
  }
}
