import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { UploadImageResponse } from '@devdesigner/shared';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ShareToken } from '../platform/http/request.decorators';
import { UploadImageDto } from './dto/upload-image.dto';
import { ImagesService } from './images.service';

/** Upload and fetch the image files behind canvas image elements. */
@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post('projects/:projectId/images')
  upload(
    @Param('projectId') projectId: string,
    @Body() dto: UploadImageDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
  ): Promise<UploadImageResponse> {
    return this.images.upload(projectId, dto.mimeType, dto.data, userId, shareToken);
  }

  @Get('images/:imageId')
  async get(
    @Param('imageId') imageId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @Res() res: Response,
  ): Promise<void> {
    const { mimeType, data } = await this.images.read(imageId, userId, shareToken);
    res
      .set({
        'Content-Type': mimeType,
        // Belt and braces: even if opened directly, an SVG can't run script or load anything.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
      })
      .send(data);
  }
}
