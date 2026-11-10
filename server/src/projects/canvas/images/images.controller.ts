import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { UploadImageResponse } from '@devdesigner/shared';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';
import { UploadImageDto } from './dto/upload-image.dto';
import { ImagesService } from './images.service';

/** Upload and fetch the image files behind canvas image elements. */
@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post('projects/:projectId/images')
  @RequiresAccess('write')
  upload(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: UploadImageDto,
  ): Promise<UploadImageResponse> {
    return this.images.upload(projectId, dto.mimeType, dto.data);
  }

  @Get('images/:imageId')
  @RequiresAccess('read', { from: 'image' })
  async get(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { mimeType, data } = await this.images.read(projectId, imageId);
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
