import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** CUSTOMER : client (et vendeur s'il ouvre une boutique) ; ADMIN : équipe Adjamé-Smart */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
}

/** Rôles de l'équipe */
export enum StaffRole {
  SUPER_ADMIN = 'SUPER_ADMIN', // tout, y compris l'équipe et les réglages
  MODERATOR = 'MODERATOR', // boutiques, revendeurs, catalogue
  SUPPORT = 'SUPPORT', // lecture, commandes et litiges (phases suivantes)
}

/** Statut revendeur : prix de gros visibles une fois validé */
export enum ResellerStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface ResellerRequest {
  businessName: string;
  commune: string | null;
  idPhotoUrl: string | null;
  shopPhotoUrl: string | null;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  note?: string | null;
}

/** Adresse enregistrée du client */
export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  landmark: string | null;
  lat: number;
  lng: number;
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 20, unique: true }) phone: string;
  @Column({ select: false }) passwordHash: string;
  @Column({ type: 'varchar', length: 10, default: Role.CUSTOMER }) role: Role;
  @Column({ type: 'varchar', length: 12, nullable: true }) staffRole: StaffRole | null;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'text', nullable: true }) avatarUrl: string | null;
  @Column({ type: 'varchar', length: 10, default: ResellerStatus.NONE }) resellerStatus: ResellerStatus;
  @Column({ type: 'jsonb', nullable: true }) reseller: ResellerRequest | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) addresses: SavedAddress[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
