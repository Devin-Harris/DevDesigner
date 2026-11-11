/**
 * An invalid project file. The message names the offending field and is safe to
 * show to the user; the server maps it to a 400.
 */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}
