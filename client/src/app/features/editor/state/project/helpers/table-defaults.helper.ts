import type { TableModel } from '@devdesigner/shared';

/** Header colors assigned round-robin to new tables so the canvas reads clearly. */
export const TABLE_PALETTE = ['#e5484d', '#f5a623', '#12b76a', '#0ea5e9', '#2f6bff', '#7c5cff', '#ec4899', '#64748b'];

/** Generate a unique default table name like table_1, table_2, ... */
export function uniqueTableName(tables: readonly TableModel[]): string {
   const names = new Set(tables.map((t) => t.name));
   let i = tables.length + 1;
   let name = `table_${i}`;
   while (names.has(name)) {
      i += 1;
      name = `table_${i}`;
   }
   return name;
}
