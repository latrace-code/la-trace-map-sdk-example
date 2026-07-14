# La Trace Map SDK — Contrat d'API

> **Statut :** spec dev-ready. Surface d'intégration `createLaTraceExplore`.
> **Package :** `@la-trace/map-sdk` `0.3.3` — `createLaTraceExplore` (embed Explore) + `createLaTraceMap` (renderer léger) + signature static-map backend (`@la-trace/map-sdk/static-map`).
> **Produit générique :** API produit La Trace, pas un contrat spécifique Fooding. Le Fooding est l'intégration de référence (§6).
> **Source de vérité :** types TypeScript (`packages/map-sdk/src/explore/types.ts`, générés en `.d.ts` du package) pour le SDK JS + OpenAPI (NestJS) pour le REST. Ce Markdown est la spec narrative, versionnée avec le package. **Les deux sont désormais à parité** (aucun champ implémenté non typé).
> **Dernière révision :** 2026-07-11.

---

## 0. Vue d'ensemble

Le SDK embarque l'expérience **La Trace Explore complète** (carte, recherche, filtres, panneaux POI) dans n'importe quelle page web ou webview native. Le consommateur instancie le SDK, lui **pousse ses POIs** et des **overrides de config** ; le SDK rend l'UX et **émet des events**.

**Modèle d'architecture (à connaître pour intégrer) :**
- Le SDK monte un **conteneur carte isolé** (iframe de l'app La Trace) et expose une **API JS typée** par-dessus un pont `postMessage`. L'hôte n'écrit jamais de `postMessage` brut.
- **Pont asynchrone.** Toute commande hôte → SDK et tout event SDK → hôte transitent par `postMessage`. **Aucune lecture d'état n'est temps réel :** les getters (`getViewport`, `getState`) renvoient le **dernier état connu en cache**, rafraîchi par les events (`viewport:change`, `state:change`). Pour un état frais garanti, écouter l'event correspondant.
- **Zéro-stockage.** La Trace ne stocke aucune donnée POI. L'hôte pousse les POIs (`setPois`) ; recherche et filtres tournent sur ce corpus, en mémoire. Rien n'est persisté côté La Trace.
- **Config = base + overrides.** La config de base (theming, sections, wording, droits) est résolue serveur depuis le `configId`. Le SDK ne pousse que des **overrides ciblés** (`config`), mergés par-dessus.
- **Stats :** deux flux non exclusifs. (a) La Trace agrège des KPIs par carte (clé = `configId`) pour son dashboard, automatiquement. (b) Le SDK **émet des events** portant les **IDs POI de l'hôte**, à brancher sur l'analytics de l'hôte.
- **iOS / natif :** même API JS dans une `WKWebView` (pont Swift `la-trace-map-sdk-swift`) ; la géoloc native alimente `setUserLocation()`. Volet V2.

**Trois surfaces :** SDK JS (§2), schémas de données (§3), endpoints REST (§4).

---

## 1. Authentification & accès

Le SDK tourne dans la page du client : **la clé est visible côté client, ce n'est pas un secret.** Modèle **clé publiable** (comme Mapbox / Google Maps), sécurisé serveur.

### 1.1 Clé publiable

| | |
|---|---|
| Format | `pk_live_<random>` (prod), `pk_test_<random>` (test) |
| Passage | Param `apiKey` à l'init **et** header `X-LaTrace-Key` sur les appels REST JSON. **Exception : `static-map` s'authentifie par query-param** (§1.4). |
| Nature | Publique. La sécurité vient de l'allowlist + quotas + entitlement, validés serveur. |

### 1.2 Contrôles serveur (par clé)

- **Allowlist d'origines** (`Origin`/`Referer`) : sinon `403 origin_not_allowed`.
- **Quotas & rate-limits** par clé (alignés +150 % de la volumétrie contractuelle) : dépassement → `429 quota_exceeded` (header `Retry-After`).
- **Entitlement** : identité client + périmètre (`configId` autorisés, endpoints). Hors périmètre → `403 forbidden_config`.
- **Session carte** : une session comptée par clé (facturation MapTiler / dashboard).

### 1.3 CORS & anti-rejeu

- Les réponses REST JSON renvoient `Access-Control-Allow-Origin` **échoant l'origine de la requête** (pas `*`), pour que le navigateur bloque un usage hors origines déclarées.
- **Appels issus de l'iframe** (recherche géocodage interne) : le navigateur envoie l'origine de l'iframe La Trace, pas celle de l'embedder. L'iframe forward l'origine embedder déclarée (`sdkHost`) via `X-LaTrace-Embedder-Origin` ; le serveur **autorise contre cette origine embedder** (allowlist) mais **échoe l'origine réelle** de la requête en CORS. Les appels host-side (`createLaTraceGeocoder`, exécuté sur la page embedder) envoient un vrai `Origin` et n'ont pas besoin du header.
- L'allowlist `Origin`/`Referer` est **spoofable en server-to-server** : les endpoints coûteux (`geocode`, `static-map`) sont donc en plus **rate-limités par clé** et, pour `static-map`, protégés par **URL signée à expiration** (§1.4). Ne jamais faire dépendre la facturation du seul `Referer`.

### 1.4 Cas `static-map` (image, non-authentifiable par header)

Une balise `<img>` ne peut pas envoyer de header custom. `static-map` s'authentifie donc **par query-param** :
- `key=pk_live_...` obligatoire dans l'URL,
- contrôle `Referer`/`Origin` + entitlement `configId`,
- **URL signée** : `sig=<hmac>` + `exp=<timestamp>` générés côté hôte (backend hôte) avec un secret partagé, pour empêcher le pompage du quota (coût MapTiler). Une URL non signée ou expirée → `403`.

Le header `X-LaTrace-Key` **ne s'applique pas** à `static-map`.

**Helper de signature (backend hôte)** : le SDK expose `signStaticMapUrl()` sur le sous-chemin **`@la-trace/map-sdk/static-map`** (Node uniquement — il utilise `node:crypto` et le secret par clé, jamais côté navigateur). Il reproduit la forme canonique serveur : tous les query params sauf `sig`, triés par clé, sur les valeurs **brutes** (non url-encodées), `HMAC-SHA256` en hex ; `exp` en **epoch secondes** futur. À utiliser sur le backend hôte pour bâtir l'`src` des `<img>` de vignettes (voir §6).

### 1.5 Réponses d'erreur d'auth

| HTTP | `code` | Sens |
|---|---|---|
| 401 | `invalid_key` | Clé absente / malformée / inconnue |
| 403 | `origin_not_allowed` | Origine hors allowlist |
| 403 | `forbidden_config` | `configId` hors entitlement |
| 403 | `invalid_signature` | URL static-map non signée / expirée |
| 429 | `quota_exceeded` | Quota / rate-limit dépassé |

Erreur d'auth au boot du SDK → event `error` (§2.4) avec le même `code`, la carte ne s'initialise pas.

---

## 2. SDK JS API

### 2.1 Installation

```bash
npm install @la-trace/map-sdk
```

```ts
import { createLaTraceExplore } from '@la-trace/map-sdk'
import '@la-trace/map-sdk/style.css'
```

### 2.2 Initialisation

```ts
function createLaTraceExplore(options: ExploreOptions): LaTraceExplore
```

```ts
interface ExploreOptions {
  container: string | HTMLElement        // Requis
  apiKey: string                         // Requis (pk_live_* / pk_test_*)
  configId: string                       // Requis (config de base + clé de stats)
  config?: ConfigOverride                // Overrides ciblés
  locale?: Locale                        // 'fr' | 'en' | 'nl'
  initialView?: {
    center?: [number, number]            // [lng, lat]
    zoom?: number
    bbox?: [number, number, number, number] // [w, s, e, n]
  }
  pois?: Poi[]                           // POIs au boot
  initialFilters?: ActiveFilters         // Pré-filtrage au boot
  initialFavorites?: string[]            // Cœurs déjà pleins (rehydratation)
  state?: ExploreState                   // Restauration d'état complète (deep-link)
  allow?: string[]                       // Permissions iframe (défaut ['geolocation','fullscreen'])
}
```

Résolution de la **locale** (précédence, du plus fort au plus faible) : `ExploreOptions.locale` > `ConfigOverride.locale` > langue navigateur > `'fr'`. `setLocale()` écrase à chaud (source unique : géocodeur, onglets éditoriaux et preview suivent la même locale).

L'init est un **état de boot complet, pas un patch** : le `config` fourni remplace l'override courant (un ré-init dans la même iframe n'hérite pas des champs omis par le nouvel hôte). Les ajustements incrémentaux à chaud passent par `config:override` / les setters dédiés.

`createLaTraceExplore` retourne **synchroniquement** une instance. La carte n'est prête qu'après l'event `ready` (ou `await instance.ready()`).

```ts
const explore = createLaTraceExplore({
  container: '#map',
  apiKey: 'pk_live_xxx',
  configId: '9c2f98f1-394a-41d9-a7ba-99de654b7e6d',
  locale: 'fr',
  config: { poiDetailMode: 'externalPreview' },
})
await explore.ready()
const result = explore.setPois(pois)      // voir PushResult (§2.3)
```

### 2.3 Méthodes

```ts
interface LaTraceExplore {
  // ---- Cycle de vie ----
  ready(): Promise<void>
  /** Force un recalcul de taille (si le conteneur hôte est redimensionné hors ResizeObserver). */
  resize(): void
  destroy(): void

  // ---- Données POI (corpus poussé) ----
  /** Remplace tout le jeu affiché. Diff par `id` (pas de flicker). Retourne le bilan de validation. */
  setPois(pois: Poi[]): PushResult
  /** Upsert par `id` (ajoute ou remplace l'entrée). */
  addPois(pois: Poi[]): PushResult
  /** Remplace intégralement un POI existant (par `id`). */
  updatePoi(poi: Poi): PushResult
  removePois(ids: string[]): void
  clearPois(): void
  /** Affiche l'état de chargement natif (skeleton panneau) pendant un fetch hôte. */
  setLoading(loading: boolean): void

  // ---- Config live ----
  setConfigOverride(config: Partial<ConfigOverride>): void
  setLocale(locale: Locale): void

  // ---- Caméra ----
  flyTo(target: CameraTarget, options?: CameraOptions): void
  fitBounds(bbox: [number, number, number, number], options?: { padding?: number | Padding }): void
  setCenter(center: [number, number]): void
  setZoom(zoom: number): void
  /** Dernier viewport connu (cache, rafraîchi par `viewport:change`). Pas temps réel. */
  getViewport(): Viewport

  // ---- Sélection / panneaux ----
  openPoi(poiId: string): void
  closePanel(): void
  /** Emphase marqueur (anneau) sans ouvrir. null pour retirer. */
  highlightPoi(poiId: string | null): void

  // ---- Recherche & filtres ----
  search(query: string): void
  clearSearch(): void
  setActiveFilters(filters: ActiveFilters): void
  clearFilters(): void
  /** Alimente l'UI « recherches récentes » (persistance = hôte). */
  setRecentSearches(items: string[]): void

  // ---- Favoris ----
  /** Rehydrate les cœurs pleins (après reload / depuis le compte hôte). */
  setFavorites(ids: string[]): void

  // ---- État (deep-link / restauration) ----
  /** État sérialisable (POI ouvert, filtres, recherche, viewport). Cache last-known. */
  getState(): ExploreState
  /** Restaure un état complet (reload, partage). */
  applyState(state: ExploreState): void

  // ---- Géoloc (pont natif / webview) ----
  setUserLocation(coords: { lng: number; lat: number; accuracy?: number } | null): void

  // ---- Events ----
  on<E extends keyof ExploreEvents>(event: E, handler: (payload: ExploreEvents[E]) => void): void
  off<E extends keyof ExploreEvents>(event: E, handler: (payload: ExploreEvents[E]) => void): void
}

type Locale = 'fr' | 'en' | 'nl'
type ActiveFilters = Record<string, string[]>
interface CameraTarget { center: [number, number]; zoom?: number; pitch?: number; bearing?: number }
interface CameraOptions { durationMs?: number }   // défaut 600
type Padding = { top?: number; right?: number; bottom?: number; left?: number } // en px
interface Viewport { center: [number, number]; zoom: number; bbox: [number, number, number, number] }

interface PushResult {
  accepted: number
  rejected: Array<{ id?: string; reason: PushRejectReason }>
}
type PushRejectReason = 'missing_id' | 'duplicate_id' | 'invalid_coords' | 'unknown_category' | 'invalid_field'

interface ExploreState {
  openPoiId?: string
  activeFilters?: ActiveFilters
  query?: string
  viewport?: Viewport
  favorites?: string[]
}
```

**Comportements clés :**
- **Décluttering densité** automatique (pas de clustering groupé numéroté), aucun réglage requis.
- **Politique de push :** un POI invalide est **rejeté** (jamais affiché faux) et remonté dans `PushResult.rejected` + event `pois:rejected`. Le reste du batch est accepté. `unknown_category` → le POI est **accepté** avec un marqueur neutre mais listé en `rejected` (avertissement, pas blocage). Le « connu » est défini par les **clés de `config.poiColors`** (la palette déclarée par l'hôte) : une `category` sans couleur mappée = marqueur neutre + avertissement. **Le SDK ne porte aucune liste de catégories en dur** : si l'hôte ne déclare aucune couleur (`poiColors` absent), le SDK ne peut pas juger et **n'émet jamais** `unknown_category`.
- **`updatePoi` = remplacement complet** de l'objet par `id` (pas de patch partiel). Pour ajouter sans tout remplacer, `addPois`.
- **`resize`** : le SDK observe le conteneur (ResizeObserver) ; `resize()` n'est utile que si le conteneur change de taille sans que l'observer le détecte (ex. transition CSS).
- **Deep-link :** `getState()` sérialise l'état ; `applyState()`/`ExploreOptions.state` le restaure. L'hôte décide s'il reflète cet état dans SON URL (via `state:change`).

### 2.4 Events

```ts
interface ExploreEvents {
  'ready': {}
  'error': { code: string; message: string }

  // POIs
  'pin:click': { poi: Poi }
  'pin:hover': { poiId: string | null }        // survol carte (entrée/sortie)
  'poi:view': { poiId: string }                // panneau/preview affiché
  'gallery:open': { poiId: string }
  'pois:rejected': { rejected: Array<{ id?: string; reason: PushRejectReason }> }

  // Mode externalPreview
  'preview:open': { poiId: string }
  'preview:close': { poiId: string; navigated: boolean } // navigated=true si clic vers externalUrl
  'external:open': { poiId: string; url: string }
  'reservation:click': { poiId: string; url: string }

  // Recherche / filtres
  'search:query': { query: string }            // frappe débouncée
  'search:submit': { query: string; resultCount: number }
  'search:area': { bbox: [number, number, number, number] }
  'results:empty': { context: 'search' | 'filters' | 'viewport' }
  'filter:change': { filters: ActiveFilters }

  // Carte / navigation
  'viewport:change': Viewport
  'basemap:change': { basemap: BasemapId }
  'geolocate': { coords: { lng: number; lat: number; accuracy?: number } }

  // État & historique
  'state:change': ExploreState                 // à chaque mutation d'état (pour synchro URL hôte)
  'back': {}                                    // retour déclenché dans l'iframe (ex. back mobile)

  // Divers
  'favorite:toggle': { poiId: string; favorited: boolean }
  'locale:change': { locale: Locale }          // l'hôte peut re-pousser le corpus traduit
}

type BasemapId = 'plan' | 'satellite' | 'topo'
```

Tous les events portant un `poiId` utilisent **l'`id` fourni par l'hôte** (pass-through), pour un branchement analytics direct.

**Back mobile :** en embed, le SDK émet `back` quand l'utilisateur déclenche un retour (bouton retour UI, geste). L'hôte décide : fermer un panneau (`closePanel`), ou laisser le back navigateur agir. Aucune manipulation d'historique n'est faite sans l'hôte.

---

## 3. Schémas de données

### 3.1 POI poussé (`Poi`)

L'hôte pousse le POI complet (affichage + recherche + fiche). Aucun champ n'est stocké côté La Trace.

```ts
/** Champ texte mono-langue OU localisé (évite un re-push complet à chaque bascule de locale). */
type LocalizedString = string | Partial<Record<Locale, string>>

interface Poi {
  id: string                             // ID opaque hôte, clé partout. Requis.
  coords: [number, number]               // [lng, lat] WGS84. Requis.
  category: string                       // Catégorie hôte brute (couleur de marque, §3.4). Requis.
  name: LocalizedString                  // Requis.

  poiType?: string                       // Type STRUCTUREL fin = valeur PoiType (taxonomie La Trace), ex. 'Restaurant'/'Bakery'/'WineShop'. Pilote le glyphe. PRIME sur le mapping de `category`.

  typeLabel?: LocalizedString
  address?: string
  city?: string
  postalCode?: string
  country?: string                       // ISO-3166 alpha-2 ('FR' | 'BE')
  priceRange?: PriceLevel | PriceBand
  openingHours?: OpeningHours | string
  phone?: string
  email?: string
  website?: string
  description?: LocalizedString          // Markdown
  images?: PoiImage[]
  badges?: PoiBadge[]

  externalUrl?: string                   // mode externalPreview + partage
  reservationUrl?: string                // deep-link réservation (TheFork) -> CTA « Réserver »

  facets?: Record<string, string[]>      // filtres riches (§3.3)
  rank?: number                          // ranking / priorité décluttering (plus haut = prioritaire)

  editorialTabs?: EditorialTab[]
  adSlot?: AdSlot
  custom?: Record<string, unknown>       // passé tel quel, jamais interprété
}

type PriceLevel = '€' | '€€' | '€€€' | '€€€€'
/** Fourchette de prix moyen PAR PERSONNE. */
interface PriceBand { min?: number; max?: number; currency: string } // currency ISO-4217, ex. 'EUR'

interface PoiImage { url: string; alt?: string; credit?: string }
interface PoiBadge { type: 'featured' | 'sponsored' | 'in-guide' | string; label?: string }
interface EditorialTab { key: string; label: LocalizedString; contentMarkdown: LocalizedString }
interface AdSlot { html?: string; imageUrl?: string; clickUrl?: string; label?: string }

/** Horaires locaux du POI (fuseau du lieu ; FR+BE = Europe/Paris, même offset).
 *  0 = dimanche … 6 = samedi. Jour absent = fermé. Plusieurs plages = service coupé. */
interface OpeningHours {
  timezone?: string                      // IANA, défaut = fuseau du pays
  days: { [day: number]: Array<{ open: string; close: string }> } // 'HH:MM'
}
```

Si un champ localisé est fourni en `string`, il vaut pour toutes les locales. Si fourni en objet, la locale active choisit ; fallback sur `fr` puis première clé disponible.

**Trois axes indépendants — `poiType` vs `category` vs `facets`.** Un POI porte trois qualifications qui ne se recouvrent pas :

- **`poiType`** (optionnel, `PoiType` de la taxonomie La Trace) — le **type structurel fin** : ce que le lieu *est* (boulangerie, boucherie, café, caviste…). Il pilote l'**icône/glyphe** du marqueur, son **label** et le **filtre catégorie natif** (§3.4, clé de filtre `poiType`). **Il prime sur le mapping de `category`** : présent → il détermine le type effectif du POI ; absent → repli sur le mapping grossier de `category`. C'est ce qui permet un marqueur/filtre **au bon grain** là où `category` est trop large (ex. une boulangerie et une épicerie, toutes deux `category:'grocery'`, se distinguent par `poiType`).
- **`category`** (requis, string hôte libre) — la **catégorie de marque grossière**, qui pilote la **couleur** du marqueur (via `config.poiColors`, source unique) et le filtre catégorie brut hôte.
- **`facets`** (optionnel, §3.3) — les **filtres riches** transverses (terrasse, budget, « Envie de »…), orthogonaux au type comme à la catégorie.

Les trois sont découplés : un même `poiType` peut vivre sous plusieurs `category`, et inversement ; les `facets` ne dépendent d'aucun des deux.

### 3.2 Objet d'override de config (`ConfigOverride`)

Overrides **ciblés** mergés sur la config de base. L'hôte ne pousse que ce qu'il surcharge.

```ts
interface ConfigOverride {
  theme?: Record<string, string>         // tokens CSS --lt-*
  fonts?: { body?: FontDef; headings?: FontDef }
  poiColors?: Record<string, { background: string; text: string }> // SOURCE UNIQUE couleur marqueurs + filtres
  poiExclusionRadiusPx?: number          // rayon d'exclusion POI↔POI (px) au déclutter. Plage (0, 200]
  filters?: FilterFacet[]
  showNativePoiTypeFilter?: boolean       // chip filtre NATIF sur le PoiType fin du corpus. Défaut false
  showNativeCategoryFilter?: boolean      // chip filtre NATIF sur la catégorie hôte (clé `category`). Défaut false. Indépendant du précédent
  categoryLabels?: Record<string, string> // relibelle les options du filtre catégorie natif (clé = catégorie hôte)
  sections?: SectionDef[]
  poiDetailMode?: 'panel' | 'externalPreview'
  wording?: Record<string, string>
  ads?: AdConfig
  mapNav?: {
    // Câblés aujourd'hui : `compass` + `pitch3d`. `zoom`/`fullscreen`/`geolocate`/
    // `basemapSwitcher` = intention, pas encore honorés côté rendu (à brancher).
    zoom?: boolean; compass?: boolean; pitch3d?: boolean
    fullscreen?: boolean; geolocate?: boolean; basemapSwitcher?: boolean
  }
  /** Visibilité des grands blocs d'UI. **Défaut `'full'`** : l'embed rend l'UX Explore complète (recherche + panneaux + filtres) sans config d'UI. `preset:'bare'` = carte nue (équivaut hideAllUI). */
  ui?: { preset?: 'full' | 'bare'; search?: boolean; panel?: boolean; filters?: boolean; chrome?: boolean }
  basemaps?: { default?: BasemapId; available?: BasemapId[] }
  search?: { placeholder?: string; geocoding?: boolean; recentSearches?: boolean }
  favorites?: { mode: 'off' | 'stateless' | 'host' }
  units?: 'metric' | 'imperial'          // distance live. Défaut 'metric'
  locale?: Locale
}

interface FontDef { family: string; url?: string }
interface FilterFacet {
  key: string
  label: string
  type: 'category' | 'checkbox' | 'range' | 'toggle'
  group?: string                         // regroupement riche : 'essentials' | 'price' | 'desire' | ...
  options?: Array<{ value: string; label: string; color?: string }>
  range?: { min: number; max: number; step?: number; unit?: string }
}
interface SectionDef { key: string; label?: string; visible?: boolean; order?: number }
interface AdConfig {
  slots?: Array<{ placement: 'list' | 'poi-panel' | 'no-results'; html?: string; imageUrl?: string; clickUrl?: string }>
}
```

**`poiExclusionRadiusPx` — densité de marqueurs.** Fixe le rayon d'exclusion POI↔POI (en px) appliqué au décluttering, **au lieu** de l'interpolation par zoom appliquée par défaut. Plus petit = plus de marqueurs affichés simultanément (cas annuaire dense, où l'on veut montrer un maximum d'adresses). Plage valide **`(0, 200]`** : le serveur **clampe à 200** au-delà, et **rejette** une valeur `<= 0` (retombe alors sur le comportement par défaut).

**`showNativePoiTypeFilter` — chip type de lieu natif.** Défaut `false`. Ajoute, **à côté** des facettes custom de l'hôte (`filters`), le **chip filtre natif de La Trace** sur le **`PoiType` fin** : ses options sont alimentées par les **`PoiType` réellement présents dans le corpus poussé** (labels de la taxonomie La Trace), et il filtre ce corpus **en place**. Off par défaut → aucun tenant SDK n'est impacté tant qu'il ne l'active pas.

**`showNativeCategoryFilter` — chip catégorie natif.** Défaut `false`. Même mécanique, mais sur la **catégorie hôte** (`Poi.category`, clé réservée `category`) plutôt que sur le `PoiType`. **Indépendant** de `showNativePoiTypeFilter` : un corpus mono-catégorie mais multi-type peut masquer le chip catégorie sans masquer le chip type. `categoryLabels` relibelle ses options.

**`categoryLabels` — relibellé du filtre natif.** Relibelle les options du chip catégorie natif. **Clé = catégorie hôte** (ex. `restaurant`, `wineshop`), **valeur = libellé affiché**. Sans override, chaque option retombe sur le **nom i18n (FR/EN/NL) du `PoiType` mappé** — jamais l'anglais brut de l'enum.

**`wording` — titres des chips catégorie natifs.** Là où `categoryLabels` relibelle les *options*, les **titres** des deux chips catégorie natifs sont candidats à surcharge via `wording`. Convention de clés :

| Clé `wording` | Défaut | Chip visé |
|---|---|---|
| `filter.category.title` | « Catégorie » | filtre sur la catégorie hôte brute (`Poi.category`) |
| `filter.poiType.title` | « Type de lieu » | filtre sur le `PoiType` effectif (`showNativePoiTypeFilter`) |

Exemple Fooding : voir §6.

### 3.3 Filtres riches, recherche in-memory, échelle

- Les **facettes** POI (`poi.facets`) sont matchées contre les `FilterFacet` (clé ↔ `key` ou `group`). Les clés `category` et `poiType` sont **réservées** (§3.4) : elles filtrent respectivement `Poi.category` et le `PoiType` effectif, jamais les facettes.
- **Recherche POI** (barre) : filtre le corpus poussé **en mémoire** (nom, ville, adresse, typeLabel), pas d'appel serveur. Pilotable par `search()` / `setActiveFilters()` ; lisible via `getState()`.
- **Distance live** (« 203 m ») : calculée depuis `setUserLocation`. Sans position, non affichée. Unité selon `config.units`.
- **« Rechercher dans cette zone »** : event `search:area(bbox)`. Deux modes supportés : (a) corpus complet poussé → le SDK filtre sur la bbox ; (b) push par zone → l'hôte répond par `setPois(bbox)`.
- **Échelle / perf :** corpus recommandé **≤ ~5 000 POIs** (au-delà : coût du clone `postMessage` + recherche linéaire + rendu marqueurs). Au-delà, pousser **par zone** (`addPois`/`removePois` sur `viewport:change`/`search:area`). `setPois` fait un **diff par `id`** (pas de re-création de tous les marqueurs).

### 3.4 Catégories, `PoiType` et clés de filtre réservées

**Deux qualifications, deux clés de filtre réservées.** Un POI porte une `category` hôte brute (couleur de marque) **et**, optionnellement, un `poiType` structurel fin (§3.1). Ces deux axes exposent chacun une **clé de filtre réservée** utilisable dans `ActiveFilters` / `setActiveFilters` / `initialFilters`, en miroir l'une de l'autre :

| Clé réservée | Filtre sur | Source |
|---|---|---|
| `category` | la **catégorie hôte brute** | `Poi.category` (string libre poussé par l'hôte) |
| `poiType` | le **`PoiType` effectif** | `Poi.poiType` s'il est fourni, sinon le `PoiType` déduit du mapping de `category` |

Toute autre clé de filtre est matchée contre `Poi.facets` (§3.3). `category` et `poiType` sont **réservées** : elles ne visent jamais les facettes.

**`category` pilote la couleur, `poiType` pilote le glyphe — La Trace ne mappe PAS l'une vers l'autre.** La `category` hôte (string libre, §3.1) détermine **uniquement la couleur** du marqueur (via `config.poiColors`). L'**icône/glyphe** vient **exclusivement** de `poiType` (taxonomie La Trace) : un POI sans `poiType` obtient un **marqueur neutre** (pas de glyphe déduit de la catégorie). Aucune table `category → PoiType` n'est câblée côté La Trace (ni dans le SDK, ni dans l'app) — c'est **l'hôte** qui choisit le `poiType` de chacun de ses POIs.

Le tableau ci-dessous illustre les choix de l'**intégration de référence (Le Fooding)** : comment SON code (côté hôte) projette ses rubriques/sous-types sur des `PoiType` La Trace. C'est un exemple d'intégration, pas une sémantique de `Poi.category`.

| Catégorie hôte (Fooding) | `poiType` poussé par l'hôte | Note |
|---|---|---|
| `restaurant` | `Restaurant` | |
| `lodging` | `Hotel` / `BnB` / `Hostel` | famille Lodging |
| `bar` | `Bar` / `Cafe` | |
| `grocery` | `ProducerShop` / `Bakery` / `Market` / `Grocery` | commerces de bouche |
| `wineshop` | `WineShop` | caviste / cave à vin. **`PoiType WineShop` créé côté back** (glyphe `WineProducer.svg`). |

Pour lever l'ambiguïté d'un `grocery` (boulangerie vs épicerie, même couleur de marque), l'hôte pousse le `poiType` fin correspondant — c'est ce qui donne le bon glyphe et alimente le filtre natif `poiType` (§3.2, `showNativePoiTypeFilter`).

---

### 3.5 Carte preview compacte (mode `externalPreview`)

En `poiDetailMode: 'externalPreview'`, un tap sur un marqueur n'ouvre **pas** le panneau riche : il affiche une **carte preview compacte** (flottante sur le pin en desktop, bottom-sheet bas d'écran en mobile), dont le clic déclenche `external:open` (navigation vers `poi.externalUrl`). Le contenu affiché, dérivé du `Poi` poussé :

| Élément | Champ source | Note |
|---|---|---|
| Image | `Poi.images[0]` | optionnelle |
| Tag catégorie coloré | `Poi.category` + `config.poiColors` | |
| Nom | `Poi.name` | |
| Distance | calculée via `setUserLocation` + `config.units` | si position connue |
| Prix | `Poi.priceRange` | `PriceBand` rendu « dès X-Y /pers », localisé selon la locale active (fr/en/nl) |
| Cœur favori | `favorite:toggle` | selon `config.favorites` |
| Fermer | → `preview:close({navigated:false})` | |
| Tap sur la card | → `external:open` + `preview:close({navigated:true})` | |

La **fiche riche complète** (onglets rédactionnels, horaires dépliables, réservation, ticket) vit alors **sur la page de l'hôte**, pas dans le SDK. Les champs riches du `Poi` (`editorialTabs`, `openingHours`…) ne sont utilisés que si `poiDetailMode: 'panel'`.

## 4. Endpoints REST

Base (preprod, environnement d'intégration) : `https://preprod.routinglatrace.com`. L'URL de production sera communiquée à la mise en service. Auth : header `X-LaTrace-Key` + `Origin` (sauf `static-map`, §1.4). JSON sauf `static-map` (binaire).

### 4.1 Géocodage / autocomplete de lieu

Recherche **géographique** (Photon). Distincte de la recherche POI (in-memory).

**Helper SDK (navigateur)** : plutôt que de réimplémenter le fetch + le cache de prédictions + la normalisation de bbox, l'hôte qui pilote **sa propre** barre de recherche (hors iframe) utilise `createLaTraceGeocoder` :

```ts
import { createLaTraceGeocoder } from '@la-trace/map-sdk'

const geocoder = createLaTraceGeocoder({
  apiKey: 'pk_live_xxx',
  apiBase: 'https://preprod.routinglatrace.com',
  countries: 'fr,be',        // optionnel ; omis => périmètre résolu serveur depuis la clé
})

const predictions = await geocoder.autocomplete('canal saint martin') // [{ id, label, secondary }]
const loc = await geocoder.geocode({ predictionId: predictions[0].id }) // { center, viewport (min/max normalisé), formattedAddress }
```

Le helper envoie `X-LaTrace-Key`, met en cache les prédictions (résolution sans 2e appel), et **normalise la bbox en min/max** (Photon renvoie parfois les coins dans un ordre non canonique). L'iframe Explore a en plus sa recherche interne (`config.search.geocoding`) ; ce helper ne sert qu'à une UI de recherche **côté hôte**.

**REST brut** (si l'hôte préfère appeler directement) :

```
GET /geocode?q={texte}&lang={fr|en|nl}&countries={fr,be}&near={lng,lat}&limit={n}
```

| Param | Type | Requis | Défaut | Note |
|---|---|---|---|---|
| `q` | string | oui | | ≥ 2 caractères |
| `lang` | enum | non | `fr` | |
| `countries` | csv ISO-2 | non | (config) | ex. `fr,be` |
| `near` | `lng,lat` | non | | biais proximité |
| `limit` | int | non | `8` | 1..20 |

**200 :**
```json
{ "results": [
  { "id": "photon:1234", "label": "Paris 11e Arrondissement, Paris",
    "type": "district", "coords": [2.3799, 48.8578],
    "bbox": [2.36, 48.85, 2.40, 48.87], "context": "Île-de-France, France" } ] }
```

```ts
interface GeocodeResult {
  id: string
  label: string
  type: 'city'|'town'|'village'|'district'|'address'|'poi'|'region'|'country'|string
  coords: [number, number]
  bbox?: [number, number, number, number]
  context?: string
}
```

Erreurs : `400 query_too_short` + auth.

### 4.2 Static map (vignette par POI / éditorial)

Image serveur avec **nos marqueurs + notre DA** (style depuis `configId`). Auth **par query-param + URL signée** (§1.4). Cacher agressivement.

```
GET /static-map?configId={id}&key={pk}&sig={hmac}&exp={ts}
    &center={lng,lat}&zoom={z}&width={w}&height={h}
    &markers={lng,lat,type,color;...}&basemap={plan|satellite|topo}&scale={1|2}&format={png|webp}
```

| Param | Type | Requis | Défaut | Note |
|---|---|---|---|---|
| `configId` | string | oui | | DA (theme) |
| `key` | string | oui | | clé publiable |
| `sig`,`exp` | string,int | oui | | signature + expiration (§1.4) |
| `center` | `lng,lat` | oui* | | *ou `bbox` |
| `bbox` | `w,s,e,n` | oui* | | *ou `center`+`zoom` |
| `zoom` | number | non | auto | |
| `width`,`height` | int | oui | | max 1280 |
| `markers` | string | non | | `lng,lat,type,color` séparés par `;` |
| `basemap` | enum | non | `plan` | |
| `scale` | 1\|2 | non | `1` | retina |
| `format` | enum | non | `png` | `png` \| `webp` |

**200 :** `image/png` (ou webp). `Cache-Control: public, max-age=2592000, immutable`.
Erreurs : `400 invalid_params`, `403 invalid_signature`, `413 dimensions_too_large`.

### 4.3 Stats agrégées (optionnel, lecture)

Ingestion primaire **automatique** (app embarquée → MapTracking, clé `configId`). Cet endpoint expose la lecture agrégée.

```
GET /stats?configId={id}&from={YYYY-MM-DD}&to={YYYY-MM-DD}
```
```json
{ "range": { "from": "2026-07-01", "to": "2026-07-08" },
  "totals": { "poiViews": 12043, "outboundClicks": 3120, "phoneClicks": 210,
              "emailClicks": 45, "searches": 5401, "mapSessions": 8800 } }
```

Pour l'analytics **par POI keyée sur les IDs de l'hôte**, utiliser les **events** SDK (portent l'`id` hôte).

### 4.4 Codes d'erreur

```json
{ "error": { "code": "quota_exceeded", "message": "Daily quota reached", "retryAfter": 3600 } }
```

| HTTP | `code` |
|---|---|
| 400 | `query_too_short`, `invalid_params` |
| 401 | `invalid_key` |
| 403 | `origin_not_allowed`, `forbidden_config`, `invalid_signature` |
| 413 | `dimensions_too_large` |
| 429 | `quota_exceeded` |
| 5xx | `internal_error`, `upstream_unavailable` |

**Codes d'`error` runtime SDK** (event `error`) : `invalid_key`, `origin_not_allowed`, `forbidden_config`, `config_load_failed`, `bridge_timeout`, `render_failed`.

---

## 5. Versioning & cycle de vie

- **SDK npm** : SemVer. `createLaTraceExplore` cible la `1.0`. Breaking (API JS / schéma) → **major** ; ajout rétrocompatible → **minor**.
- **REST** : versionné par préfixe de chemin ; une nouvelle version coexiste avec la précédente avant son retrait.
- **Types** : le `.d.ts` publié est le contrat exécutable du SDK JS ; divergence spec/type → le type gagne.
- **Dépréciation** : `@deprecated` dans les types + `CHANGELOG.md`, maintenu ≥ 1 minor avant retrait (major).

---

## 6. Intégration de référence — Le Fooding

```ts
import { createLaTraceExplore } from '@la-trace/map-sdk'
import '@la-trace/map-sdk/style.css'

const explore = createLaTraceExplore({
  container: '#map',
  apiKey: 'pk_live_fooding_xxx',
  configId: '9c2f98f1-394a-41d9-a7ba-99de654b7e6d',
  locale: 'fr',
  initialFavorites: await myFooding.getFavoriteIds(),
  config: {
    poiDetailMode: 'externalPreview',
    theme: { '--lt-action-primary-surface-default': '#FFDD33', '--radius-md': '0' },
    fonts: { headings: { family: 'DIN 1451', url: 'https://cdn.lefooding.com/din-1451.woff2' } },
    poiColors: {
      restaurant: { background: '#FFF3B0', text: '#FFDD33' },
      wineshop:   { background: '#E7DCEE', text: '#774192' },
    },
    poiExclusionRadiusPx: 28,              // annuaire dense : plus de marqueurs affichés
    showNativePoiTypeFilter: true,          // chip catégorie natif (PoiType du corpus)
    categoryLabels: { restaurant: 'Restaurants', wineshop: 'Caves' },
    filters: [
      { key: 'category', label: "Type d'adresse", type: 'category', options: [
        { value: 'restaurant', label: 'Restaurants', color: '#FFDD33' },
        { value: 'lodging', label: 'Chambres' },
        { value: 'bar', label: 'Bars' },
        { value: 'grocery', label: 'Commerces' },
        { value: 'wineshop', label: 'Caves', color: '#774192' },
      ] },
      { key: 'terrasse', label: 'Terrasse', type: 'toggle', group: 'essentials' },
      { key: 'budget', label: 'Budget', type: 'checkbox', group: 'price', options: [
        { value: '0-30', label: 'Moins de 30€' }, { value: '30-50', label: '30 à 50€' } ] },
    ],
    search: { placeholder: 'OÙ ALLEZ-VOUS ?', geocoding: true, recentSearches: true },
    favorites: { mode: 'host' },
    units: 'metric',
  },
})

await explore.ready()

// 1. Push du corpus (avec gestion des rejets)
explore.setLoading(true)
const { rejected } = explore.setPois(await fetchFoodingPois())
if (rejected.length) console.warn('POIs rejetés', rejected)
explore.setLoading(false)

// 2. Clic POI -> leur page éditoriale
explore.on('external:open', ({ url }) => { window.location.href = url })

// 3. Réservation -> TheFork
explore.on('reservation:click', ({ url }) => window.open(url, '_blank'))

// 4. Favori -> Mon Fooding
explore.on('favorite:toggle', ({ poiId, favorited }) => myFooding.setFavorite(poiId, favorited))

// 5. Analytics hôte (IDs Fooding)
explore.on('poi:view', ({ poiId }) => foodingAnalytics.track('poi_view', { poiId }))

// 6. Synchro d'URL hôte (deep-link / partage / back)
explore.on('state:change', (s) => history.replaceState(null, '', toFoodingUrl(s)))
explore.on('back', () => explore.closePanel())

// 7. Bascule de langue -> re-pousser le corpus traduit si contenu mono-langue
explore.on('locale:change', async ({ locale }) => explore.setPois(await fetchFoodingPois(undefined, locale)))

// 8. « Rechercher dans cette zone » (push par zone)
explore.on('search:area', async ({ bbox }) => explore.setPois(await fetchFoodingPois(bbox)))
```

**Géocodage (barre de recherche du site Fooding, hors iframe)** — via le helper, pas de fetch à la main :
```ts
import { createLaTraceGeocoder } from '@la-trace/map-sdk'
const geocoder = createLaTraceGeocoder({ apiKey: 'pk_live_fooding_xxx', apiBase: 'https://preprod.routinglatrace.com', countries: 'fr,be' })
const predictions = await geocoder.autocomplete('canal saint martin')
const { center, viewport } = await geocoder.geocode({ predictionId: predictions[0].id })
```

**Static map (fiche article, hors carte)** — URL signée sur le backend Fooding via le helper `@la-trace/map-sdk/static-map` :
```ts
// backend Fooding (Node) — le signingSecret ne quitte jamais le serveur
import { signStaticMapUrl } from '@la-trace/map-sdk/static-map'

const src = signStaticMapUrl(process.env.LATRACE_SIGNING_SECRET, {
  baseUrl: 'https://preprod.routinglatrace.com/static-map',
  configId: '9c2f98f1-...',
  key: process.env.LATRACE_PUBLISHABLE_KEY,   // pk_live_fooding_xxx (clé publiable)
  center: [2.3611, 48.8674], zoom: 15,
  width: 640, height: 360,
  markers: '2.3611,48.8674,restaurant', scale: 2,
  expiresInSeconds: 3600,
})
// -> <img src="https://preprod.routinglatrace.com/static-map?configId=...&sig=...&exp=..." />
```

**iOS (V2)** : même code JS en `WKWebView`, géoloc native → `explore.setUserLocation({ lng, lat })`.

---

## Annexe A — Résumé des events

| Event | Payload | Usage |
|---|---|---|
| `ready` | `{}` | Init terminée |
| `error` | `{ code, message }` | Auth / réseau / config / rendu |
| `pin:click` | `{ poi }` | Marqueur cliqué |
| `pin:hover` | `{ poiId \| null }` | Survol carte (entrée/sortie) |
| `poi:view` | `{ poiId }` | Panneau/preview affiché |
| `gallery:open` | `{ poiId }` | Galerie ouverte |
| `pois:rejected` | `{ rejected[] }` | POIs invalides au push |
| `preview:open` | `{ poiId }` | Preview externalPreview ouverte |
| `preview:close` | `{ poiId, navigated }` | Preview fermée (dismiss vs navigation) |
| `external:open` | `{ poiId, url }` | Naviguer vers page externe |
| `reservation:click` | `{ poiId, url }` | CTA réservation |
| `search:query` | `{ query }` | Frappe débouncée |
| `search:submit` | `{ query, resultCount }` | Recherche validée |
| `search:area` | `{ bbox }` | « Rechercher dans cette zone » |
| `results:empty` | `{ context }` | Aucun résultat |
| `filter:change` | `{ filters }` | Filtres actifs changés |
| `viewport:change` | `Viewport` | Fin pan/zoom |
| `basemap:change` | `{ basemap }` | Fond changé |
| `geolocate` | `{ coords }` | « Ma position » |
| `state:change` | `ExploreState` | Mutation d'état (synchro URL hôte) |
| `back` | `{}` | Retour déclenché dans l'iframe |
| `favorite:toggle` | `{ poiId, favorited }` | Persistance favori hôte |
| `locale:change` | `{ locale }` | Bascule de langue |

