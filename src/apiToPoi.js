// Adaptateur : un enregistrement de VOTRE API -> objet `Poi` du SDK La Trace.
//
// Le SDK ne stocke aucune donnee : vous lui POUSSEZ vos POIs au format `Poi`
// (contrat SDK, section 3.1). Ce fichier montre le seul point a adapter chez vous :
// mapper la forme de votre API vers ce format. Ici on part d'un enregistrement
// generique ; remplacez les acces de champs par les votres.
//
// Trois axes independants (contrat 3.4) :
//   - category : categorie de marque grossiere -> COULEUR du marqueur (config.poiColors)
//   - poiType  : type structurel fin (taxonomie La Trace) -> GLYPHE/icone du marqueur
//   - facets   : filtres riches transverses (terrasse, budget...)

// category de votre API -> categorie de marque (cle de config.poiColors).
const CATEGORY_MAP = {
  restaurant: 'restaurant',
  bar: 'bar',
  hotel: 'lodging',
  shop: 'grocery',
  wineshop: 'wineshop',
};

// category de votre API -> PoiType La Trace (pilote l'icone). Valeurs possibles :
// Restaurant, Bar, Hotel, BnB, Cafe, Bakery, Market, ProducerShop, Grocery, WineShop...
const POI_TYPE_MAP = {
  restaurant: 'Restaurant',
  bar: 'Bar',
  hotel: 'Hotel',
  shop: 'Grocery',
  wineshop: 'WineShop',
};

export function apiToPoi(record) {
  return {
    id: String(record.id),                                   // requis, cle opaque
    coords: [record.lng, record.lat],                        // requis, [lng, lat] WGS84
    category: CATEGORY_MAP[record.type] || 'restaurant',     // requis
    poiType: POI_TYPE_MAP[record.type],                      // optionnel (prime sur category pour l'icone)
    name: record.title,                                      // requis
    address: record.address,
    city: record.city,
    postalCode: record.postalCode,
    country: record.country,                                 // ISO-3166 alpha-2 ('FR' | 'BE')
    priceRange: record.price,                                // '€'..'€€€€' OU { min, max, currency:'EUR' }
    images: record.photo ? [{ url: record.photo }] : undefined,
    externalUrl: record.url,                                 // mode externalPreview : clic -> votre page
    facets: record.tags?.length ? { tags: record.tags } : undefined,
  };
}
