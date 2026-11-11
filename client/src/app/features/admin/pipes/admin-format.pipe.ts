import { Pipe, type PipeTransform } from '@angular/core';
import { formatValue } from '../helpers/admin-format.helpers';
import type { AdminValueFormat } from '../models/admin.models';

/** `{{ bytes | adminFormat: 'bytes' }}`: counts, bytes, ms, percents and dates as the dashboard shows them. */
@Pipe({ name: 'adminFormat' })
export class AdminFormatPipe implements PipeTransform {
   transform(value: unknown, format: AdminValueFormat = 'count'): string {
      return formatValue(value, format);
   }
}
