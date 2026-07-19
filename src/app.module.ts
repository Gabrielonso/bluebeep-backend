import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ormConfig } from './config/orm-config';
import { SeederModule } from './database/seeder/seeder.module';
import { PostModule } from './modules/posts/post.module';
import { StoryModule } from './modules/stories/story.module';
import { AdminModule } from './modules/admin/admin.module';
import { MediaModule } from './modules/media/media.module';
import { FeedModule } from './modules/feeds/feed.module';
import { AdModule } from './modules/ads/ad.module';
import { EngagementsModule } from './modules/engagements/engagements.module';
import { RelationshipsModule } from './modules/relationships/relationships.module';
import { TrendsModule } from './modules/trends/trends.module';
import { SoundsModule } from './modules/sounds/sounds.module';
import { AccountActivityModule } from './modules/account-activity/account-activity.module';
import { BullModule } from '@nestjs/bullmq';
import { NotificationModule } from './modules/notification/notification.module';
import { ThoughtModule } from './modules/thought/thought.module';
import { ChatsModule } from './modules/chats/chats.module';
import { RealtimeModule } from './realtime/realtime.module';
import { CallsModule } from './modules/calls/calls.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { StatusModule } from './modules/status/status.module';
import { SearchModule } from './modules/search/search.module';
import { RedisModule } from './common/redis/redis.module';
import { MailModule } from './libs/mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT') || 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          username: configService.get<string>('REDIS_USERNAME') || undefined,
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ormConfig,
    }),
    SeederModule,
    AuthModule,
    UserModule,
    PostModule,
    StoryModule,
    AdminModule,
    MediaModule,
    FeedModule,
    AdModule,
    EngagementsModule,
    RelationshipsModule,
    TrendsModule,
    SoundsModule,
    AccountActivityModule,
    NotificationModule,
    ThoughtModule,
    ChatsModule,
    RealtimeModule,
    CallsModule,
    StatusModule,
    SearchModule,
    MailModule,
    EventEmitterModule.forRoot({ global: true }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
