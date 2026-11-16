import { inject } from '@angular/core';
import { patchState, signalStoreFeature, type, withProps } from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';
import type {
   CanvasElementModel,
   LifelineModel,
   SchemaModel,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
} from '@devdesigner/shared';
import { ColumnsApiService } from '../../../../../shared/services/columns-api.service';
import { ProjectsApiService } from '../../../../../shared/services/projects-api.service';
import { RelationshipsApiService } from '../../../../../shared/services/relationships-api.service';
import { TablesApiService } from '../../../../../shared/services/tables-api.service';
import { ShareSessionService } from '../../../../../core/auth/share-session.service';
import { IndexesApiService } from '../../../services/indexes-api.service';
import { ElementsApiService } from '../../../services/elements-api.service';
import { SequenceApiService } from '../../../services/sequence-api.service';
import { ShareLinksApiService } from '../../../services/share-links-api.service';
import { mapDiagram, mapElement, mapLifeline, mapMessage, mapTable } from '../helpers/schema-mutation.helper';
import type { ProjectState } from '../models/project-state.model';

/** The granular HTTP services every write goes through. */
export interface ProjectApis {
   projectsApi: ProjectsApiService;
   tablesApi: TablesApiService;
   columnsApi: ColumnsApiService;
   indexesApi: IndexesApiService;
   relationshipsApi: RelationshipsApiService;
   elementsApi: ElementsApiService;
   sequenceApi: SequenceApiService;
   shareLinksApi: ShareLinksApiService;
   shareSession: ShareSessionService;
   snackBar: MatSnackBar;
}

/** Local schema writes (no persistence): replace the schema, or one row by id. No-ops before a load. */
export interface SchemaWriter {
   setSchema(updater: (schema: SchemaModel) => SchemaModel): void;
   mapTable(tableId: string, fn: (table: TableModel) => TableModel): void;
   mapElement(elementId: string, fn: (element: CanvasElementModel) => CanvasElementModel): void;
   mapLifeline(id: string, fn: (l: LifelineModel) => LifelineModel): void;
   mapMessage(id: string, fn: (m: SequenceMessageModel) => SequenceMessageModel): void;
   mapDiagram(id: string, fn: (d: SequenceDiagramModel) => SequenceDiagramModel): void;
}

/** Injected services (`_api`) and the local schema writer (`_schema`) the method features share. */
export function withProjectProps() {
   return signalStoreFeature(
      { state: type<ProjectState>() },
      withProps((store) => {
         const setSchema = (updater: (schema: SchemaModel) => SchemaModel): void => {
            const current = store.schema();
            if (current) {
               patchState(store, { schema: updater(current) });
            }
         };
         const _schema: SchemaWriter = {
            setSchema,
            mapTable: (id, fn) => setSchema((s) => mapTable(s, id, fn)),
            mapElement: (id, fn) => setSchema((s) => mapElement(s, id, fn)),
            mapLifeline: (id, fn) => setSchema((s) => mapLifeline(s, id, fn)),
            mapMessage: (id, fn) => setSchema((s) => mapMessage(s, id, fn)),
            mapDiagram: (id, fn) => setSchema((s) => mapDiagram(s, id, fn)),
         };
         const _api: ProjectApis = {
            projectsApi: inject(ProjectsApiService),
            tablesApi: inject(TablesApiService),
            columnsApi: inject(ColumnsApiService),
            indexesApi: inject(IndexesApiService),
            relationshipsApi: inject(RelationshipsApiService),
            elementsApi: inject(ElementsApiService),
            sequenceApi: inject(SequenceApiService),
            shareLinksApi: inject(ShareLinksApiService),
            shareSession: inject(ShareSessionService),
            snackBar: inject(MatSnackBar),
         };
         return { _api, _schema };
      })
   );
}
