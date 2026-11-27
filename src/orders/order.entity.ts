import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cycle d'une commande (une par boutique) :
 * AWAITING_PAYMENT → (le client déclare son paiement) PAYMENT_DECLARED → (le bénéficiaire confirme) PAID
 * → (course LETO créée) IN_DELIVERY → DELIVERED. Sinon CANCELLED ou FAILED (livraison impossible).
 */
export enum OrderStatus {
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PAYMENT_DECLARED = 'PAYMENT_DECLARED',
  PAID = 'PAID',
  IN_DELIVERY = 'IN_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export interface OrderItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  photo: string | null;
  price: number;
  qty: number;
  prepayPercent: number;
  subtotal: number;
  dueNow: number;
}

export interface OrderAddress {
  label: string;
  address: string;
  landmark: string | null;
  lat: number;
  lng: number;
}

/** Paiement de la marchandise (Mobile Money PI-SPI, confirmé à la main pour l'instant) */
export interface OrderPayment {
  /** DIRECT : à la boutique ; PLATFORM : à Adjamé-Smart qui reverse ensuite */
  mode: 'DIRECT' | 'PLATFORM';
  alias: string | null;
  payee: string;
  reference?: string | null;
  payerPhone?: string | null;
  declaredAt?: string | null;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  rejectedNote?: string | null;
}

/** Course LETO liée (mise à jour par webhook ou à la consultation) */
export interface OrderDelivery {
  deliveryId?: string | null;
  status?: string | null;
  stopStatus?: string | null;
  trackingUrl?: string | null;
  price?: number | null;
  confirmationCode?: string | null;
  driver?: { name: string; phone?: string | null; vehicleType?: string; plate?: string | null } | null;
  error?: string | null;
  requestedAt?: string | null;
  updatedAt?: string | null;
  events?: string[];
  attempts?: number;
}

export interface OrderEvent {
  at: string;
  status: OrderStatus | string;
  by?: string;
  note?: string;
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** Numéro lisible (AS-1001…) */
  @Index({ unique: true }) @Generated('increment') @Column() seq: number;
  /** Commandes passées ensemble (un panier = une commande par boutique) */
  @Index() @Column('uuid') checkoutId: string;
  @Index() @Column('uuid') customerId: string;
  @Index() @Column('uuid') shopId: string;
  @Column({ type: 'varchar', length: 80 }) shopName: string;
  @Column({ type: 'jsonb' }) items: OrderItem[];
  @Column('int') goodsTotal: number;
  /** Payé à la commande (Mobile Money) */
  @Column('int') dueNow: number;
  /** Encaissé par le livreur LETO à la remise */
  @Column('int') dueOnDelivery: number;
  /** Estimation des frais de livraison (payés en espèces au livreur) */
  @Column({ type: 'int', nullable: true }) deliveryFeeEstimate: number | null;
  @Column({ type: 'jsonb' }) address: OrderAddress;
  @Column({ type: 'varchar', length: 100 }) recipientName: string;
  @Column({ type: 'varchar', length: 20 }) recipientPhone: string;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Index() @Column({ type: 'varchar', length: 20, default: OrderStatus.AWAITING_PAYMENT }) status: OrderStatus;
  @Column({ type: 'jsonb' }) payment: OrderPayment;
  @Column({ type: 'jsonb', default: () => "'{}'" }) delivery: OrderDelivery;
  @Column({ type: 'text', nullable: true }) cancelReason: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) history: OrderEvent[];
  @Index() @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  get number() {
    return `AS-${1000 + this.seq}`;
  }
}
