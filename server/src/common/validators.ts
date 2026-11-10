import { BadRequestException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { ValidateBy, validateSync, type ValidationError, type ValidationOptions } from 'class-validator';
import { isColorValue } from '@devdesigner/shared';
import { layoutItemsError, themeLayoutsError, extraLayoutsError } from './theme-validation';

/**
 * `@IsColor()`: a stored color (security H-1 / S1.2), checked with the shared
 * `isColorValue` (#hex, `transparent`, palette names, `$theme` tokens, the theme
 * sentinels, '' to clear). Anything that could break out of an SVG/CSS attribute
 * is refused.
 */
export function IsColor(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isColor',
      validator: {
        validate: (value: unknown) => isColorValue(value),
        defaultMessage: (args) => `${args?.property ?? 'color'} must be a color (#hex, a palette name or a $theme token)`,
      },
    },
    options,
  );
}

/** Serialized JSON size cap for free-form blobs (theme designs). */
export function MaxJsonSize(bytes: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'maxJsonSize',
      validator: {
        validate: (value: unknown) => value === undefined || jsonSize(value) <= bytes,
        defaultMessage: (args) => `${args?.property ?? 'value'} is too large (at most ${Math.round(bytes / 1024)} KB)`,
      },
    },
    options,
  );
}

/** Validates a property with a function returning an error message or null. */
function checkedBy(name: string, check: (value: unknown) => string | null, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown) => value === undefined || value === null || check(value) === null,
        defaultMessage: (args) => `${args?.property ?? name}: ${check(args?.value) ?? 'invalid'}`,
      },
    },
    options,
  );
}

/** A theme's master items (security M-4 / S2.2): every item a valid layout item. */
export const IsLayoutItems = (options?: ValidationOptions): PropertyDecorator =>
  checkedBy('isLayoutItems', (v) => layoutItemsError(v, 'items'), options);

/** A theme's per-kind layout designs. */
export const IsThemeLayouts = (options?: ValidationOptions): PropertyDecorator =>
  checkedBy('isThemeLayouts', (v) => themeLayoutsError(v, 'layouts'), options);

/** A theme's extra (non-standard) layouts. */
export const IsExtraLayouts = (options?: ValidationOptions): PropertyDecorator =>
  checkedBy('isExtraLayouts', (v) => extraLayoutsError(v, 'extraLayouts'), options);

export function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function messages(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {});
    const nested = messages(e.children ?? [], path);
    return own.length || nested.length ? [...own, ...nested] : [`${path} is invalid`];
  });
}

/**
 * Validate a plain object against a DTO class with the same rules as the global
 * ValidationPipe (whitelist + forbidNonWhitelisted), for bodies that are not one DTO
 * (batch, clone, theme layout items). Returns the transformed instance or throws 400
 * prefixed with `label` (e.g. `elements[<id>]`).
 */
export function validated<T extends object>(cls: ClassConstructor<T>, label: string, plain: object): T {
  const dto = plainToInstance(cls, plain);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    throw new BadRequestException(`${label}: ${messages(errors).join('; ')}`);
  }
  return dto;
}

/** Like `validated`, but returns the first error message instead of throwing (null when valid). */
export function validationError<T extends object>(cls: ClassConstructor<T>, plain: object): string | null {
  const errors = validateSync(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errors.length ? messages(errors).join('; ') : null;
}
