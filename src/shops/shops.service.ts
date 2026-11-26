import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { slugify } from '../categories/categories.controller';
import { Category } from '../categories/category.entity';
import { identityLink } from '../uploads/uploads.controller';
import { User } from '../users/user.entity';
import { Shop, ShopEvent, ShopStatus } from './shop.entity';

/** Zones et marchés d'Adjamé proposés à l'inscription (le vendeur peut aussi écrire le sien) */
export const MARKETS = [
  'Forum des marchés', 'Marché Gouro', 'Black Market (Roxy)', 'Marché de Bracodi', 'Marché Liberté',
  'Adjamé Mosquée', 'Gare routière (Adjamé Nord)', 'Williamsville', '220 Logements', 'Autre emplacement',
];

/** Rectangle autour de la commune d'Adjamé (avec une petite marge) */
const ADJAME = { latMin: 5.335, latMax: 5.392, lngMin: -4.048, lngMax: -4.0 };
export const inAdjame = (lat: number, lng: number) => lat >= ADJAME.latMin && lat <= ADJAME.latMax && lng >= ADJAME.lngMin && lng <= ADJAME.lngMax;

export interface ShopInput {
  name?: string; type?: 'BOUTIQUE' | 'GROSSISTE'; description?: string; phone?: string;
  market?: string; location?: string; lat?: number; lng?: number; categoryIds?: string[];
  logoUrl?: string; storefrontUrl?: string;
  ownerIdType?: string; ownerIdNumber?: string; ownerIdFrontUrl?: string; ownerIdBackUrl?: string; tradeRegister?: string;
  hours?: { open: string; close: string; days: number[] } | null; isOpen?: boolean;
}

/** Éléments obligatoires pour envoyer le dossier */
const REQUIRED: [keyof Shop, string][] = [
  ['name', 'nom de la boutique'], ['phone', 'téléphone de la boutique'], ['market', 'marché ou zone'], ['location', 'allée, n° ou repère'],
  ['lat', 'position sur la carte'], ['storefrontUrl', 'photo de la devanture'], ['ownerIdType', 'type de pièce'], ['ownerIdNumber', 'numéro de la pièce'],
  ['ownerIdFrontUrl', 'pièce d’identité (recto)'], ['ownerIdBackUrl', 'pièce d’identité (verso)'],
];

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(Shop) private repo: Repository<Shop>,
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  private async uniqueSlug(base: string, except?: string) {
    let slug = slugify(base);
    for (let n = 2; ; n++) {
      const found = await this.repo.findOneBy({ slug });
      if (!found || found.id === except) return slug;
      slug = `${slugify(base)}-${n}`;
    }
  }

  /** Vue complète (vendeur ou équipe) : liens signés des pièces, éléments manquants */
  view(s: Shop) {
    return {
      ...s,
      ownerIdFrontLink: identityLink(s.ownerIdFrontUrl),
      ownerIdBackLink: identityLink(s.ownerIdBackUrl),
      required: REQUIRED.map(([k, label]) => ({ key: k, label, ok: s[k] != null && s[k] !== '' })),
    };
  }

  /** Vue publique (clients) : sans pièces ni historique */
  publicView(s: Shop) {
    const { ownerIdType: _a, ownerIdNumber: _b, ownerIdFrontUrl: _c, ownerIdBackUrl: _d, tradeRegister: _e, history: _f, reviewNote: _g, reviewedBy: _h, ...rest } = s;
    void _a; void _b; void _c; void _d; void _e; void _f; void _g; void _h;
    return rest;
  }

  private async mine(ownerId: string, id: string) {
    const s = await this.repo.findOneBy({ id });
    if (!s) throw new NotFoundException('Boutique introuvable');
    if (s.ownerId !== ownerId) throw new ForbiddenException();
    return s;
  }

  async listMine(ownerId: string) {
    return (await this.repo.find({ where: { ownerId }, order: { createdAt: 'ASC' } })).map((s) => this.view(s));
  }

  async create(ownerId: string, dto: ShopInput) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom de la boutique obligatoire');
    if ((await this.repo.countBy({ ownerId })) >= 5) throw new BadRequestException('5 boutiques maximum par compte');
    const s = this.repo.create({ ownerId, name: dto.name.trim(), slug: await this.uniqueSlug(dto.name), history: [{ at: new Date().toISOString(), action: 'CREATED' }] });
    this.apply(s, dto);
    await this.checkCategories(s.categoryIds);
    return this.view(await this.repo.save(s));
  }

  private apply(s: Shop, dto: ShopInput) {
    const str = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
    if (dto.lat !== undefined || dto.lng !== undefined) {
      if (dto.lat == null || dto.lng == null) throw new BadRequestException('Position incomplète');
      if (!inAdjame(dto.lat, dto.lng)) throw new BadRequestException('La boutique doit se trouver à Adjamé : placez le repère sur votre magasin');
      s.lat = dto.lat;
      s.lng = dto.lng;
    }
    for (const k of ['description', 'phone', 'market', 'location', 'logoUrl', 'storefrontUrl', 'ownerIdType', 'ownerIdNumber', 'ownerIdFrontUrl', 'ownerIdBackUrl', 'tradeRegister'] as const) {
      const v = str(dto[k]);
      if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = v;
    }
    if (dto.type) s.type = dto.type;
    if (dto.categoryIds) s.categoryIds = [...new Set(dto.categoryIds)].slice(0, 5);
    if (dto.hours !== undefined) s.hours = dto.hours;
    if (dto.isOpen !== undefined) s.isOpen = dto.isOpen;
  }

  private async checkCategories(ids: string[]) {
    if (!ids?.length) return;
    const found = await this.categories.countBy({ id: In(ids), active: true });
    if (found !== ids.length) throw new BadRequestException('Catégorie inconnue');
  }

  async update(ownerId: string, id: string, dto: ShopInput) {
    const s = await this.mine(ownerId, id);
    // Pièces et emplacement : modifiables seulement avant validation (sinon via l'équipe)
    const locked = s.status === ShopStatus.APPROVED || s.status === ShopStatus.SUSPENDED || s.status === ShopStatus.PENDING;
    if (locked && (dto.ownerIdFrontUrl || dto.ownerIdBackUrl || dto.ownerIdNumber || dto.lat !== undefined || dto.market || dto.location)) {
      throw new BadRequestException(s.status === ShopStatus.PENDING ? 'Dossier en cours de vérification : modification impossible' : 'Emplacement et pièces validés : contactez Adjamé-Smart pour les modifier');
    }
    if (dto.name && dto.name.trim() !== s.name) {
      if (s.status === ShopStatus.APPROVED) throw new BadRequestException('Boutique validée : contactez Adjamé-Smart pour changer son nom');
      s.name = dto.name.trim();
      s.slug = await this.uniqueSlug(dto.name, id);
    }
    this.apply(s, dto);
    await this.checkCategories(s.categoryIds);
    return this.view(await this.repo.save(s));
  }

  async submit(ownerId: string, id: string) {
    const s = await this.mine(ownerId, id);
    if (s.status === ShopStatus.PENDING) return this.view(s);
    if (s.status !== ShopStatus.DRAFT && s.status !== ShopStatus.REJECTED) throw new BadRequestException('Dossier déjà traité');
    const missing = REQUIRED.filter(([k]) => s[k] == null || s[k] === '').map(([, l]) => l);
    if (!s.categoryIds.length) missing.push('au moins une catégorie');
    if (missing.length) throw new BadRequestException(`Dossier incomplet : ${missing.join(', ')}`);
    s.status = ShopStatus.PENDING;
    s.submittedAt = new Date();
    s.reviewNote = null;
    s.history = [...s.history, { at: s.submittedAt.toISOString(), action: 'SUBMITTED' }];
    return this.view(await this.repo.save(s));
  }

  // ---------- Équipe ----------

  async list(status?: ShopStatus) {
    const rows = await this.repo.query(
      `SELECT s.id, s.name, s.type, s.market, s.location, s.status, s."submittedAt", s."createdAt", s."reviewNote", s."storefrontUrl", s.phone,
              u.name AS "ownerName", u.phone AS "ownerPhone"
         FROM shops s JOIN users u ON u.id = s."ownerId"
        WHERE ($1::text IS NULL OR s.status = $1)
        ORDER BY coalesce(s."submittedAt", s."createdAt") DESC LIMIT 1000`,
      [status ?? null],
    );
    const [counts] = await this.repo.query(
      `SELECT ${Object.values(ShopStatus).map((st) => `count(*) FILTER (WHERE status = '${st}')::int AS "${st}"`).join(', ')} FROM shops`,
    );
    return { items: rows, counts };
  }

  async one(id: string) {
    const s = await this.repo.findOneBy({ id });
    if (!s) throw new NotFoundException('Boutique introuvable');
    const owner = await this.users.findOneBy({ id: s.ownerId });
    const cats = s.categoryIds.length ? await this.categories.findBy({ id: In(s.categoryIds) }) : [];
    return { ...this.view(s), owner: owner && { id: owner.id, name: owner.name, phone: owner.phone, createdAt: owner.createdAt }, categories: cats.map((c) => ({ id: c.id, name: c.name })) };
  }

  private async review(id: string, by: string, to: ShopStatus, action: ShopEvent['action'], allowed: ShopStatus[], note?: string) {
    const s = await this.repo.findOneBy({ id });
    if (!s) throw new NotFoundException('Boutique introuvable');
    if (!allowed.includes(s.status)) throw new BadRequestException('Action impossible pour cette boutique');
    s.status = to;
    s.reviewedAt = new Date();
    s.reviewedBy = by;
    s.reviewNote = note?.trim() || null;
    s.history = [...s.history, { at: s.reviewedAt.toISOString(), action, by, note: note?.trim() || undefined }];
    await this.repo.save(s);
    return this.one(id);
  }

  approve(id: string, by: string) {
    return this.review(id, by, ShopStatus.APPROVED, 'APPROVED', [ShopStatus.PENDING, ShopStatus.REJECTED]);
  }
  reject(id: string, by: string, note: string) {
    return this.review(id, by, ShopStatus.REJECTED, 'REJECTED', [ShopStatus.PENDING], note);
  }
  suspend(id: string, by: string, note: string) {
    return this.review(id, by, ShopStatus.SUSPENDED, 'SUSPENDED', [ShopStatus.APPROVED], note);
  }
  reactivate(id: string, by: string) {
    return this.review(id, by, ShopStatus.APPROVED, 'REACTIVATED', [ShopStatus.SUSPENDED]);
  }

  // ---------- Public ----------

  async publicList(categoryId?: string) {
    const qb = this.repo.createQueryBuilder('s').where('s.status = :st', { st: ShopStatus.APPROVED }).orderBy('s.name', 'ASC').limit(200);
    if (categoryId) qb.andWhere(':c = ANY(s."categoryIds")', { c: categoryId });
    return (await qb.getMany()).map((s) => this.publicView(s));
  }

  async publicOne(slugOrId: string) {
    const s = await this.repo.createQueryBuilder('s').where('(s.slug = :v OR s.id::text = :v) AND s.status = :st', { v: slugOrId, st: ShopStatus.APPROVED }).getOne();
    if (!s) throw new NotFoundException('Boutique introuvable');
    return this.publicView(s);
  }
}
