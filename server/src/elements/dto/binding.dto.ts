import { IsIn, IsString } from 'class-validator';
import type { ElementBinding } from '@dbdesigner/shared';

/** A line/arrow endpoint bound to a shape or ERD table. */
export class BindingDto implements ElementBinding {
  @IsIn(['element', 'table'])
  targetKind!: 'element' | 'table';

  @IsString()
  targetId!: string;
}
