import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  MEDIA_MIME_TYPES,
  VIDEO_MIME_TYPES,
  maxMediaBytes,
  type UploadImageDto,
  type UploadImageResponse,
} from '@devdesigner/shared';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';

/** What a file is: a still picture, an animated GIF, or a video. */
export type MediaKind = 'image' | 'gif' | 'video';

/** An image that was accepted and stored, with its natural size in pixels. */
export interface UploadedImage {
  fileId: string;
  width: number;
  height: number;
}

/**
 * Loads and caches the files behind canvas image elements. Files are fetched
 * through HttpClient (so auth cookie / share token headers apply, which a bare
 * <img src> could not carry) and exposed as object URLs. Images are only ever
 * shown through <image>/<img>, so an SVG can never run script.
 */
@Injectable({ providedIn: 'root' })
export class ElementImagesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);

  /** fileId -> object URL, for files that have finished loading. */
  private readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  private readonly blobs = new Map<string, Promise<Blob | null>>();
  /** fileId -> kind, for files that have finished loading. */
  private readonly kinds = signal<ReadonlyMap<string, MediaKind>>(new Map());
  /** fileId -> object URL of the first frame (GIFs and videos), once made. */
  private readonly posters = signal<ReadonlyMap<string, string>>(new Map());
  private readonly posterBlobs = new Map<string, Promise<Blob | null>>();

  /**
   * The object URL for a file, or null while it loads (reading it in a template or
   * computed re-evaluates once the file arrives). Kicks off the fetch on first ask.
   */
  url(fileId: string | undefined): string | null {
    if (!fileId) {
      return null;
    }
    const url = this.urls().get(fileId);
    if (!url) {
      void this.blob(fileId);
    }
    return url ?? null;
  }

  /** What the file is, or null while it loads (reactive, like `url`). */
  kind(fileId: string | undefined): MediaKind | null {
    if (!fileId) {
      return null;
    }
    const kind = this.kinds().get(fileId);
    if (!kind) {
      void this.blob(fileId);
    }
    return kind ?? null;
  }

  /** Object URL of a GIF's or video's first frame, or null while it is made (reactive). */
  posterUrl(fileId: string | undefined): string | null {
    if (!fileId) {
      return null;
    }
    const url = this.posters().get(fileId);
    if (!url) {
      void this.poster(fileId);
    }
    return url ?? null;
  }

  /** The file as a `data:` URI (for embedding in exported SVG/PNG/PDF), or null if unavailable. */
  async dataUrl(fileId: string): Promise<string | null> {
    const blob = await this.blob(fileId);
    return blob ? this.blobToDataUrl(blob) : null;
  }

  /**
   * The picture an export draws for a file: a still first frame for GIFs and videos
   * (a static picture cannot play), the file itself otherwise.
   */
  async stillDataUrl(fileId: string): Promise<string | null> {
    const blob = await this.blob(fileId);
    if (!blob) {
      return null;
    }
    if (kindOf(blob.type) === 'image') {
      return this.blobToDataUrl(blob);
    }
    const still = await this.poster(fileId);
    return still ? this.blobToDataUrl(still) : null;
  }


  /** Validate, upload and cache a user-supplied image file. Throws a readable Error. */
  async upload(projectId: string, file: Blob): Promise<UploadedImage> {
    const mimeType = file.type;
    if (!MEDIA_MIME_TYPES.includes(mimeType)) {
      throw new Error('Unsupported file type. Use PNG, JPG, GIF, WebP, SVG, MP4 or WebM.');
    }
    const max = maxMediaBytes(mimeType);
    if (file.size > max) {
      const what = VIDEO_MIME_TYPES.includes(mimeType) ? 'Videos' : 'Images';
      throw new Error(`${what} can be at most ${max / (1024 * 1024)} MB.`);
    }
    const [dataUrl, size] = await Promise.all([
      this.blobToDataUrl(file),
      VIDEO_MIME_TYPES.includes(mimeType) ? this.videoSize(file) : this.naturalSize(file),
    ]);
    const body: UploadImageDto = { mimeType, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
    let response: UploadImageResponse;
    try {
      response = await firstValueFrom(
        this.api.post<UploadImageResponse>(`/projects/${projectId}/images`, body),
      );
    } catch (err) {
      throw new Error(this.serverMessage(err) ?? 'The image could not be uploaded.');
    }
    this.seed(response.id, file);
    return { fileId: response.id, ...size };
  }

  private blob(fileId: string): Promise<Blob | null> {
    let pending = this.blobs.get(fileId);
    if (!pending) {
      pending = firstValueFrom(
        this.http.get(`${environment.apiBaseUrl}/images/${fileId}`, { responseType: 'blob' }),
      )
        .then((blob) => {
          this.publish(fileId, blob);
          return blob;
        })
        .catch(() => null);
      this.blobs.set(fileId, pending);
    }
    return pending;
  }

  /** Remember a just-uploaded file so showing it needs no round trip. */
  private seed(fileId: string, blob: Blob): void {
    this.blobs.set(fileId, Promise.resolve(blob));
    this.publish(fileId, blob);
  }

  private publish(fileId: string, blob: Blob): void {
    const next = new Map(this.urls());
    next.set(fileId, URL.createObjectURL(blob));
    this.urls.set(next);
    const kinds = new Map(this.kinds());
    kinds.set(fileId, kindOf(blob.type));
    this.kinds.set(kinds);
  }

  /** The first frame of a GIF or video as a PNG (null for still pictures or on failure). */
  private poster(fileId: string): Promise<Blob | null> {
    let pending = this.posterBlobs.get(fileId);
    if (!pending) {
      pending = this.blob(fileId).then(async (blob) => {
        const kind = blob ? kindOf(blob.type) : 'image';
        if (!blob || kind === 'image') {
          return null;
        }
        const still = kind === 'video' ? await this.videoFrame(blob) : await this.imageFrame(blob);
        if (still) {
          const next = new Map(this.posters());
          next.set(fileId, URL.createObjectURL(still));
          this.posters.set(next);
        }
        return still;
      });
      this.posterBlobs.set(fileId, pending);
    }
    return pending;
  }

  /** Draw a decoded picture (its first frame, for a GIF) to a PNG. */
  private imageFrame(blob: Blob): Promise<Blob | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(this.canvasPng(img, img.naturalWidth, img.naturalHeight));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  /** Grab a video's opening frame as a PNG. */
  private videoFrame(blob: Blob): Promise<Blob | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      const done = (result: Blob | null): void => {
        URL.revokeObjectURL(url);
        resolve(result);
      };
      video.onloadeddata = () => {
        // A hair past zero: some encoders leave frame 0 black.
        video.currentTime = Math.min(0.05, (video.duration || 1) / 2);
      };
      video.onseeked = () =>
        void this.canvasPng(video, video.videoWidth, video.videoHeight).then(done);
      video.onerror = () => done(null);
      video.src = url;
    });
  }

  private canvasPng(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
    if (!width || !height) {
      return Promise.resolve(null);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  }

  /** Natural pixel size of a video file (a fallback 16:9 when it cannot be determined). */
  private videoSize(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      const done = (width: number, height: number): void => {
        URL.revokeObjectURL(url);
        resolve({ width: width || 640, height: height || 360 });
      };
      video.preload = 'metadata';
      video.onloadedmetadata = () => done(video.videoWidth, video.videoHeight);
      video.onerror = () => done(0, 0);
      video.src = url;
    });
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
      reader.readAsDataURL(blob);
    });
  }

  /** Natural pixel size of an image file (a fallback square when it can't be determined). */
  private naturalSize(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      const done = (width: number, height: number): void => {
        URL.revokeObjectURL(url);
        resolve({ width: width || 240, height: height || 240 });
      };
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = () => done(0, 0);
      img.src = url;
    });
  }

  private serverMessage(err: unknown): string | null {
    const message = (err as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === 'string') {
      return message;
    }
    return Array.isArray(message) && typeof message[0] === 'string' ? message[0] : null;
  }
}

function kindOf(mimeType: string): MediaKind {
  return mimeType.startsWith('video/') ? 'video' : mimeType === 'image/gif' ? 'gif' : 'image';
}
