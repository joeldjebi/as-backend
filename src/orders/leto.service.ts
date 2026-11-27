import { Injectable, Logger } from '@nestjs/common';
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
  vehicleType?: 'MOTO' | 'CAR' | 'CARGO';
  speed?: 'EXPRESS' | 'STANDARD' | 'SCHEDULED';
  pickup: { lat: number; lng: number; address: string; phone: string; contactName?: string; details?: string };
  stops: { lat: number; lng: number; address: string; recipientName: string; recipientPhone: string; codAmount?: number; packageDescription?: string; details?: string }[];
  comment?: string;
  feePaidBy?: 'SENDER' | 'RECIPIENT';
}

/** Erreur VITE lisible (message déjà en français côté VITE) */
export class LetoError extends Error {}

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

  /** Prix d'une course moto standard (null si indisponible) */
  async quote(pickup: { lat: number; lng: number }, stop: { lat: number; lng: number; codAmount?: number }): Promise<number | null> {
    if (!this.configured) return null;
    try {
      const q = await this.call<{ prices: { vehicleType: string; speed: string; price: number }[] }>('POST', '/quotes', { pickup, stops: [stop] });
      return q.prices.find((p) => p.vehicleType === 'MOTO' && p.speed === 'STANDARD')?.price ?? q.prices[0]?.price ?? null;
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
