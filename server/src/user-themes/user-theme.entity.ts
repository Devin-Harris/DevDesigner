import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A presentation theme saved to a personal library ("My themes"), usable in any of
 * the owner's projects. Owned by the account, or by `guest:<id>` for a guest browser.
 */
@Entity('user_themes')
export class UserThemeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_user_themes_owner')
  @Column({ type: 'varchar' })
  ownerId!: string;

  /** The theme (SlideTheme) as JSON, layout designs included. */
  @Column({ type: 'text' })
  themeJson!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
