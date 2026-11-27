import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { SettingsService } from '../settings/settings.service';

/** Course VITE (format de l'API partenaire v1) */
export interface LetoDelivery {
  id: string;
  reference: string | null;
  status: string;
  price: number;
  trackingUrl: string;
  driver: { name: string; phone?: string | null; vehicleType?: string; plate?: string | null } | null;
  stops: { id: string; status: string; confirmationCode: string; codAmount: number; feeDue?: number }[];
}

export interface LetoCreate {
  reference: string;
  vehicleType?: string;
  speed?: 'EXPRESS' | 'STANDARD' | 'SCHEDULED';
  pickup: { lat: number; lng: number; address: string; phone: string; contactName?: string; details?: string };
  stops: { lat: number; lng: number; address: string; recipientName: string; recipientPhone: string; codAmount?: number; packageDescription?: string; details?: string }[];
  comment?: string;
  feePaidBy?: 'SENDER' | 'RECIPIENT';
}

/** Erreur VITE lisible (message déjà en français côté VITE) */
export class LetoError extends Error {}

/** Engin : MOTO, CAR, CARGO ou un engin ajouté dans VITE (VELO, TRICYCLE…) */
export type VehicleType = string;
export type DeliverySpeed = 'EXPRESS' | 'STANDARD' | 'SCHEDULED';
/** Proposition d'un livreur sur une course en attente (2 min pour répondre) */
export interface LetoOffer {
  id: string;
  price: number;
  counterPrice: number | null;
  awaiting: 'CLIENT' | 'DRIVER';
  minCounter: number;
  expiresAt: string;
  driver: { name: string; avatarUrl?: string | null; vehicleType?: string | null };
  independent?: boolean;
  company?: { name: string } | null;
  etaMin: number | null;
}
export interface DeliveryOption { vehicleType: VehicleType; speed: DeliverySpeed; price: number }
/** Engin proposé par VITE (nom et pictogramme pour l'affichage) */
export interface VehicleInfo { code: string; name: string; icon: string; description: string }

/**
 * Client de l'API partenaire VITE : devis, création et suivi des courses, vérification des webhooks.
 * Configuration : LETO_API_URL (ex. https://api.vite.ci), LETO_API_KEY, LETO_WEBHOOK_SECRET.
 */
@Injectable()
export class LetoService {
  private logger = new Logger(LetoService.name);

  /** Adresse, clé et secret : réglages du back-office (Super Admin), sinon .env */
  constructor(private settings: SettingsService) {}

  get configured() {
    return !!(this.settings.get('LETO_API_URL') && this.settings.get('LETO_API_KEY'));
  }

  /** Suivi public d'une course (sans clé) : statut, livreur, position, itinéraire, temps restant */
  async track(token: string): Promise<unknown> {
    const base = this.settings.get('LETO_API_URL').replace(/\/$/, '');
    if (!base) throw new ServiceUnavailableException('Suivi indisponible pour le moment');
    let res: Response;
    try {
      res = await fetch(`${base}/track/${token}`, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ServiceUnavailableException('Suivi indisponible pour le moment');
    }
    if (!res.ok) throw new ServiceUnavailableException('Suivi indisponible pour le moment');
    return res.json();
  }

  // ----- Propositions de prix des livreurs -----
  offers(deliveryId: string) {
    return this.call<LetoOffer[]>('GET', `/deliveries/${deliveryId}/offers`);
  }
  acceptOffer(offerId: string) {
    return this.call<{ ok: boolean; price: number }>('POST', `/offers/${offerId}/accept`);
  }
  declineOffer(offerId: string) {
    return this.call<{ ok: boolean }>('POST', `/offers/${offerId}/decline`);
  }
  counterOffer(offerId: string, price: number) {
    return this.call<{ ok: boolean; counterPrice: number }>('POST', `/offers/${offerId}/counter`, { price });
  }

  /** Recherche d'adresse (quartiers et lieux d'Abidjan) */
  geoSearch(q: string, near?: { lat: number; lng: number }) {
    const qs = new URLSearchParams({ q, ...(near ? { lat: String(near.lat), lng: String(near.lng) } : {}) });
    return this.call<{ label: string; sublabel: string; lat: number; lng: number }[]>('GET', `/geo/search?${qs}`);
  }

  /** Adresse et commune d'un point */
  geoReverse(lat: number, lng: number) {
    return this.call<{ label: string; sublabel: string; commune: string }>('GET', `/geo/reverse?lat=${lat}&lng=${lng}`);
  }

  /** Vérification de la clé : partenaire, actif, adresse des notifications */
  me() {
    return this.call<{ id: string; name: string; active: boolean; webhookUrl: string | null }>('GET', '/me');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    if (!this.configured) throw new LetoError('Livraison VITE non configurée');
    let res: Response;
    try {
      res = await fetch(`${this.settings.get('LETO_API_URL').replace(/\/$/, '')}/partner/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.settings.get('LETO_API_KEY')}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      this.logger.error(`VITE injoignable : ${(e as Error).message}`);
      throw new LetoError('Service de livraison VITE injoignable pour le moment');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const m = (data as { message?: string | string[] } | null)?.message;
      const msg = Array.isArray(m) ? m.join(', ') : m;
      this.logger.warn(`VITE ${method} ${path} → ${res.status} ${msg ?? ''}`);
      throw new LetoError(res.status === 403 ? 'Accès à VITE désactivé pour le moment' : msg || 'Demande refusée par VITE');
    }
    return data as T;
  }

  /** Prix de chaque type de livraison proposé par VITE (engin × délai) ; null si indisponible */
  /** Derniers engins connus de VITE (noms et pictogrammes) */
  vehicles: VehicleInfo[] = [];

  async quoteOptions(pickup: { lat: number; lng: number }, stop: { lat: number; lng: number; codAmount?: number }): Promise<DeliveryOption[] | null> {
    if (!this.configured) return null;
    try {
      const q = await this.call<{ prices: DeliveryOption[]; vehicles?: VehicleInfo[] }>('POST', '/quotes', { pickup, stops: [stop] });
      if (q.vehicles?.length) this.vehicles = q.vehicles;
      return q.prices.length ? q.prices.map((p) => ({ vehicleType: p.vehicleType, speed: p.speed, price: p.price })) : null;
    } catch {
      return null;
    }
  }

  create(body: LetoCreate, idempotencyKey: string) {
    return this.call<LetoDelivery>('POST', '/deliveries', body, idempotencyKey);
  }

  get(id: string) {
    return this.call<LetoDelivery>('GET', `/deliveries/${id}`);
  }

  /** Signature « X-Leto-Signature: t=…,v1=… » : HMAC-SHA256(secret, "t.corps"), moins de 5 minutes */
  verify(header: string | undefined, raw: Buffer | undefined) {
    const secret = this.settings.get('LETO_WEBHOOK_SECRET');
    if (!secret || !header || !raw) return false;
    const parts = Object.fromEntries(header.split(',').map((x) => x.trim().split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !parts.v1) return false;
    const expected = createHmac('sha256', secret).update(`${parts.t}.${raw.toString('utf8')}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
