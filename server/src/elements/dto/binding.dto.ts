import { IsIn, IsString } from 'class-validator';
import type { ElementBinding } from '@dbdesigner/shared';

/** A line/arrow endpoint bound to a shape, ERD table, or sequence message label. */
export class BindingDto implements ElementBinding {
  @IsIn(['element', 'table', 'message'])
  targetKind!: 'element' | 'table' | 'message';

  @IsString()
  targetId!: string;
}
