import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { Category } from '../categories/category.entity';
import { Shop, ShopStatus } from '../shops/shop.entity';
import { ResellerStatus, User } from '../users/user.entity';
import { Product, ProductStatus } from './product.entity';

/** Texte sans accents, en minuscules (recherche) */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface ProductInput {
  shopId?: string; categoryId?: string; name?: string; description?: string; photos?: string[];
  price?: number; wholesalePrice?: number | null; wholesaleMinQty?: number | null; stock?: number | null;
  variants?: { id?: string; label: string; price?: number | null; stock?: number | null }[]; active?: boolean;
}

export interface SearchQuery {
  q?: string; categoryId?: string; shopId?: string; wholesale?: boolean; minPrice?: number; maxPrice?: number;
  sort?: 'new' | 'price_asc' | 'price_desc' | 'popular'; page?: number;
}

const PAGE = 24;

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private repo: Repository<Product>,
    @InjectRepository(Shop) private shops: Repository<Shop>,
    @InjectRepository(Category) private categories: Repository<Category>,
  ) {}

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
    if (q.minPrice != null) qb.andWhere('p.price >= :min', { min: q.minPrice });
    if (q.maxPrice != null) qb.andWhere('p.price <= :max', { max: q.maxPrice });
    const order: Record<string, [string, 'ASC' | 'DESC']> = { new: ['p.createdAt', 'DESC'], price_asc: ['p.price', 'ASC'], price_desc: ['p.price', 'DESC'], popular: ['p.views', 'DESC'] };
    const [col, dir] = order[q.sort ?? 'new'] ?? order.new;
    const page = Math.max(1, q.page ?? 1);
    const [rows, total] = await qb.orderBy(col, dir).addOrderBy('p.id', 'ASC').skip((page - 1) * PAGE).take(PAGE).getManyAndCount();
    const shops = await this.shops.findBy({ id: In([...new Set(rows.map((r) => r.shopId))].concat('00000000-0000-0000-0000-000000000000')) });
    return { total, page, pages: Math.ceil(total / PAGE), items: rows.map((p) => this.publicView(p, shops.find((s) => s.id === p.shopId), viewer)) };
  }

  async one(id: string, viewer?: User) {
    const p = await this.visible().andWhere('p.id = :id', { id }).getOne();
    if (!p) throw new NotFoundException('Produit introuvable ou plus disponible');
    await this.repo.increment({ id }, 'views', 1);
    const shop = await this.shops.findOneBy({ id: p.shopId });
    return this.publicView(p, shop ?? undefined, viewer);
  }

  /** Accueil de l'app : nouveautés, boutiques mises en avant, populaires */
  async home(viewer?: User) {
    const [fresh, popular] = await Promise.all([this.search({ sort: 'new' }, viewer), this.search({ sort: 'popular' }, viewer)]);
    const featured = await this.shops.find({ where: { status: ShopStatus.APPROVED, featured: true }, order: { name: 'ASC' }, take: 12 });
    return {
      newProducts: fresh.items.slice(0, 12),
      popularProducts: popular.items.slice(0, 12),
      featuredShops: featured.map((s) => ({ id: s.id, name: s.name, slug: s.slug, type: s.type, market: s.market, logoUrl: s.logoUrl, storefrontUrl: s.storefrontUrl })),
    };
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
