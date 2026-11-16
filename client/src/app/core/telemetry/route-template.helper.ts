import type { ActivatedRouteSnapshot } from '@angular/router';
import { CLIENT_ROUTE_TEMPLATES } from '@devdesigner/shared';

export type ClientRouteTemplate = (typeof CLIENT_ROUTE_TEMPLATES)[number];

/**
 * The matched route's TEMPLATE (`/projects/:projectId`), built from the router config
 * paths along the active branch, never from the URL, so ids and share tokens never leave.
 */
export function routeTemplateOf(root: ActivatedRouteSnapshot): string {
   const parts: string[] = [];
   for (let node: ActivatedRouteSnapshot | null = root; node; node = node.firstChild) {
      const path = node.routeConfig?.path;
      if (path) parts.push(path);
   }
   return `/${parts.join('/')}`;
}

/** Collapse a template onto the catalog's allow-list (admin sub-pages count as `/admin`). */
export function clientRouteOf(template: string): ClientRouteTemplate {
   if (template === '/admin' || template.startsWith('/admin/')) return '/admin';
   return (CLIENT_ROUTE_TEMPLATES as readonly string[]).includes(template)
      ? (template as ClientRouteTemplate)
      : 'other';
}
