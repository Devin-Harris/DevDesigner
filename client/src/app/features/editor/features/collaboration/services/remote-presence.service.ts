import { computed, inject, Injectable } from '@angular/core';
import { RealtimeService } from '../../../../../core/realtime/realtime.service';
import { ProjectStore } from '../../../state/project/project.store';
import { tableHeight, tableWidth } from '../../../helpers/node-metrics.helper';
/** Other participants on the canvas: their cursors and the tables they have selected. */
@Injectable()
export class RemotePresenceService {
   private readonly store = inject(ProjectStore);
   private readonly realtime = inject(RealtimeService);

   /** Other participants' cursors projected to screen coordinates for rendering. */
   readonly remoteCursors$ = computed(() => {
      const v = this.store.viewport();
      return this.realtime.remoteCursors().map((c) => ({
         id: c.participantId,
         name: c.name,
         color: c.color,
         left: c.x * v.zoom + v.x,
         top: c.y * v.zoom + v.y,
      }));
   });

   /** Highlight rings (world coords) for tables another participant has selected. */
   readonly remoteTableHighlights$ = computed(() => {
      const highlights = this.realtime.tableHighlights();
      const rings: {
         id: string;
         x: number;
         y: number;
         width: number;
         height: number;
         color: string;
      }[] = [];
      for (const table of this.store.tables()) {
         const colors = highlights[table.id];
         if (colors?.length) {
            rings.push({
               id: table.id,
               x: table.x,
               y: table.y,
               width: tableWidth(table),
               height: tableHeight(table),
               color: colors[0],
            });
         }
      }
      return rings;
   });
}
