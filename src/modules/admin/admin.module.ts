import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Comment } from '../engagements/entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { Ad } from '../ads/entities/ads.entity';
import { Thought } from '../thought/entities/thought.entity';
import { Status } from '../status/entities/status.entity';
import { User } from '../user/entity/user.entity';
import { EngagementsModule } from '../engagements/engagements.module';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
  imports: [
    TypeOrmModule.forFeature([Comment, Post, Ad, Thought, Status, User]),
    EngagementsModule,
  ],
})
export class AdminModule {}
