import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ImagesService } from './images.service';
import type { ProjectImageEntity } from './project-image.entity';
import type { ElementEntity } from '../elements/element.entity';
import type { AccessService } from '../access/access.service';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64');

/** validate(): the declared type must match the file's magic bytes. */
describe('ImagesService.validate', () => {
  const service = new ImagesService(
    {} as Repository<ProjectImageEntity>,
    {} as Repository<ElementEntity>,
    {} as AccessService,
  );

  it('accepts bytes that match the declared type', () => {
    expect(service.validate('image/png', PNG_1x1).length).toBeGreaterThan(0);
    expect(service.validate('image/svg+xml', b64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')).length).toBeGreaterThan(0);
    expect(service.validate('video/webm', b64(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).length).toBe(5);
    expect(service.validate('video/mp4', b64(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]))).length).toBe(12);
  });

  it('rejects a text file posing as an image', () => {
    expect(() => service.validate('image/png', b64('-----BEGIN OPENSSH PRIVATE KEY-----\n'))).toThrow(BadRequestException);
  });

  it('rejects a real image declared as another type', () => {
    expect(() => service.validate('image/jpeg', PNG_1x1)).toThrow(BadRequestException);
  });

  it('still rejects unsafe SVG', () => {
    expect(() => service.validate('image/svg+xml', b64('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'))).toThrow(
      BadRequestException,
    );
  });
});
