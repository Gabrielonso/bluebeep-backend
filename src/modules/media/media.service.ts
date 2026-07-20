import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUploadDto } from './dtos/create-upload.dto';
import { MEDIA_PROVIDER } from 'src/common/constants';
import { IMediaStorageProvider } from 'src/common/interfaces/media-provider.interface';
import { MediaType } from './enums/media-type.enum';
import { successResponse } from 'src/common/helpers/response.helper';
import { Media } from './entities/media.entity';
import { MediaStatus } from './enums/media-status.enum';
import { MediaStorageRegistry } from 'src/common/media/media-storage.registry';
import { MediaUrlResolver } from 'src/common/media/media-url.resolver';
import { MediaPipelineService } from './media-pipeline.service';
import { MediaProvider } from './enums/media-provider.enum';
import { S3Provider } from 'src/common/s3/s3.provider';
import { getDefaultMediaProvider } from 'src/config/aws.config';
import { MediaQueueService } from './media-queue.service';
import { effectiveMediaStatus } from './media-delivery.util';

@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_PROVIDER)
    private readonly mediaProvider: IMediaStorageProvider,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    private readonly storageRegistry: MediaStorageRegistry,
    private readonly urlResolver: MediaUrlResolver,
    private readonly pipelineService: MediaPipelineService,
    private readonly s3Provider: S3Provider,
    private readonly mediaQueueService: MediaQueueService,
  ) {}

  async createUploadCredentials(userId: string, dto: CreateUploadDto) {
    this.validateUploadDto(dto);
    const data = await this.mediaProvider.generateUploadCredentials({
      userId,
      ...dto,
    });
    return successResponse('Successfully generated credentials', data);
  }

  async createUpload(userId: string, dto: CreateUploadDto) {
    try {
      this.validateUploadDto(dto);

      if (getDefaultMediaProvider() !== 's3') {
        throw new BadRequestException(
          'Use POST /media/upload-credentials when MEDIA_PROVIDER is cloudinary',
        );
      }

      const credentials = await this.s3Provider.generateUploadCredentials({
        userId,
        ...dto,
      });
      console.log(credentials, '<<==credentials');
      const key = credentials.data.key as string;

      const media = this.mediaRepo.create({
        provider: MediaProvider.S3,
        type: dto.type,
        sourceIdOrKey: key,
        ownerId: userId,
        uploadFolder: dto.uploadFolder,
        mimeType: dto.mimeType,
        size: dto.size,
        width: dto.width,
        height: dto.height,
        duration: dto.duration,
        fileName: dto.fileName,
        status: MediaStatus.UPLOADING,
      });
      const saved = await this.mediaRepo.save(media);

      return successResponse('Upload session created', {
        mediaId: saved.id,
        provider: MediaProvider.S3,
        uploadUrl: credentials.data.uploadUrl,
        key,
        publicUrl: credentials.data.publicUrl,
        expiresIn: credentials.data.expiresIn,
      });
    } catch (error) {
      console.error('[create upload]:', error);
      throw error;
    }
  }

  async completeUpload(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.ownerId !== userId) {
      throw new ForbiddenException('You do not own this media upload');
    }
    if (media.status !== MediaStatus.UPLOADING) {
      throw new BadRequestException(
        `Media is not uploading (status: ${media.status})`,
      );
    }

    const updated = await this.pipelineService.routeAfterUpload(mediaId);
    return successResponse('Upload completed', this.serializeUpload(updated));
  }

  async getUploadStatus(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.ownerId && media.ownerId !== userId) {
      throw new ForbiddenException('You do not own this media upload');
    }
    return successResponse('Upload status', this.serializeUpload(media));
  }

  async requestCancelUpload(userId: string, mediaId: string) {
    await this.mediaQueueService.enqueueCancel(mediaId, userId);
    return successResponse(
      'Cancel requested',
      { mediaId, pending: true },
      HttpStatus.ACCEPTED,
    );
  }

  private serializeUpload(media: Media) {
    const playback = this.urlResolver.hasPlayback(media)
      ? this.urlResolver.toPlaybackPayload(media)
      : null;
    const dims = this.urlResolver.mediaDimensions(media);

    return {
      id: media.id,
      status: effectiveMediaStatus(media),
      moderationStatus: media.moderationStatus,
      rejectionReason: media.rejectionReason,
      provider: media.provider,
      type: media.type,
      width: dims.width,
      height: dims.height,
      duration: dims.duration,
      aspectRatio: dims.aspectRatio,
      fileName: dims.fileName,
      originalUrl: this.resolveOriginalUrl(media),
      playback,
    };
  }

  private resolveOriginalUrl(media: Media): string | null {
    if (media.originalUrl) {
      return media.originalUrl;
    }
    if (!media.sourceIdOrKey || !this.urlResolver.hasPlayback(media)) {
      return null;
    }
    return this.urlResolver.resolve(media).original ?? null;
  }

  private validateUploadDto(dto: CreateUploadDto) {
    if (dto.type === MediaType.VIDEO && !dto.mimeType.startsWith('video/')) {
      throw new BadRequestException('Invalid video mime type');
    }
    if (dto.type === MediaType.IMAGE && !dto.mimeType.startsWith('image/')) {
      throw new BadRequestException('Invalid image mime type');
    }
    if (dto.type === MediaType.AUDIO && !dto.mimeType.startsWith('audio/')) {
      throw new BadRequestException('Invalid audio mime type');
    }

    if (
      (dto.type === MediaType.IMAGE || dto.type === MediaType.VIDEO) &&
      (dto.width != null) !== (dto.height != null)
    ) {
      throw new BadRequestException(
        'width and height must both be provided or omitted',
      );
    }
  }
}
