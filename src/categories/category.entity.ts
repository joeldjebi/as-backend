import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Catégorie du catalogue (arbre : parentId null = catégorie principale) */
@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid', nullable: true }) parentId: string | null;
  @Column({ type: 'varchar', length: 60 }) name: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 80 }) slug: string;
  /** Nom d'icône (Phosphor) affichée dans l'app */
  @Column({ type: 'varchar', length: 40, nullable: true }) icon: string | null;
  @Column({ type: 'int', default: 100 }) sortOrder: number;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
