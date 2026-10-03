import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { SequenceMessageModel } from '@dbdesigner/shared';
import { SequenceMessagesService } from './sequence-messages.service';
import { CreateSequenceMessageDto } from './dto/create-sequence-message.dto';
import { UpdateSequenceMessageDto } from './dto/update-sequence-message.dto';
import { UpdateSequenceMessagePositionDto } from './dto/update-sequence-message-position.dto';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

@Controller()
export class SequenceMessagesController {
  constructor(private readonly messages: SequenceMessagesService) {}

  @Post('projects/:projectId/sequence-messages')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSequenceMessageDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<SequenceMessageModel> {
    return this.messages.create(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('sequence-messages/:messageId')
  update(
    @Param('messageId') messageId: string,
    @Body() dto: UpdateSequenceMessageDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<SequenceMessageModel> {
    return this.messages.update(messageId, dto, userId, shareToken, clientId);
  }

  @Patch('sequence-messages/:messageId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePosition(
    @Param('messageId') messageId: string,
    @Body() dto: UpdateSequenceMessagePositionDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.messages.updatePosition(messageId, dto, userId, shareToken, clientId);
  }

  @Delete('sequence-messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('messageId') messageId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.messages.remove(messageId, userId, shareToken, clientId);
  }
}
