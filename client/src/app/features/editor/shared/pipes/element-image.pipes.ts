import { inject, Pipe, type PipeTransform } from '@angular/core';
import { ElementImagesService, type MediaKind } from '../../services/element-images.service';

/*
 * Image lookups for templates. They are impure on purpose: reading an image that is not
 * loaded yet starts loading it, and the result changes once it arrives, so they run on
 * every change detection, exactly like the service call they replace.
 */

/** `fileId | imageUrl`: object URL of a stored image / video, or null while it loads. */
@Pipe({ name: 'imageUrl', pure: false })
export class ImageUrlPipe implements PipeTransform {
   private readonly images = inject(ElementImagesService);
   transform(fileId: string | undefined): string | null {
      return this.images.url(fileId);
   }
}

/** `fileId | imageKind`: what the stored file is, or null while it loads. */
@Pipe({ name: 'imageKind', pure: false })
export class ImageKindPipe implements PipeTransform {
   private readonly images = inject(ElementImagesService);
   transform(fileId: string | undefined): MediaKind | null {
      return this.images.kind(fileId);
   }
}

/** `fileId | imagePoster`: first frame of a GIF or video, or null while it is made. */
@Pipe({ name: 'imagePoster', pure: false })
export class ImagePosterPipe implements PipeTransform {
   private readonly images = inject(ElementImagesService);
   transform(fileId: string | undefined): string | null {
      return this.images.posterUrl(fileId);
   }
}
