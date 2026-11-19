/** Saving files from the browser: a native save dialog where supported, else a plain download. */

type SavePicker = (options: {
   suggestedName?: string;
   types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;

/**
 * Save a Blob, letting the user pick the file name (and folder) in a native save
 * dialog where the browser supports it; otherwise a plain download under `filename`.
 */
export function downloadBlob(blob: Blob, filename: string): void {
   const picker = (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
   if (!picker) {
      anchorDownload(blob, filename);
      return;
   }
   // Everything after the first dot is the extension (".devdesigner.json" stays whole).
   const dot = filename.indexOf('.');
   const ext = dot > 0 ? filename.slice(dot) : '';
   const mime = blob.type.split(';')[0] || 'application/octet-stream';
   void (async () => {
      try {
         const handle = await picker({
            suggestedName: filename,
            types: ext ? [{ accept: { [mime]: [ext.slice(ext.lastIndexOf('.'))] } }] : undefined,
         });
         const writable = await handle.createWritable();
         await writable.write(blob);
         await writable.close();
      } catch (err) {
         // Cancelled by the user: nothing to do. Anything else (e.g. the click's user
         // activation expired during a slow render): fall back to a plain download.
         if ((err as DOMException)?.name !== 'AbortError') anchorDownload(blob, filename);
      }
   })();
}

function anchorDownload(blob: Blob, filename: string): void {
   const url = URL.createObjectURL(blob);
   const anchor = document.createElement('a');
   anchor.href = url;
   anchor.download = filename;
   document.body.appendChild(anchor);
   anchor.click();
   anchor.remove();
   // Revoke on the next tick so the click has a chance to start the download.
   setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download a raw string (SQL, SVG markup) as a text-ish file. */
export function downloadText(text: string, filename: string, mime: string): void {
   downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
