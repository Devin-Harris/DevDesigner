import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ColumnsService } from '../../../core/services/columns.service';
import { RelationshipsService } from '../../../core/services/relationships.service';
import { TablesService } from '../../../core/services/tables.service';
import { ProjectsStore } from '../../../stores/projects.store';
import type { ProjectTemplate } from './project-templates';

/**
 * Instantiates a client-side starter template into a real project using the
 * existing granular APIs: create the project (via ProjectsStore so it lands in the
 * list optimistically), then its tables, columns, and finally the relationships
 * (which need the created column ids). Selects the new project when done.
 */
@Injectable({ providedIn: 'root' })
export class TemplatesService {
   private readonly store = inject(ProjectsStore);
   private readonly tablesApi = inject(TablesService);
   private readonly columnsApi = inject(ColumnsService);
   private readonly relationshipsApi = inject(RelationshipsService);

   async createFromTemplate(template: ProjectTemplate): Promise<string> {
      const project = await this.store.create({ name: template.name, type: template.type });

      // Map "tableKey.columnName" -> created column id, for wiring relationships.
      const columnIds = new Map<string, string>();

      for (const t of template.tables) {
         const table = await firstValueFrom(
            this.tablesApi.create(project.id, { name: t.name, x: t.x, y: t.y, color: t.color })
         );
         for (const c of t.columns) {
            const column = await firstValueFrom(
               this.columnsApi.create(table.id, {
                  name: c.name,
                  dataType: { name: c.type, length: c.length },
                  isPrimaryKey: c.pk ?? false,
                  isNullable: !c.notNull,
                  isUnique: c.unique ?? false,
                  isAutoIncrement: c.auto ?? false,
               })
            );
            columnIds.set(`${t.key}.${c.name}`, column.id);
         }
      }

      for (const r of template.relationships) {
         const sourceColumnId = columnIds.get(r.from);
         const targetColumnId = columnIds.get(r.to);
         if (sourceColumnId && targetColumnId) {
            await firstValueFrom(
               this.relationshipsApi.create(project.id, {
                  sourceColumnId,
                  targetColumnId,
                  type: r.type,
               })
            );
         }
      }

      this.store.select(project.id);
      return project.id;
   }
}
