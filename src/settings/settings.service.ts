import { Column, Entity, PrimaryColumn, Repository, UpdateDateColumn } from 'typeorm';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

/** Réglage modifiable depuis le back-office (remplace la valeur du .env tant qu'il est renseigné) */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 60 }) key: string;
  @Column({ type: 'text' }) value: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) updatedBy: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

/** Réglages gérés depuis le back-office (Super Admin) : la base d'abord, sinon le .env */
export const MANAGED = ['LETO_API_URL', 'LETO_API_KEY', 'LETO_WEBHOOK_SECRET', 'AS_PISPI_ALIAS', 'AS_PISPI_NAME', 'DIRECT_PAYOUT_ALL'] as const;
export type SettingKey = (typeof MANAGED)[number];
export const SECRET_KEYS: SettingKey[] = ['LETO_API_KEY', 'LETO_WEBHOOK_SECRET'];

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, Setting>();

  constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

  async onModuleInit() {
    for (const s of await this.repo.find()) this.cache.set(s.key, s);
  }

  /** Valeur effective : base, sinon .env, sinon vide */
  get(key: SettingKey): string {
    return this.cache.get(key)?.value || process.env[key] || '';
  }

  source(key: SettingKey): 'backoffice' | 'env' | 'none' {
    if (this.cache.get(key)?.value) return 'backoffice';
    return process.env[key] ? 'env' : 'none';
  }

  /** Encaissement direct ouvert à toutes les boutiques (à activer avec la vérification automatique des paiements) */
  get directPayoutForAll() {
    return this.get('DIRECT_PAYOUT_ALL') === 'true';
  }

  meta(key: SettingKey) {
    const s = this.cache.get(key);
    return s ? { updatedAt: s.updatedAt, updatedBy: s.updatedBy } : null;
  }

  /** Enregistre (valeur vide = retour à la valeur du .env) */
  async set(values: Partial<Record<SettingKey, string>>, by: string) {
    for (const [key, raw] of Object.entries(values) as [SettingKey, string | undefined][]) {
      if (raw === undefined || !MANAGED.includes(key)) continue;
      const value = raw.trim();
      if (!value) {
        await this.repo.delete({ key });
        this.cache.delete(key);
      } else {
        const saved = await this.repo.save({ key, value, updatedBy: by });
        this.cache.set(key, saved as Setting);
      }
    }
  }
}
