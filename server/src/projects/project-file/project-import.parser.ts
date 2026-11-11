import { BadRequestException } from '@nestjs/common';
import {
  ProjectFileError,
  parseProjectExport as parseProjectFile,
  type ParsedProjectImport,
  type ThemeDesignPart,
} from '@devdesigner/shared';
import { extraLayoutsError, layoutItemsError, themeLayoutsError } from '../common/theme-validation';

export type { ParsedProjectImport } from '@devdesigner/shared';

/** The server's per-item checks for a theme's free-form parts (security M-4 / S2.2). */
const THEME_DESIGN_CHECKS: Record<ThemeDesignPart, (value: unknown, path: string) => string | null> = {
  layouts: themeLayoutsError,
  master: layoutItemsError,
  extraLayouts: extraLayoutsError,
};

/**
 * Validate an untrusted project export file and normalise it with the shared
 * parser (`@devdesigner/shared` project-file), adding the server's element-level
 * theme checks. Throws a 400 naming the offending field.
 */
export function parseProjectExport(raw: unknown): ParsedProjectImport {
  try {
    return parseProjectFile(raw, { checkThemeDesign: (part, value, path) => THEME_DESIGN_CHECKS[part](value, path) });
  } catch (error) {
    if (error instanceof ProjectFileError) throw new BadRequestException(error.message);
    throw error;
  }
}
