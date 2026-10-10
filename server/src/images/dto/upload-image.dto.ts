import { IsString, MaxLength } from 'class-validator';
import type { UploadImageDto as IUploadImageDto } from '@dbdesigner/shared';

/** Body for POST /projects/:projectId/images (base64 keeps this a plain JSON route). */
export class UploadImageDto implements IUploadImageDto {
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  // 5 MB of bytes is ~7 MB of base64; the byte limit is enforced after decoding.
  @IsString()
  @MaxLength(8_000_000)
  data!: string;
}
