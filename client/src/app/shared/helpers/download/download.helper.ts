/** Saving files from the browser as ordinary downloads. */

/**
 * Save a Blob as a normal browser download under `filename`, so it shows in the
 * browser's downloads list (Chrome's download bubble). The native save-file picker
 * is not used: files written through it never appear there.
 */
export function downloadBlob(blob: Blob, filename: string): void {
   const url = URL.createObjectURL(blob);
   const anchor = document.createElement('a');
   anchor.href = url;
   anchor.download = filename;
   document.body.appendChild(anchor);
   anchor.click();
   anchor.remove();
   // Revoke a little later so the browser has started reading the blob.
   setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download a raw string (SQL, SVG markup) as a text-ish file. */
export function downloadText(text: string, filename: string, mime: string): void {
   downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
