import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  type UploadImageDto,
  type UploadImageResponse,
} from '@dbdesigner/shared';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';

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

  /** The file as a `data:` URI (for embedding in exported SVG/PNG/PDF), or null if unavailable. */
  async dataUrl(fileId: string): Promise<string | null> {
    const blob = await this.blob(fileId);
    return blob ? this.blobToDataUrl(blob) : null;
  }

  /** Validate, upload and cache a user-supplied image file. Throws a readable Error. */
  async upload(projectId: string, file: Blob): Promise<UploadedImage> {
    const mimeType = file.type;
    if (!IMAGE_MIME_TYPES.includes(mimeType)) {
      throw new Error('Unsupported image type. Use PNG, JPG, GIF, WebP or SVG.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Images can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
    }
    const [dataUrl, size] = await Promise.all([this.blobToDataUrl(file), this.naturalSize(file)]);
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
