import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LikesService } from './services/likes.services';
import { ToggleLikeDto } from './dtos/toggle-like.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CreateCommentDto } from './dtos/create-comment.dto';
import { CommentsService } from './services/comments.services';
import { CommentsQueryDto } from './dtos/comments-query.dto';
import { ReplyCommentDto } from './dtos/reply-comment.dto';
import { BookmarksService } from './services/bookmarks.services';
import { ToggleBookmarkDto } from './dtos/toggle-bookmark.dto';
import { RepostsService } from './services/reposts.services';
import { ToggleRepostDto } from './dtos/toggle-repost.dto';

@ApiTags('Engagements')
@ApiBearerAuth()
@Controller('engagements')
@UseGuards(JwtAuthGuard)
export class EngagementsController {
  constructor(
    private readonly likesService: LikesService,
    private readonly commentsService: CommentsService,
    private readonly bookmarksService: BookmarksService,
    private readonly repostsService: RepostsService,
  ) {}

  @Post('likes')
  @ApiOperation({ summary: 'Toggle like for a post, ad, etc' })
  @ApiBody({ type: ToggleLikeDto })
  async toggleLike(@Req() req, @Body() dto: ToggleLikeDto) {
    const userId: string = req.user.id;
    return this.likesService.toggleLike(dto.entity, dto.entityId, userId);
  }

  @Post('bookmarks')
  @ApiOperation({ summary: 'Toggle bookmark for a post, ad, etc' })
  @ApiBody({ type: ToggleLikeDto })
  async toggleBookmark(@Req() req, @Body() dto: ToggleBookmarkDto) {
    const userId: string = req.user.id;
    return this.bookmarksService.toggleBookmark(
      dto.entity,
      dto.entityId,
      userId,
    );
  }

  @Post('reposts')
  @ApiOperation({ summary: 'Toggle repost for a post' })
  @ApiBody({ type: ToggleRepostDto })
  async toggleRepost(@Req() req, @Body() dto: ToggleRepostDto) {
    const userId: string = req.user.id;
    return this.repostsService.toggleRepost(dto.postId, userId);
  }

  @Get('reposts/:postId/reposters')
  @ApiOperation({ summary: 'Get users who reposted a post' })
  @ApiParam({
    description: 'Post ID',
    example: 'fd9391ab-9f91-45ef-87a6-df076bb19d0c',
    name: 'postId',
  })
  async getReposters(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repostsService.getReposters(
      postId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Post('comments')
  @ApiOperation({ summary: 'Comment on a post,ad, etc' })
  @ApiBody({ type: CreateCommentDto })
  async createComment(@Req() req, @Body() dto: CreateCommentDto) {
    const userId: string = req.user.id;
    return this.commentsService.createComment(dto, userId);
  }

  @Get('comments')
  @ApiOperation({ summary: 'Get Comments' })
  getComments(@Query() commentsQueryDto: CommentsQueryDto, @Req() req) {
    return this.commentsService.getComments(
      commentsQueryDto.entity,
      commentsQueryDto.entityId,
      req.user?.id,
      req.user?.role,
    );
  }

  @Post('comments/:commentId/replies')
  @ApiOperation({ summary: 'Reply to a comment' })
  @ApiParam({
    description: 'Comment ID being replied to',
    example: 'fd9391ab-9f91-45ef-87a6-df076bb19d0c',
    name: 'commentId',
  })
  @ApiBody({ type: ReplyCommentDto })
  replyToComment(
    @Req() req,
    @Body() dto: ReplyCommentDto,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    const userId: string = req.user.id;
    return this.commentsService.replyToComment(commentId, dto.content, userId);
  }

  @Get('comments/:commentId/replies')
  @ApiOperation({ summary: 'Get replies to a comment' })
  @ApiParam({
    description: 'Comment ID',
    example: 'fd9391ab-9f91-45ef-87a6-df076bb19d0c',
    name: 'commentId',
  })
  getRepliesToComments(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() req,
  ) {
    return this.commentsService.getRepliesToComment(
      commentId,
      req.user?.id,
      req.user?.role,
    );
  }

  @Delete('comments/:commentId')
  @ApiOperation({ summary: 'Delete your comment/reply' })
  @ApiParam({
    description: 'Comment(reply) ID',
    example: 'fd9391ab-9f91-45ef-87a6-df076bb19d0c',
    name: 'commentId',
  })
  deleteComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() req,
  ) {
    const userId: string = req.user.id;
    return this.commentsService.deleteComment(commentId, userId);
  }
}
