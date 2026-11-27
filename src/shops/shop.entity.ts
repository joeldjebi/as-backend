import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { fold } from '../common/text';

export enum ShopStatus {
  DRAFT = 'DRAFT', // en cours de remplissage dans l'app
  PENDING = 'PENDING', // envoyée, à vérifier par l'équipe
  APPROVED = 'APPROVED', // en ligne
  REJECTED = 'REJECTED', // refusée (motif) : le vendeur corrige et renvoie
  SUSPENDED = 'SUSPENDED', // suspendue par l'équipe
}

export type ShopType = 'BOUTIQUE' | 'GROSSISTE';

export interface ShopEvent {
  at: string;
  action: 'CREATED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REACTIVATED';
  by?: string;
  note?: string;
}

/** Horaires : jours ouvrés (1 = lundi … 7 = dimanche), heures HH:MM */
export interface ShopHours {
  open: string;
  close: string;
  days: number[];
}

/** Boutique ou grossiste d'Adjamé */
@Entity('shops')
export class Shop {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') ownerId: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 90 }) slug: string;
  @Column({ type: 'varchar', length: 10, default: 'BOUTIQUE' }) type: ShopType;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) phone: string | null;
  // Emplacement à Adjamé
  @Column({ type: 'varchar', length: 60, nullable: true }) market: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) location: string | null; // allée, n° de magasin, repère
  @Column({ type: 'double precision', nullable: true }) lat: number | null;
  @Column({ type: 'double precision', nullable: true }) lng: number | null;
  @Column({ type: 'uuid', array: true, default: () => "'{}'" }) categoryIds: string[];
  // Photos
  @Column({ type: 'text', nullable: true }) logoUrl: string | null;
  @Column({ type: 'text', nullable: true }) storefrontUrl: string | null;
  // Gérant : pièce d'identité (privée), registre de commerce facultatif
  @Column({ type: 'varchar', length: 12, nullable: true }) ownerIdType: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) ownerIdNumber: string | null;
  @Column({ type: 'text', nullable: true }) ownerIdFrontUrl: string | null;
  @Column({ type: 'text', nullable: true }) ownerIdBackUrl: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) tradeRegister: string | null;
  @Column({ type: 'jsonb', nullable: true }) hours: ShopHours | null;
  /** Mise en avant sur l'accueil de l'app (choisie par l'équipe) */
  @Column({ default: false }) featured: boolean;
  /** Interrupteur ouvert / fermé (vacances) */
  @Column({ default: true }) isOpen: boolean;
  /** Part de la marchandise payée à la commande (10 à 100 %), le reste à la livraison ; valeur par défaut des produits */
  @Column({ type: 'int', default: 100 }) prepayPercent: number;
  /** Encaissement de la marchandise : DIRECT (alias PI-SPI de la boutique) ou PLATFORM (Adjamé-Smart reverse) */
  @Column({ type: 'varchar', length: 10, default: 'PLATFORM' }) payoutMode: 'DIRECT' | 'PLATFORM';
  /** Alias PI-SPI de la boutique (numéro Mobile Money ou alias) si DIRECT */
  @Column({ type: 'varchar', length: 60, nullable: true }) pispiAlias: string | null;
  @Index() @Column({ type: 'varchar', length: 10, default: ShopStatus.DRAFT }) status: ShopStatus;
  @Column({ type: 'text', nullable: true }) reviewNote: string | null;
  @Column({ type: 'text', nullable: true }) reviewedBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) submittedAt: Date | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) history: ShopEvent[];
  /** Nom, marché, emplacement et description sans accents (recherche) */
  @Column({ type: 'text', default: '' }) searchText: string;

  @BeforeInsert()
  @BeforeUpdate()
  computeSearchText() {
    this.searchText = fold([this.name, this.market, this.location, this.description].filter(Boolean).join(' '));
  }
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
