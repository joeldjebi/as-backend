import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { Category } from '../categories/category.entity';
import { Shop, ShopStatus } from '../shops/shop.entity';
import { ResellerStatus, User } from '../users/user.entity';
import { Product, ProductStatus } from './product.entity';

import { fold } from '../common/text';
import { MARKETS } from '../shops/markets';

export { fold };

export interface ProductInput {
  shopId?: string; categoryId?: string; name?: string; description?: string; photos?: string[];
  price?: number; wholesalePrice?: number | null; wholesaleMinQty?: number | null; stock?: number | null; prepayPercent?: number | null;
  variants?: { id?: string; label: string; price?: number | null; stock?: number | null }[]; active?: boolean;
}

export interface SearchQuery {
  q?: string; categoryId?: string; shopId?: string; wholesale?: boolean; minPrice?: number; maxPrice?: number;
  sort?: 'new' | 'price_asc' | 'price_desc' | 'popular'; page?: number;
  market?: string; type?: 'BOUTIQUE' | 'GROSSISTE'; inStock?: boolean; limit?: number;
}

const PAGE = 24;
const HOME_TTL = 60_000;

@Injectable()
export class ProductsService implements OnModuleInit {
  private logger = new Logger(ProductsService.name);
  private homeCache = new Map<string, { at: number; data: unknown }>();

  constructor(
    @InjectRepository(Product) private repo: Repository<Product>,
    @InjectRepository(Shop) private shops: Repository<Shop>,
    @InjectRepository(Category) private categories: Repository<Category>,
  ) {}

  /** Index de recherche rapide (trigrammes), utile dès quelques milliers de produits ; texte de recherche des boutiques */
  async onModuleInit() {
    try {
      await this.repo.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await this.repo.query('CREATE INDEX IF NOT EXISTS products_search_trgm ON products USING gin ("searchText" gin_trgm_ops)');
      await this.repo.query('CREATE INDEX IF NOT EXISTS shops_search_trgm ON shops USING gin ("searchText" gin_trgm_ops)');
    } catch (e) {
      this.logger.warn(`Index de recherche non créé (extension pg_trgm indisponible) : ${(e as Error).message}`);
    }
    const missing = await this.shops.find({ where: { searchText: '' } });
    for (const s of missing) {
      s.computeSearchText();
      await this.shops.update(s.id, { searchText: s.searchText });
    }
  }

  // ---------- Vues ----------

  /** Stock total (variantes comprises) ; null = non suivi */
  private totalStock(p: Product) {
    if (p.variants.length) return p.variants.some((v) => v.stock == null) ? null : p.variants.reduce((t, v) => t + (v.stock ?? 0), 0);
    return p.stock;
  }

  /** Vue client : prix de gros seulement pour les revendeurs validés */
  publicView(p: Product, shop: Shop | undefined, viewer?: User) {
    const reseller = viewer?.resellerStatus === ResellerStatus.APPROVED;
    const stock = this.totalStock(p);
    return {
      id: p.id, shopId: p.shopId, categoryId: p.categoryId, name: p.name, description: p.description, photos: p.photos,
      price: p.price, variants: p.variants, stock, inStock: stock == null || stock > 0,
      hasWholesale: p.wholesalePrice != null,
      // Part à payer à la commande (Mobile Money), le reste à la livraison
      prepayPercent: p.prepayPercent ?? shop?.prepayPercent ?? 100,
      wholesalePrice: reseller ? p.wholesalePrice : null,
      wholesaleMinQty: reseller ? p.wholesaleMinQty : null,
      shop: shop && { id: shop.id, name: shop.name, slug: shop.slug, type: shop.type, market: shop.market, logoUrl: shop.logoUrl, isOpen: shop.isOpen },
      createdAt: p.createdAt,
    };
  }

  /** Vue vendeur (tout) */
  ownerView(p: Product) {
    const { searchText: _s, reports, ...rest } = p;
    void _s;
    return { ...rest, reports: reports.length, totalStock: this.totalStock(p) };
  }

  // ---------- Vendeur ----------

  private async ownShop(ownerId: string, shopId: string) {
    const s = await this.shops.findOneBy({ id: shopId });
    if (!s || s.ownerId !== ownerId) throw new NotFoundException('Boutique introuvable');
    if (s.status === ShopStatus.SUSPENDED) throw new ForbiddenException('Boutique suspendue : contactez Adjamé-Smart');
    return s;
  }

  private async own(ownerId: string, id: string) {
    const p = await this.repo.findOneBy({ id });
    if (!p) throw new NotFoundException('Produit introuvable');
    const shop = await this.ownShop(ownerId, p.shopId);
    return { p, shop };
  }

  async listMine(ownerId: string, shopId: string) {
    await this.ownShop(ownerId, shopId);
    return (await this.repo.find({ where: { shopId }, order: { createdAt: 'DESC' } })).map((p) => this.ownerView(p));
  }

  private async searchTextOf(p: Product, shop: Shop) {
    const cat = await this.categories.findOneBy({ id: p.categoryId });
    const parent = cat?.parentId ? await this.categories.findOneBy({ id: cat.parentId }) : null;
    return fold([p.name, p.description, shop.name, cat?.name, parent?.name, p.variants.map((v) => v.label).join(' ')].filter(Boolean).join(' '));
  }

  private async apply(p: Product, dto: ProductInput, shop: Shop) {
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('Nom du produit obligatoire');
      p.name = dto.name.trim();
    }
    if (dto.description !== undefined) p.description = dto.description.trim() || null;
    if (dto.categoryId !== undefined) {
      const c = await this.categories.findOneBy({ id: dto.categoryId, active: true });
      if (!c) throw new BadRequestException('Catégorie inconnue');
      p.categoryId = c.id;
    }
    if (dto.photos !== undefined) {
      if (!dto.photos.length) throw new BadRequestException('Ajoutez au moins une photo');
      p.photos = dto.photos.slice(0, 6);
    }
    if (dto.price !== undefined) p.price = dto.price;
    if (dto.wholesalePrice !== undefined) p.wholesalePrice = dto.wholesalePrice;
    if (dto.wholesaleMinQty !== undefined) p.wholesaleMinQty = dto.wholesaleMinQty;
    if (p.wholesalePrice != null) {
      if (shop.type !== 'GROSSISTE') throw new BadRequestException('Prix de gros réservé aux grossistes');
      if (p.wholesalePrice >= p.price) throw new BadRequestException('Le prix de gros doit être inférieur au prix au détail');
      if (!p.wholesaleMinQty || p.wholesaleMinQty < 2) throw new BadRequestException('Quantité minimale pour le prix de gros : 2 ou plus');
    } else {
      p.wholesaleMinQty = null;
    }
    if (dto.stock !== undefined) p.stock = dto.stock;
    if (dto.prepayPercent !== undefined) p.prepayPercent = dto.prepayPercent;
    if (dto.variants !== undefined) {
      const labels = new Set<string>();
      p.variants = dto.variants.slice(0, 30).map((v) => {
        const label = v.label.trim();
        if (!label) throw new BadRequestException('Nom de variante obligatoire (ex. Taille M)');
        if (labels.has(fold(label))) throw new BadRequestException(`Variante en double : ${label}`);
        labels.add(fold(label));
        return { id: v.id ?? randomUUID(), label, price: v.price ?? null, stock: v.stock ?? null };
      });
    }
    if (dto.active !== undefined && p.status !== ProductStatus.REMOVED) p.status = dto.active ? ProductStatus.ACTIVE : ProductStatus.INACTIVE;
    p.searchText = await this.searchTextOf(p, shop);
  }

  async create(ownerId: string, dto: ProductInput) {
    if (!dto.shopId) throw new BadRequestException('Boutique obligatoire');
    const shop = await this.ownShop(ownerId, dto.shopId);
    if (!dto.name?.trim() || !dto.categoryId || dto.price == null || !dto.photos?.length) {
      throw new BadRequestException('Photo, nom, catégorie et prix obligatoires');
    }
    if ((await this.repo.countBy({ shopId: shop.id })) >= 2000) throw new BadRequestException('2 000 produits maximum par boutique');
    const p = this.repo.create({ shopId: shop.id, variants: [], photos: [], reports: [] });
    await this.apply(p, dto, shop);
    return this.ownerView(await this.repo.save(p));
  }

  async update(ownerId: string, id: string, dto: ProductInput) {
    const { p, shop } = await this.own(ownerId, id);
    if (p.status === ProductStatus.REMOVED && dto.active) throw new BadRequestException(`Produit retiré par Adjamé-Smart : ${p.moderationNote ?? 'contactez-nous'}`);
    await this.apply(p, dto, shop);
    return this.ownerView(await this.repo.save(p));
  }

  async duplicate(ownerId: string, id: string) {
    const { p } = await this.own(ownerId, id);
    const copy = this.repo.create({
      ...p, id: undefined, name: `${p.name} (copie)`.slice(0, 120), status: ProductStatus.INACTIVE, reports: [], views: 0,
      moderationNote: null, moderatedBy: null, variants: p.variants.map((v) => ({ ...v, id: randomUUID() })), createdAt: undefined, updatedAt: undefined,
    });
    return this.ownerView(await this.repo.save(copy));
  }

  async remove(ownerId: string, id: string) {
    const { p } = await this.own(ownerId, id);
    await this.repo.delete(p.id);
    return { ok: true };
  }

  // ---------- Public ----------

  /** Ids d'une catégorie et de ses sous-catégories */
  private async categoryFamily(id: string) {
    const kids = await this.categories.findBy({ parentId: id });
    return [id, ...kids.map((k) => k.id)];
  }

  private visible() {
    return this.repo
      .createQueryBuilder('p')
      .innerJoin(Shop, 's', 's.id = p."shopId"')
      .where('p.status = :act', { act: ProductStatus.ACTIVE })
      .andWhere('s.status = :ok', { ok: ShopStatus.APPROVED });
  }

  async search(q: SearchQuery, viewer?: User) {
    const qb = this.visible();
    if (q.q?.trim()) {
      // Chaque mot doit apparaître (nom, description, boutique, catégorie, variantes), sans tenir compte des accents
      fold(q.q).split(/\s+/).filter((w) => w.length > 1).slice(0, 6).forEach((word, i) => {
        qb.andWhere(`p."searchText" LIKE :w${i}`, { [`w${i}`]: `%${word}%` });
      });
    }
    if (q.categoryId) qb.andWhere('p."categoryId" IN (:...cats)', { cats: await this.categoryFamily(q.categoryId) });
    if (q.shopId) qb.andWhere('p."shopId" = :shop', { shop: q.shopId });
    if (q.wholesale) qb.andWhere('p."wholesalePrice" IS NOT NULL');
    if (q.market) qb.andWhere('s.market = :market', { market: q.market });
    if (q.type) qb.andWhere('s.type = :stype', { stype: q.type });
    if (q.inStock) qb.andWhere('(jsonb_array_length(p.variants) > 0 OR p.stock IS NULL OR p.stock > 0)');
    if (q.minPrice != null) qb.andWhere('p.price >= :min', { min: q.minPrice });
    if (q.maxPrice != null) qb.andWhere('p.price <= :max', { max: q.maxPrice });
    const order: Record<string, [string, 'ASC' | 'DESC']> = { new: ['p.createdAt', 'DESC'], price_asc: ['p.price', 'ASC'], price_desc: ['p.price', 'DESC'], popular: ['p.views', 'DESC'] };
    const [col, dir] = order[q.sort ?? 'new'] ?? order.new;
    const page = Math.max(1, q.page ?? 1);
    const size = Math.min(48, Math.max(1, q.limit ?? PAGE));
    const [rows, total] = await qb.orderBy(col, dir).addOrderBy('p.id', 'ASC').skip((page - 1) * size).take(size).getManyAndCount();
    const shops = await this.shops.findBy({ id: In([...new Set(rows.map((r) => r.shopId))].concat('00000000-0000-0000-0000-000000000000')) });
    return { total, page, pages: Math.ceil(total / size), items: rows.map((p) => this.publicView(p, shops.find((s) => s.id === p.shopId), viewer)) };
  }

  async one(id: string, viewer?: User) {
    const p = await this.visible().andWhere('p.id = :id', { id }).getOne();
    if (!p) throw new NotFoundException('Produit introuvable ou plus disponible');
    await this.repo.increment({ id }, 'views', 1);
    const shop = await this.shops.findOneBy({ id: p.shopId });
    return this.publicView(p, shop ?? undefined, viewer);
  }

  /** Accueil de l'app : rayons, marchés, boutiques, collections (mis en cache une minute) */
  async home(viewer?: User) {
    const key = viewer?.resellerStatus === ResellerStatus.APPROVED ? 'reseller' : 'public';
    const hit = this.homeCache.get(key);
    if (hit && Date.now() - hit.at < HOME_TTL) return hit.data;
    const L = 10;
    const [fresh, popular, cheap, wholesale] = await Promise.all([
      this.search({ sort: 'new', limit: L }, viewer),
      this.search({ sort: 'popular', limit: L }, viewer),
      this.search({ sort: 'popular', maxPrice: 5000, limit: L }, viewer),
      this.search({ sort: 'popular', wholesale: true, limit: L }, viewer),
    ]);
    const [featured, recent] = await Promise.all([
      this.shops.find({ where: { status: ShopStatus.APPROVED, featured: true }, order: { name: 'ASC' }, take: 12 }),
      this.shops.find({ where: { status: ShopStatus.APPROVED }, order: { reviewedAt: 'DESC' }, take: 10 }),
    ]);
    const counts = await this.productCounts([...featured, ...recent].map((s) => s.id));
    const marketRows: { market: string; n: number }[] = await this.shops.query(
      `SELECT market, count(*)::int AS n FROM shops WHERE status = 'APPROVED' AND market IS NOT NULL GROUP BY market`,
    );
    const catRows: { id: string; n: number }[] = await this.repo.query(
      `SELECT COALESCE(c."parentId", c.id) AS id, count(*)::int AS n FROM products p
         JOIN shops s ON s.id = p."shopId" JOIN categories c ON c.id = p."categoryId"
        WHERE p.status = 'ACTIVE' AND s.status = 'APPROVED' GROUP BY 1`,
    );
    const rank = (m: string) => (MARKETS.indexOf(m) < 0 ? 99 : MARKETS.indexOf(m));
    const data = {
      newProducts: fresh.items,
      popularProducts: popular.items,
      cheapProducts: cheap.items,
      wholesaleProducts: wholesale.items,
      featuredShops: featured.map((s) => this.shopCard(s, counts[s.id])),
      newShops: recent.map((s) => this.shopCard(s, counts[s.id])),
      markets: marketRows.sort((a, b) => rank(a.market) - rank(b.market)).map((m) => ({ name: m.market, shops: m.n })),
      categoryCounts: Object.fromEntries(catRows.map((r) => [r.id, r.n])),
      totals: { products: fresh.total, shops: marketRows.reduce((t, m) => t + m.n, 0) },
    };
    this.homeCache.set(key, { at: Date.now(), data });
    return data;
  }

  /** Carte de boutique (listes) */
  shopCard(s: Shop, productCount?: number) {
    return { id: s.id, name: s.name, slug: s.slug, type: s.type, market: s.market, logoUrl: s.logoUrl, storefrontUrl: s.storefrontUrl, isOpen: s.isOpen, productCount: productCount ?? 0 };
  }

  /** Nombre de produits visibles par boutique */
  async productCounts(shopIds: string[]): Promise<Record<string, number>> {
    if (!shopIds.length) return {};
    const rows: { id: string; n: number }[] = await this.repo.query(
      `SELECT "shopId" AS id, count(*)::int AS n FROM products WHERE status = 'ACTIVE' AND "shopId" = ANY($1::uuid[]) GROUP BY 1`,
      [[...new Set(shopIds)]],
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.n]));
  }

  /** Suggestions pendant la frappe : rayons, boutiques, produits */
  async suggest(q: string) {
    const words = fold(q).split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
    if (!words.length) return { categories: [], shops: [], products: [] };
    const like = (col: string) => words.map((_, i) => `${col} LIKE $${i + 1}`).join(' AND ');
    const params = words.map((w) => `%${w}%`);
    const [cats, shops, products] = await Promise.all([
      this.categories.find({ where: { active: true } }),
      this.shops.query(
        `SELECT id, slug, name, market, "logoUrl" FROM shops WHERE status = 'APPROVED' AND ${like('"searchText"')} ORDER BY featured DESC, name LIMIT 4`,
        params,
      ),
      this.repo.query(
        `SELECT p.id, p.name, p.price, p.photos[1] AS photo FROM products p JOIN shops s ON s.id = p."shopId"
          WHERE p.status = 'ACTIVE' AND s.status = 'APPROVED' AND ${like('p."searchText"')} ORDER BY p.views DESC, p."createdAt" DESC LIMIT 6`,
        params,
      ),
    ]);
    const parent = (c: Category) => cats.find((x) => x.id === c.parentId);
    const categories = cats
      .filter((c) => words.every((w) => fold(c.name).includes(w)))
      .slice(0, 4)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? parent(c)?.icon ?? null, parentName: parent(c)?.name ?? null }));
    return { categories, shops, products };
  }

  async report(id: string, userId: string, reason: string) {
    const p = await this.repo.findOneBy({ id });
    if (!p || p.status === ProductStatus.REMOVED) throw new NotFoundException('Produit introuvable');
    if (p.reports.some((r) => r.by === userId)) throw new BadRequestException('Vous avez déjà signalé ce produit');
    p.reports = [...p.reports, { at: new Date().toISOString(), by: userId, reason: reason.trim() }];
    await this.repo.save(p);
    return { ok: true };
  }

  // ---------- Équipe ----------

  async adminList(filter: 'reported' | 'removed' | 'all', q?: string) {
    const where = filter === 'reported' ? `jsonb_array_length(p.reports) > 0 AND p.status <> 'REMOVED'` : filter === 'removed' ? `p.status = 'REMOVED'` : 'true';
    const rows: (Product & { shopName: string })[] = await this.repo.query(
      `SELECT p.*, s.name AS "shopName" FROM products p JOIN shops s ON s.id = p."shopId"
        WHERE ${where} AND ($1::text IS NULL OR p."searchText" LIKE '%' || $1 || '%')
        ORDER BY jsonb_array_length(p.reports) DESC, p."createdAt" DESC LIMIT 300`,
      [q?.trim() ? fold(q.trim()) : null],
    );
    const [counts] = await this.repo.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE jsonb_array_length(reports) > 0 AND status <> 'REMOVED')::int AS reported,
              count(*) FILTER (WHERE status = 'REMOVED')::int AS removed FROM products`,
    );
    return { counts, items: rows.map((p) => ({ ...this.ownerView(p), reportsList: p.reports, shopName: p.shopName })) };
  }

  async moderate(id: string, remove: boolean, by: string, note?: string) {
    const p = await this.repo.findOneBy({ id });
    if (!p) throw new NotFoundException('Produit introuvable');
    if (remove && !note?.trim()) throw new BadRequestException('Motif obligatoire');
    p.status = remove ? ProductStatus.REMOVED : ProductStatus.INACTIVE;
    p.moderationNote = remove ? note!.trim() : null;
    p.moderatedBy = by;
    if (!remove) p.reports = [];
    await this.repo.save(p);
    return { ok: true };
  }
}
