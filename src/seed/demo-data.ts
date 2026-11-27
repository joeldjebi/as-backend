/**
 * Catalogue de démonstration : une boutique par rayon (clé = icône du rayon), 5 articles chacune.
 * `q` / `photo` = recherche Pexels (anglais) pour une vraie photo libre de droits.
 * `sub` = nom du sous-rayon (sinon le rayon principal).
 */
export interface DemoProduct {
  name: string; sub?: string; price: number; description: string; photo: string; stock?: number;
  variants?: { label: string; price?: number; stock?: number }[]; wholesale?: [price: number, minQty: number]; prepay?: number;
}
export interface DemoShop {
  icon: string; name: string; type: 'BOUTIQUE' | 'GROSSISTE'; market: string; location: string; lat: number; lng: number;
  description: string; storefront: string; prepay: number; featured?: boolean; products: DemoProduct[];
}

const sizes = (list: string[], stock = 6) => list.map((label) => ({ label, stock }));

export const DEMO_SHOPS: DemoShop[] = [
  {
    icon: 'deviceMobile', name: 'Konaté Mobile', type: 'GROSSISTE', market: 'Black Market (Roxy)', location: 'Rangée 4, magasin 12', lat: 5.3569, lng: -4.0254,
    description: 'Smartphones neufs et reconditionnés, accessoires et réparations. Vente au détail et en gros pour les revendeurs.', storefront: 'phone shop', prepay: 50, featured: true,
    products: [
      { name: 'Smartphone 6,5" 128 Go double SIM', sub: 'Téléphones', price: 89000, description: 'Écran 6,5 pouces, 128 Go, 4 Go de RAM, double SIM, batterie 5000 mAh. Garantie 6 mois.', photo: 'smartphone black', stock: 14, wholesale: [82000, 5] },
      { name: 'Écouteurs sans fil Bluetooth', sub: 'Écouteurs', price: 8500, description: 'Écouteurs Bluetooth 5.3 avec boîtier de charge, jusqu’à 24 h d’autonomie.', photo: 'wireless earbuds', stock: 40, variants: [{ label: 'Blanc', stock: 20 }, { label: 'Noir', stock: 20 }], wholesale: [6500, 10] },
      { name: 'Chargeur rapide 25 W avec câble USB-C', sub: 'Chargeurs et câbles', price: 5000, description: 'Charge rapide 25 W, câble USB-C 1 m inclus. Compatible avec la plupart des smartphones.', photo: 'phone charger cable', stock: 60, wholesale: [3500, 20] },
      { name: 'Coque de protection antichoc', sub: 'Coques et protections', price: 2500, description: 'Coque souple antichoc, bords renforcés. Précisez votre modèle de téléphone en commentaire.', photo: 'phone case', stock: 80, variants: [{ label: 'Transparente' }, { label: 'Noire' }, { label: 'Bleue' }], wholesale: [1500, 20] },
      { name: 'Batterie externe 20 000 mAh', sub: 'Chargeurs et câbles', price: 14000, description: 'Powerbank 20 000 mAh, 2 ports USB et 1 USB-C, recharge rapide.', photo: 'power bank', stock: 25, wholesale: [11500, 10] },
    ],
  },
  {
    icon: 'television', name: 'Électro Adjamé', type: 'BOUTIQUE', market: 'Forum des marchés', location: 'Allée D, magasin 31', lat: 5.3553, lng: -4.0227,
    description: 'Téléviseurs, sono, ordinateurs et petit électroménager. Installation sur demande.', storefront: 'electronics store', prepay: 30, featured: true,
    products: [
      { name: 'Téléviseur LED 43" Smart TV', sub: 'TV et audio', price: 165000, description: 'Smart TV 43 pouces Full HD, Wi-Fi, YouTube et Netflix intégrés, 2 HDMI.', photo: 'television living room', stock: 6, prepay: 30 },
      { name: 'Ordinateur portable 15,6" 8 Go / 256 Go', sub: 'Ordinateurs', price: 245000, description: 'Processeur récent, 8 Go de RAM, SSD 256 Go, écran 15,6 pouces. Idéal bureautique et études.', photo: 'laptop desk', stock: 5, prepay: 30 },
      { name: 'Enceinte Bluetooth portable', sub: 'TV et audio', price: 18000, description: 'Son puissant, étanche, 12 h d’autonomie, fonction mains libres.', photo: 'bluetooth speaker', stock: 20 },
      { name: 'Mixeur blender 1,5 L', sub: 'Petits appareils', price: 15000, description: 'Blender 500 W, bol en verre 1,5 L, 3 vitesses. Pour jus, sauces et purées.', photo: 'blender kitchen', stock: 15 },
      { name: 'Fer à repasser vapeur', sub: 'Petits appareils', price: 9500, description: 'Fer vapeur 2000 W, semelle antiadhésive, réservoir 300 ml.', photo: 'clothes iron', stock: 18 },
    ],
  },
  {
    icon: 'dress', name: 'Awa Pagnes & Couture', type: 'BOUTIQUE', market: 'Marché Gouro', location: 'Allée des tissus, stand 7', lat: 5.3601, lng: -4.0198,
    description: 'Pagnes wax, robes cousues sur place, sacs et bijoux. Retouches gratuites.', storefront: 'african fabric market', prepay: 30, featured: true,
    products: [
      { name: 'Pagne wax 6 yards', sub: 'Pagnes et tissus', price: 9500, description: 'Wax 100 % coton, 6 yards (environ 5,5 m). Motifs variés, couleurs qui tiennent au lavage.', photo: 'african wax print fabric', stock: 30 },
      { name: 'Robe en wax cintrée', sub: 'Robes', price: 15000, description: 'Robe mi-longue cintrée en wax, fermeture au dos. Cousue dans notre atelier.', photo: 'african print dress', variants: sizes(['S', 'M', 'L', 'XL'], 5) },
      { name: 'Ensemble pagne et foulard assorti', sub: 'Pagnes et tissus', price: 12500, description: 'Pagne 3 yards avec foulard de tête assorti. Idéal pour les cérémonies.', photo: 'african headwrap', stock: 20 },
      { name: 'Sac à main en wax', sub: 'Sacs', price: 11000, description: 'Sac à main doublé, anses en simili cuir, poche intérieure zippée.', photo: 'handbag woman', stock: 12 },
      { name: 'Parure de perles colorées', sub: 'Bijoux', price: 6000, description: 'Collier et boucles d’oreilles en perles, fait main.', photo: 'beaded necklace', stock: 25 },
    ],
  },
  {
    icon: 'tShirt', name: 'Bazin Élégance Homme', type: 'BOUTIQUE', market: 'Adjamé Mosquée', location: 'Rue du marché, boutique 18', lat: 5.3628, lng: -4.0235,
    description: 'Chemises, pantalons, boubous et tenues traditionnelles pour hommes.', storefront: 'men clothing store', prepay: 50,
    products: [
      { name: 'Chemise manches longues coton', sub: 'Chemises', price: 9000, description: 'Chemise en coton respirant, coupe ajustée. Parfaite pour le bureau.', photo: 'men shirt', variants: sizes(['M', 'L', 'XL', 'XXL'], 6) },
      { name: 'Boubou bazin brodé', sub: 'Tenues traditionnelles', price: 35000, description: 'Grand boubou en bazin riche, broderie à la main, avec pantalon.', photo: 'african men traditional clothing', variants: sizes(['L', 'XL', 'XXL'], 3), prepay: 50 },
      { name: 'Pantalon chino', sub: 'Pantalons', price: 11000, description: 'Chino en coton stretch, coupe droite, plusieurs coloris.', photo: 'chino pants', variants: sizes(['38', '40', '42', '44'], 5) },
      { name: 'Polo piqué', sub: 'Chemises', price: 6500, description: 'Polo en maille piquée, col côtelé.', photo: 'polo shirt', variants: sizes(['M', 'L', 'XL'], 8) },
      { name: 'Ensemble tunique et pantalon en wax', sub: 'Tenues traditionnelles', price: 22000, description: 'Tunique col mao et pantalon en wax, coupe moderne.', photo: 'african print shirt man', variants: sizes(['M', 'L', 'XL'], 4) },
    ],
  },
  {
    icon: 'sneaker', name: 'Shoes Center Roxy', type: 'GROSSISTE', market: 'Black Market (Roxy)', location: 'Rangée 9, magasin 3', lat: 5.3574, lng: -4.0262,
    description: 'Baskets, sandales et chaussures pour toute la famille. Prix de gros pour les revendeurs.', storefront: 'shoe store', prepay: 100, featured: true,
    products: [
      { name: 'Baskets en toile', sub: 'Homme', price: 12000, description: 'Baskets légères en toile, semelle caoutchouc.', photo: 'canvas sneakers', variants: sizes(['40', '41', '42', '43', '44'], 6), wholesale: [9000, 6] },
      { name: 'Sandales en cuir femme', sub: 'Femme', price: 7000, description: 'Sandales plates en cuir véritable, bride réglable.', photo: 'leather sandals', variants: sizes(['37', '38', '39', '40'], 6), wholesale: [5000, 6] },
      { name: 'Escarpins talon moyen', sub: 'Femme', price: 15000, description: 'Escarpins élégants, talon 6 cm, confortables toute la journée.', photo: 'women heels shoes', variants: sizes(['37', '38', '39', '40'], 4) },
      { name: 'Chaussures de ville en cuir', sub: 'Homme', price: 25000, description: 'Derbies en cuir lisse, semelle cousue.', photo: 'men leather shoes', variants: sizes(['41', '42', '43', '44'], 4) },
      { name: 'Baskets enfant à scratch', sub: 'Enfant', price: 8000, description: 'Baskets à scratch pour enfants, faciles à enfiler.', photo: 'kids sneakers', variants: sizes(['28', '30', '32', '34'], 6), wholesale: [6000, 6] },
    ],
  },
  {
    icon: 'sparkle', name: 'Beauté Divine', type: 'BOUTIQUE', market: 'Forum des marchés', location: 'Allée B, magasin 22', lat: 5.3547, lng: -4.0219,
    description: 'Soins du corps, maquillage, mèches et parfums. Conseils beauté sur place.', storefront: 'cosmetics store', prepay: 100,
    products: [
      { name: 'Beurre de karité pur 250 g', sub: 'Soins du corps', price: 3500, description: 'Karité brut non raffiné, idéal pour la peau et les cheveux.', photo: 'shea butter', stock: 50 },
      { name: 'Mèches brésiliennes 3 paquets', sub: 'Mèches et perruques', price: 25000, description: 'Cheveux naturels, ondulés, 3 paquets de 16 pouces.', photo: 'hair extensions', stock: 10 },
      { name: 'Palette de maquillage yeux', sub: 'Maquillage', price: 8000, description: '18 teintes mates et irisées, longue tenue.', photo: 'eyeshadow palette', stock: 20 },
      { name: 'Parfum eau de toilette 100 ml', sub: 'Parfums', price: 12000, description: 'Notes florales et boisées, tenue longue durée.', photo: 'perfume bottle', stock: 15 },
      { name: 'Savon noir naturel', sub: 'Soins du corps', price: 1500, description: 'Savon noir traditionnel, nettoie en douceur.', photo: 'natural soap', stock: 60 },
    ],
  },
  {
    icon: 'cookingPot', name: 'Maison & Cuisine Bracodi', type: 'BOUTIQUE', market: 'Marché de Bracodi', location: 'Entrée principale, boutique 5', lat: 5.3512, lng: -4.0186,
    description: 'Ustensiles de cuisine, vaisselle, décoration et linge de maison.', storefront: 'kitchenware store', prepay: 100,
    products: [
      { name: 'Marmite en aluminium 10 L', sub: 'Ustensiles', price: 9000, description: 'Marmite robuste en aluminium avec couvercle, 10 litres.', photo: 'cooking pot', stock: 20 },
      { name: 'Service de 6 assiettes', sub: 'Ustensiles', price: 12000, description: '6 assiettes plates en porcelaine, passent au micro-ondes.', photo: 'dinner plates', stock: 15 },
      { name: 'Parure de draps 2 places', sub: 'Linge de maison', price: 15000, description: 'Drap housse, drap plat et 2 taies, 100 % coton.', photo: 'bed sheets', stock: 10 },
      { name: 'Vase décoratif en céramique', sub: 'Décoration', price: 7500, description: 'Vase en céramique fait main, hauteur 30 cm.', photo: 'ceramic vase', stock: 12 },
      { name: 'Lot de 4 serviettes de bain', sub: 'Linge de maison', price: 10000, description: 'Serviettes en coton épais et doux, 70 × 140 cm.', photo: 'bath towels', stock: 18 },
    ],
  },
  {
    icon: 'basket', name: 'Épicerie du Marché Gouro', type: 'GROSSISTE', market: 'Marché Gouro', location: 'Hangar 2, place 14', lat: 5.3612, lng: -4.0207,
    description: 'Riz, huile, épices, boissons et produits frais. Vente au détail et en gros.', storefront: 'grocery market', prepay: 100,
    products: [
      { name: 'Riz parfumé 25 kg', sub: 'Épicerie', price: 17500, description: 'Riz long grain parfumé, sac de 25 kg.', photo: 'rice bag', stock: 40, wholesale: [16000, 10] },
      { name: 'Huile végétale 5 L', sub: 'Épicerie', price: 7000, description: 'Huile de cuisson raffinée, bidon de 5 litres.', photo: 'cooking oil bottle', stock: 50, wholesale: [6200, 12] },
      { name: 'Attiéké frais 1 kg', sub: 'Produits frais', price: 1000, description: 'Attiéké frais du jour, préparé à Adjamé.', photo: 'cassava couscous', stock: 30 },
      { name: 'Jus de bissap 1 L', sub: 'Boissons', price: 1500, description: 'Jus d’hibiscus fait maison, peu sucré.', photo: 'hibiscus drink', stock: 25 },
      { name: 'Mélange d’épices 500 g', sub: 'Épicerie', price: 2500, description: 'Piment, poivre, gingembre et soumbara pour vos sauces.', photo: 'spices market', stock: 40, wholesale: [2000, 20] },
    ],
  },
  {
    icon: 'baby', name: 'Bébé Câlin', type: 'BOUTIQUE', market: 'Williamsville', location: 'Avenue principale, boutique 9', lat: 5.3685, lng: -4.0152,
    description: 'Vêtements pour enfants, puériculture et jouets.', storefront: 'baby store', prepay: 100,
    products: [
      { name: 'Body bébé coton lot de 3', sub: 'Vêtements', price: 7500, description: '3 bodies manches courtes en coton doux.', photo: 'baby clothes', variants: sizes(['0-3 mois', '3-6 mois', '6-12 mois'], 8) },
      { name: 'Poussette pliable', sub: 'Puériculture', price: 65000, description: 'Poussette légère, pliage compact, harnais 5 points.', photo: 'baby stroller', stock: 4, prepay: 50 },
      { name: 'Biberons anti-coliques lot de 2', sub: 'Puériculture', price: 6000, description: '2 biberons 250 ml avec tétine anti-coliques.', photo: 'baby bottle', stock: 20 },
      { name: 'Jeu de construction 100 pièces', sub: 'Jouets', price: 9000, description: 'Briques colorées pour les 3 ans et plus.', photo: 'building blocks toy', stock: 15 },
      { name: 'Peluche douce', sub: 'Jouets', price: 5000, description: 'Peluche toute douce, lavable en machine.', photo: 'teddy bear', stock: 20 },
    ],
  },
  {
    icon: 'wrench', name: 'Auto Moto Pièces 220', type: 'GROSSISTE', market: '220 Logements', location: 'Carrefour, garage 3', lat: 5.3738, lng: -4.0284,
    description: 'Pièces détachées auto et moto, pneus, batteries et huiles.', storefront: 'auto parts store', prepay: 50,
    products: [
      { name: 'Batterie auto 12 V 70 Ah', sub: 'Pneus et batteries', price: 55000, description: 'Batterie sans entretien, garantie 1 an.', photo: 'car battery', stock: 8, wholesale: [50000, 4] },
      { name: 'Pneu moto 2.75-17', sub: 'Pneus et batteries', price: 15000, description: 'Pneu moto renforcé, bonne adhérence sur route.', photo: 'motorcycle tire', stock: 20, wholesale: [12500, 6] },
      { name: 'Huile moteur 4 L', sub: 'Pièces auto', price: 18000, description: 'Huile moteur semi-synthétique 10W-40.', photo: 'motor oil', stock: 25, wholesale: [16000, 6] },
      { name: 'Kit chaîne moto', sub: 'Pièces moto', price: 12000, description: 'Chaîne, pignon et couronne pour motos 125 cm³.', photo: 'motorcycle chain', stock: 15 },
      { name: 'Plaquettes de frein avant', sub: 'Pièces auto', price: 14000, description: 'Plaquettes de frein, précisez le modèle de votre véhicule.', photo: 'brake pads', stock: 18 },
    ],
  },
  {
    icon: 'soccerBall', name: 'Sport Plus Adjamé', type: 'BOUTIQUE', market: 'Forum des marchés', location: 'Allée F, magasin 4', lat: 5.3559, lng: -4.0239,
    description: 'Ballons, maillots, équipements de sport et de loisirs.', storefront: 'sports store', prepay: 100,
    products: [
      { name: 'Ballon de football taille 5', price: 9000, description: 'Ballon cousu, taille officielle, pour terrain et pelouse.', photo: 'soccer ball', stock: 25 },
      { name: 'Maillot de football', price: 8000, description: 'Maillot respirant, séchage rapide.', photo: 'football jersey', variants: sizes(['M', 'L', 'XL'], 10) },
      { name: 'Corde à sauter', price: 3000, description: 'Corde réglable avec poignées antidérapantes.', photo: 'jump rope', stock: 30 },
      { name: 'Haltères 2 × 5 kg', price: 20000, description: 'Paire d’haltères en fonte avec revêtement.', photo: 'dumbbells', stock: 10 },
      { name: 'Tapis de yoga', price: 10000, description: 'Tapis antidérapant 6 mm, avec sangle de transport.', photo: 'yoga mat', stock: 15 },
    ],
  },
  {
    icon: 'hammer', name: 'Quincaillerie Liberté', type: 'GROSSISTE', market: 'Marché Liberté', location: 'Boulevard, magasin 11', lat: 5.3646, lng: -4.0301,
    description: 'Outillage, électricité, plomberie et matériaux. Conseils de pro.', storefront: 'hardware store tools', prepay: 50,
    products: [
      { name: 'Perceuse visseuse sans fil', sub: 'Outillage', price: 32000, description: 'Perceuse 18 V, 2 batteries, chargeur et coffret.', photo: 'cordless drill', stock: 8 },
      { name: 'Coffret de tournevis 24 pièces', sub: 'Outillage', price: 8500, description: 'Tournevis et embouts en acier chrome-vanadium.', photo: 'screwdriver set', stock: 15, wholesale: [7000, 6] },
      { name: 'Rallonge électrique 5 m multiprise', sub: 'Électricité', price: 6000, description: 'Multiprise 4 prises avec interrupteur, câble 5 m.', photo: 'power strip', stock: 30, wholesale: [4800, 10] },
      { name: 'Ampoules LED 12 W lot de 4', sub: 'Électricité', price: 5000, description: 'Ampoules basse consommation, lumière blanche.', photo: 'led light bulb', stock: 40, wholesale: [3800, 10] },
      { name: 'Robinet mitigeur', sub: 'Plomberie', price: 15000, description: 'Mitigeur chromé pour lavabo, flexibles inclus.', photo: 'faucet', stock: 10 },
    ],
  },
  {
    icon: 'notebook', name: 'Papeterie Rentrée Plus', type: 'GROSSISTE', market: 'Gare routière (Adjamé Nord)', location: 'Face à la gare, boutique 6', lat: 5.3712, lng: -4.0222,
    description: 'Fournitures scolaires et de bureau, au détail et en gros pour les écoles.', storefront: 'stationery store', prepay: 100,
    products: [
      { name: 'Cahiers 200 pages lot de 5', sub: 'Fournitures scolaires', price: 4000, description: '5 cahiers grands carreaux, couverture souple.', photo: 'notebooks', stock: 60, wholesale: [3200, 20] },
      { name: 'Sac à dos scolaire', sub: 'Fournitures scolaires', price: 12000, description: 'Sac à dos résistant, compartiment ordinateur.', photo: 'school backpack', stock: 20 },
      { name: 'Stylos à bille boîte de 50', sub: 'Bureau', price: 5000, description: 'Stylos bleus à bille, écriture fluide.', photo: 'ballpoint pens', stock: 30, wholesale: [4000, 10] },
      { name: 'Calculatrice scientifique', sub: 'Fournitures scolaires', price: 9000, description: 'Calculatrice scientifique pour le collège et le lycée.', photo: 'scientific calculator', stock: 20 },
      { name: 'Ramette papier A4 500 feuilles', sub: 'Bureau', price: 3500, description: 'Papier blanc 80 g pour imprimante et photocopieur.', photo: 'printer paper', stock: 50, wholesale: [3000, 10] },
    ],
  },
];
