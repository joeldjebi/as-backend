import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Repository } from 'typeorm';
import { Public, Roles, Staff } from '../common/decorators';
import { Role, StaffRole } from '../users/user.entity';
import { Category } from './category.entity';

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'categorie';

/** Catégories du lancement (modifiables dans le back-office) */
const SEED: [string, string, string[]][] = [
  ['Téléphonie et accessoires', 'deviceMobile', ['Téléphones', 'Coques et protections', 'Chargeurs et câbles', 'Écouteurs']],
  ['Électronique', 'television', ['Ordinateurs', 'TV et audio', 'Petits appareils']],
  ['Mode femme', 'dress', ['Robes', 'Pagnes et tissus', 'Sacs', 'Bijoux']],
  ['Mode homme', 'tShirt', ['Chemises', 'Pantalons', 'Tenues traditionnelles']],
  ['Chaussures', 'sneaker', ['Femme', 'Homme', 'Enfant']],
  ['Beauté et cosmétiques', 'sparkle', ['Soins du corps', 'Maquillage', 'Mèches et perruques', 'Parfums']],
  ['Maison et cuisine', 'cookingPot', ['Ustensiles', 'Décoration', 'Linge de maison']],
  ['Alimentation', 'basket', ['Épicerie', 'Boissons', 'Produits frais']],
  ['Bébé et enfants', 'baby', ['Vêtements', 'Puériculture', 'Jouets']],
  ['Pièces auto et moto', 'wrench', ['Pièces auto', 'Pièces moto', 'Pneus et batteries']],
  ['Quincaillerie', 'hammer', ['Outillage', 'Électricité', 'Plomberie']],
  ['Papeterie et fournitures', 'notebook', ['Fournitures scolaires', 'Bureau']],
];

class CategoryDto {
  @IsOptional() @IsString() @IsNotEmpty({ message: 'Nom obligatoire' }) @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(@InjectRepository(Category) private repo: Repository<Category>) {}

  async onModuleInit() {
    if (await this.repo.count()) return;
    let i = 0;
    for (const [name, icon, children] of SEED) {
      const parent = await this.repo.save({ name, icon, slug: slugify(name), sortOrder: (i += 10) });
      let j = 0;
      for (const c of children) await this.repo.save({ name: c, parentId: parent.id, slug: slugify(`${name}-${c}`), sortOrder: (j += 10) });
    }
  }

  /** Arbre (actives seulement pour l'app) */
  async tree(all = false) {
    const rows = await this.repo.find({ where: all ? {} : { active: true }, order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.filter((c) => !c.parentId).map((c) => ({ ...c, children: rows.filter((x) => x.parentId === c.id) }));
  }

  private async uniqueSlug(base: string, except?: string) {
    let slug = slugify(base);
    for (let n = 2; ; n++) {
      const found = await this.repo.findOneBy({ slug });
      if (!found || found.id === except) return slug;
      slug = `${slugify(base)}-${n}`;
    }
  }

  async create(dto: CategoryDto) {
    if (!dto.name) throw new BadRequestException('Nom obligatoire');
    if (dto.parentId) {
      const parent = await this.repo.findOneBy({ id: dto.parentId });
      if (!parent || parent.parentId) throw new BadRequestException('Sous-catégorie : choisissez une catégorie principale');
    }
    await this.repo.save({ name: dto.name.trim(), parentId: dto.parentId ?? null, icon: dto.icon ?? null, sortOrder: dto.sortOrder ?? 100, slug: await this.uniqueSlug(dto.name) });
    return this.tree(true);
  }

  async update(id: string, dto: CategoryDto) {
    const c = await this.repo.findOneBy({ id });
    if (!c) throw new NotFoundException('Catégorie introuvable');
    if (dto.name) { c.name = dto.name.trim(); c.slug = await this.uniqueSlug(dto.name, id); }
    if (dto.icon !== undefined) c.icon = dto.icon || null;
    if (dto.sortOrder !== undefined) c.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) c.active = dto.active;
    await this.repo.save(c);
    return this.tree(true);
  }

  async remove(id: string) {
    if (await this.repo.existsBy({ parentId: id })) throw new ConflictException('Supprimez ou déplacez d’abord ses sous-catégories');
    const [{ n }] = await this.repo.query(`SELECT count(*)::int AS n FROM shops WHERE $1 = ANY("categoryIds")`, [id]);
    if (n > 0) throw new ConflictException('Des boutiques utilisent cette catégorie : désactivez-la plutôt');
    await this.repo.delete(id);
    return this.tree(true);
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private service: CategoriesService) {}

  @Public()
  @Get()
  tree() {
    return this.service.tree();
  }

  @Get('all')
  @Roles(Role.ADMIN)
  all() {
    return this.service.tree(true);
  }

  @Post()
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  create(@Body() dto: CategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
