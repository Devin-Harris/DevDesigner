import type { ProjectType, RelationshipType } from '@devdesigner/shared';

/** A column within a template table. `ref` marks it as a foreign key that seeds a
 *  relationship to `"tableKey.columnName"`. */
export interface TemplateColumn {
   name: string;
   type: string;
   length?: number;
   pk?: boolean;
   notNull?: boolean;
   unique?: boolean;
   auto?: boolean;
}

export interface TemplateTable {
   key: string;
   name: string;
   color?: string;
   x: number;
   y: number;
   columns: TemplateColumn[];
}

export interface TemplateRelationship {
   from: string; // "tableKey.columnName" (FK side)
   to: string; // "tableKey.columnName" (PK side)
   type: RelationshipType;
}

export interface ProjectTemplate {
   id: string;
   name: string;
   type: ProjectType;
   description: string;
   /** Accent used for the gallery card thumbnail. */
   accent: string;
   tables: TemplateTable[];
   relationships: TemplateRelationship[];
}

const AMBER = '#e8a33d';
const TEAL = '#2bb8a9';
const BLUE = '#6f8bff';
const PURPLE = '#9b8bff';
const PINK = '#e06b9a';

/** Curated starter schemas. Picking one creates a project and populates it via the
 *  existing table/column/relationship APIs (see TemplatesService). */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
   {
      id: 'blog',
      name: 'Blog',
      type: 'ERD',
      description: 'Users, posts and comments — a classic content schema.',
      accent: BLUE,
      tables: [
         {
            key: 'users',
            name: 'users',
            color: BLUE,
            x: 80,
            y: 80,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'email', type: 'VARCHAR', length: 255, notNull: true, unique: true },
               { name: 'display_name', type: 'VARCHAR', length: 120 },
               { name: 'created_at', type: 'TIMESTAMP', notNull: true },
            ],
         },
         {
            key: 'posts',
            name: 'posts',
            color: TEAL,
            x: 460,
            y: 80,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'author_id', type: 'BIGINT', notNull: true },
               { name: 'title', type: 'VARCHAR', length: 200, notNull: true },
               { name: 'body', type: 'TEXT' },
               { name: 'published_at', type: 'TIMESTAMP' },
            ],
         },
         {
            key: 'comments',
            name: 'comments',
            color: AMBER,
            x: 460,
            y: 360,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'post_id', type: 'BIGINT', notNull: true },
               { name: 'author_id', type: 'BIGINT', notNull: true },
               { name: 'body', type: 'TEXT', notNull: true },
               { name: 'created_at', type: 'TIMESTAMP', notNull: true },
            ],
         },
      ],
      relationships: [
         { from: 'posts.author_id', to: 'users.id', type: 'ONE_TO_MANY' },
         { from: 'comments.post_id', to: 'posts.id', type: 'ONE_TO_MANY' },
         { from: 'comments.author_id', to: 'users.id', type: 'ONE_TO_MANY' },
      ],
   },
   {
      id: 'ecommerce',
      name: 'E-commerce',
      type: 'ERD',
      description: 'Customers, products, orders and line items.',
      accent: TEAL,
      tables: [
         {
            key: 'customers',
            name: 'customers',
            color: BLUE,
            x: 80,
            y: 80,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'email', type: 'VARCHAR', length: 255, notNull: true, unique: true },
               { name: 'name', type: 'VARCHAR', length: 160 },
            ],
         },
         {
            key: 'orders',
            name: 'orders',
            color: AMBER,
            x: 440,
            y: 80,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'customer_id', type: 'BIGINT', notNull: true },
               { name: 'status', type: 'VARCHAR', length: 32, notNull: true },
               { name: 'total', type: 'DECIMAL' },
               { name: 'placed_at', type: 'TIMESTAMP', notNull: true },
            ],
         },
         {
            key: 'products',
            name: 'products',
            color: TEAL,
            x: 80,
            y: 360,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'sku', type: 'VARCHAR', length: 64, notNull: true, unique: true },
               { name: 'name', type: 'VARCHAR', length: 200, notNull: true },
               { name: 'price', type: 'DECIMAL', notNull: true },
            ],
         },
         {
            key: 'order_items',
            name: 'order_items',
            color: PURPLE,
            x: 440,
            y: 360,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'order_id', type: 'BIGINT', notNull: true },
               { name: 'product_id', type: 'BIGINT', notNull: true },
               { name: 'quantity', type: 'INT', notNull: true },
               { name: 'unit_price', type: 'DECIMAL', notNull: true },
            ],
         },
      ],
      relationships: [
         { from: 'orders.customer_id', to: 'customers.id', type: 'ONE_TO_MANY' },
         { from: 'order_items.order_id', to: 'orders.id', type: 'ONE_TO_MANY' },
         { from: 'order_items.product_id', to: 'products.id', type: 'ONE_TO_MANY' },
      ],
   },
   {
      id: 'saas',
      name: 'SaaS / Teams',
      type: 'ERD',
      description: 'Organizations, memberships and users for a multi-tenant app.',
      accent: PURPLE,
      tables: [
         {
            key: 'organizations',
            name: 'organizations',
            color: PURPLE,
            x: 80,
            y: 100,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'name', type: 'VARCHAR', length: 160, notNull: true },
               { name: 'plan', type: 'VARCHAR', length: 32, notNull: true },
            ],
         },
         {
            key: 'memberships',
            name: 'memberships',
            color: PINK,
            x: 460,
            y: 100,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'org_id', type: 'BIGINT', notNull: true },
               { name: 'user_id', type: 'BIGINT', notNull: true },
               { name: 'role', type: 'VARCHAR', length: 32, notNull: true },
            ],
         },
         {
            key: 'users',
            name: 'users',
            color: BLUE,
            x: 460,
            y: 360,
            columns: [
               { name: 'id', type: 'BIGINT', pk: true, notNull: true, auto: true },
               { name: 'email', type: 'VARCHAR', length: 255, notNull: true, unique: true },
               { name: 'name', type: 'VARCHAR', length: 120 },
            ],
         },
      ],
      relationships: [
         { from: 'memberships.org_id', to: 'organizations.id', type: 'ONE_TO_MANY' },
         { from: 'memberships.user_id', to: 'users.id', type: 'ONE_TO_MANY' },
      ],
   },
];
