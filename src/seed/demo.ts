/**
 * Boutiques de démonstration (une par rayon, 5 articles chacune) avec de vraies photos libres de droits (Pixabay ou Pexels).
 *
 *   Créer :     node dist/seed/demo.js
 *   Supprimer : node dist/seed/demo.js --remove
 *
 * Demande la clé Pixabay ou Pexels (jamais affichée ni enregistrée), le numéro du compte propriétaire et, si ce compte
 * n'existe pas, son nom et son mot de passe. Sans danger si relancé : une boutique déjà créée est ignorée.
 * Les boutiques sont marquées « DEMO-ADJAME-SMART » (champ registre de commerce) pour pouvoir les retirer.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as readline from 'readline';
import { In, Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { slugify } from '../categories/categories.controller';
import { Category } from '../categories/category.entity';
import { fold } from '../common/text';
import { normalizePhone } from '../countries/phone';
import { Product } from '../products/product.entity';
import { ProductsService } from '../products/products.service';
import { Shop, ShopStatus } from '../shops/shop.entity';
import { StorageService } from '../storage/storage.service';
import { Role, User } from '../users/user.entity';
import { DEMO_SHOPS } from './demo-data';

const MARK = 'DEMO-ADJAME-SMART';

// Un seul lecteur, avec une file d'attente : une réponse tapée (ou collée) d'avance n'est jamais perdue
let rl: readline.Interface | null = null;
let muted = false;
const lines: string[] = [];
let waiting: ((line: string) => void) | null = null;
function reader() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const w = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = w._writeToOutput.bind(rl);
    w._writeToOutput = (s: string) => { if (!muted) original(s); };
    rl.on('line', (line) => {
      if (waiting) { const f = waiting; waiting = null; f(line); } else lines.push(line);
    });
    rl.on('close', () => { if (waiting) { const f = waiting; waiting = null; f(''); } });
  }
  return rl;
}
function ask(question: string, hidden = false): Promise<string> {
  reader();
  process.stdout.write(question);
  muted = hidden;
  const done = (line: string) => {
    muted = false;
    if (hidden) process.stdout.write('\n');
    return line.trim();
  };
  if (lines.length) return Promise.resolve(done(lines.shift()!));
  return new Promise((resolve) => { waiting = (line) => resolve(done(line)); });
}

/** Source de photos libres de droits (usage commercial autorisé, sans mention obligatoire) */
abstract class PhotoSource {
  protected used = new Set<string>();
  constructor(protected key: string, private storage: StorageService) {}
  abstract readonly label: string;
  abstract check(): Promise<void>;
  /** Adresses des photos trouvées pour la recherche (identifiant, adresse) */
  protected abstract search(query: string, orientation: 'portrait' | 'landscape'): Promise<{ id: string; url: string }[]>;

  /** Télécharge `count` photos et les enregistre comme les photos envoyées par les vendeurs */
  async photos(query: string, count: number, orientation: 'portrait' | 'landscape' = 'portrait'): Promise<string[]> {
    const picks = (await this.search(query, orientation)).filter((p) => !this.used.has(p.id)).slice(0, count);
    const urls: string[] = [];
    for (const p of picks) {
      this.used.add(p.id);
      const img = await fetch(p.url, { signal: AbortSignal.timeout(30_000) });
      if (!img.ok) continue;
      const name = `${randomUUID()}.jpg`;
      await this.storage.save(name, Buffer.from(await img.arrayBuffer()), 'image/jpeg');
      urls.push(`/uploads/${name}`);
    }
    return urls;
  }
}

/** Pixabay : clé gratuite et immédiate sur pixabay.com/api/docs (format 12345678-abc…) */
class Pixabay extends PhotoSource {
  readonly label = 'Pixabay (pixabay.com)';
  private api(params: Record<string, string>) {
    return fetch(`https://pixabay.com/api/?${new URLSearchParams({ key: this.key, image_type: 'photo', safesearch: 'true', per_page: '20', ...params })}`);
  }
  async check() {
    const r = await this.api({ q: 'market' });
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error('Clé Pixabay refusée : vérifiez-la sur pixabay.com/api/docs');
    if (!r.ok) throw new Error(`Pixabay indisponible (HTTP ${r.status})`);
  }
  protected async search(query: string, orientation: 'portrait' | 'landscape') {
    // Pixabay limite à 100 recherches par minute : petite pause entre deux recherches
    await new Promise((r) => setTimeout(r, 700));
    const r = await this.api({ q: query.slice(0, 100), orientation: orientation === 'portrait' ? 'vertical' : 'horizontal' });
    if (!r.ok) throw new Error(`Recherche Pixabay « ${query} » : HTTP ${r.status}`);
    let hits = ((await r.json()) as { hits: { id: number; largeImageURL: string }[] }).hits;
    if (!hits.length) {
      const any = await this.api({ q: query.slice(0, 100) });
      hits = any.ok ? ((await any.json()) as { hits: { id: number; largeImageURL: string }[] }).hits : [];
    }
    return hits.map((h) => ({ id: `x${h.id}`, url: h.largeImageURL }));
  }
}

/** Pexels : clé gratuite sur pexels.com/api */
class Pexels extends PhotoSource {
  readonly label = 'Pexels (pexels.com)';
  async check() {
    const r = await fetch('https://api.pexels.com/v1/search?query=market&per_page=1', { headers: { Authorization: this.key } });
    if (r.status === 401 || r.status === 403) throw new Error('Clé Pexels refusée : vérifiez-la sur pexels.com/api');
    if (!r.ok) throw new Error(`Pexels indisponible (HTTP ${r.status})`);
  }
  protected async search(query: string, orientation: 'portrait' | 'landscape') {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=${orientation}`, { headers: { Authorization: this.key } });
    if (!r.ok) throw new Error(`Recherche Pexels « ${query} » : HTTP ${r.status}`);
    const data = (await r.json()) as { photos: { id: number; src: { large2x: string } }[] };
    return data.photos.map((p) => ({ id: `p${p.id}`, url: p.src.large2x }));
  }
}

async function main() {
  const remove = process.argv.includes('--remove');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const shops = app.get<Repository<Shop>>(getRepositoryToken(Shop));
  const products = app.get<Repository<Product>>(getRepositoryToken(Product));
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  const categories = app.get<Repository<Category>>(getRepositoryToken(Category));

  if (remove) {
    const demo = await shops.find({ where: { tradeRegister: MARK } });
    if (!demo.length) { console.log('Aucune boutique de démonstration.'); rl?.close(); return app.close(); }
    const ok = await ask(`Supprimer ${demo.length} boutique(s) de démonstration et leurs produits ? Tapez OUI : `);
    if (ok !== 'OUI') { console.log('Annulé.'); rl?.close(); return app.close(); }
    const ids = demo.map((s) => s.id);
    const n = await products.delete({ shopId: In(ids) });
    await shops.delete({ id: In(ids) });
    console.log(`✓ ${demo.length} boutique(s) et ${n.affected ?? 0} produit(s) supprimés.`);
    rl?.close();
    return app.close();
  }

  console.log('Boutiques de démonstration Adjamé-Smart\n');
  const key = await ask('Clé API Pixabay ou Pexels (ne s’affiche pas) : ', true);
  if (!key) throw new Error('Clé obligatoire (gratuite sur pixabay.com/api/docs)');
  // Les clés Pixabay ont la forme 12345678-0123456789abcdef…
  const pexels: PhotoSource = /^\d+-[0-9a-f]{20,}$/i.test(key) ? new Pixabay(key, app.get(StorageService)) : new Pexels(key, app.get(StorageService));
  await pexels.check();
  console.log(`✓ Clé acceptée : photos ${pexels.label}`);

  const phone = normalizePhone(await ask('Numéro du compte propriétaire des boutiques (ex. 0701020304) : '));
  if (!phone) throw new Error('Numéro invalide');
  let owner = await users.findOneBy({ phone });
  if (owner && owner.role !== Role.CUSTOMER) throw new Error('Ce numéro est un compte de l’équipe : choisissez un compte client');
  if (!owner) {
    console.log('Ce compte n’existe pas encore : il va être créé.');
    const name = await ask('  Nom du compte : ');
    let password = '';
    while (password.length < 6) {
      password = await ask('  Mot de passe (6 caractères minimum, ne s’affiche pas) : ', true);
      if (password.length < 6) console.log('  Trop court.');
    }
    owner = await users.save(users.create({ name: name || 'Adjamé-Smart Démo', phone, passwordHash: await bcrypt.hash(password, 10), role: Role.CUSTOMER }));
    console.log('✓ Compte créé');
  } else {
    console.log(`✓ Compte trouvé : ${owner.name}`);
  }

  const all = await categories.find({ where: { active: true } });
  const roots = all.filter((c) => !c.parentId);
  const productsService = app.get(ProductsService);
  let createdShops = 0;
  let createdProducts = 0;

  for (const def of DEMO_SHOPS) {
    const cat = roots.find((c) => c.icon === def.icon);
    if (!cat) { console.log(`- ${def.name} : rayon introuvable (${def.icon}), ignorée`); continue; }
    if (await shops.findOneBy({ name: def.name, tradeRegister: MARK })) { console.log(`- ${def.name} : déjà créée, ignorée`); continue; }
    process.stdout.write(`• ${def.name} (${cat.name}) … `);
    const front = await pexels.photos(def.storefront, 1, 'landscape');
    let slug = slugify(def.name);
    for (let n = 2; await shops.existsBy({ slug }); n++) slug = `${slugify(def.name)}-${n}`;
    const now = new Date();
    const shop = await shops.save(shops.create({
      ownerId: owner.id, name: def.name, slug, type: def.type, description: def.description, phone, market: def.market, location: def.location,
      lat: def.lat, lng: def.lng, categoryIds: [cat.id], storefrontUrl: front[0] ?? null, logoUrl: front[0] ?? null,
      hours: { open: '08:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] }, isOpen: true, status: ShopStatus.APPROVED,
      submittedAt: now, reviewedAt: now, reviewedBy: 'Démonstration', featured: !!def.featured, prepayPercent: def.prepay, payoutMode: 'PLATFORM',
      tradeRegister: MARK, history: [{ at: now.toISOString(), action: 'CREATED' }, { at: now.toISOString(), action: 'APPROVED', by: 'Démonstration' }],
    }));
    createdShops++;
    let ok = 0;
    for (const p of def.products) {
      try {
        const photos = await pexels.photos(p.photo, 2);
        if (!photos.length) throw new Error('aucune photo trouvée');
        const sub = p.sub ? all.find((c) => c.parentId === cat.id && fold(c.name) === fold(p.sub!)) : undefined;
        await productsService.create(owner.id, {
          shopId: shop.id, name: p.name, description: p.description, categoryId: (sub ?? cat).id, photos, price: p.price,
          stock: p.variants ? null : p.stock ?? null,
          variants: p.variants?.map((v) => ({ label: v.label, price: v.price ?? null, stock: v.stock ?? null })) ?? [],
          wholesalePrice: p.wholesale?.[0] ?? null, wholesaleMinQty: p.wholesale?.[1] ?? null,
          prepayPercent: p.prepay ?? null, active: true,
        });
        ok++;
        createdProducts++;
      } catch (e) {
        process.stdout.write(`\n    ⚠ ${p.name} : ${(e as Error).message}`);
      }
    }
    console.log(`${ok}/${def.products.length} articles`);
  }

  console.log(`\nTerminé : ${createdShops} boutique(s) et ${createdProducts} article(s) créés.`);
  console.log(`Photos : ${pexels.label}, libres d’usage commercial.`);
  console.log('Pour tout retirer plus tard : node dist/seed/demo.js --remove');
  rl?.close();
  await app.close();
}

main().catch((e) => {
  rl?.close();
  console.error(`\n✗ ${(e as Error).message}`);
  process.exit(1);
});
