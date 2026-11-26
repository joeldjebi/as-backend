import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Variante d'un produit (taille, couleur…) : son prix (sinon celui du produit) et son stock */
export interface ProductVariant {
  id: string;
  label: string;
  price: number | null;
  stock: number | null;
}

export enum ProductStatus {
  ACTIVE = 'ACTIVE', // visible (si la boutique est en ligne)
  INACTIVE = 'INACTIVE', // masqué par le vendeur
  REMOVED = 'REMOVED', // retiré par l'équipe (modération)
}

export interface ProductReport {
  at: string;
  by: string; // id du client
  reason: string;
}

/** Produit d'une boutique */
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') shopId: string;
  @Index() @Column('uuid') categoryId: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  /** Photos (/uploads/…), la première est la principale */
  @Column({ type: 'text', array: true, default: () => "'{}'" }) photos: string[];
  /** Prix au détail (FCFA) */
  @Column('int') price: number;
  /** Grossistes : prix de gros et quantité minimale (visibles par les revendeurs validés) */
  @Column({ type: 'int', nullable: true }) wholesalePrice: number | null;
  @Column({ type: 'int', nullable: true }) wholesaleMinQty: number | null;
  /** Stock (null = non suivi) ; avec des variantes, le stock est celui des variantes */
  @Column({ type: 'int', nullable: true }) stock: number | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) variants: ProductVariant[];
  @Index() @Column({ type: 'varchar', length: 10, default: ProductStatus.ACTIVE }) status: ProductStatus;
  @Column({ type: 'text', nullable: true }) moderationNote: string | null;
  @Column({ type: 'text', nullable: true }) moderatedBy: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) reports: ProductReport[];
  @Column({ type: 'int', default: 0 }) views: number;
  /** Texte de recherche (nom, description, boutique, catégorie) sans accents, en minuscules */
  @Column({ type: 'text', default: '' }) searchText: string;
  @Index() @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
