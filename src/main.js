// Exemple d'integration du SDK carto La Trace.
//
// 1. On instancie la carte embarquee /explore via `createLaTraceExplore`.
// 2. On lui POUSSE nos POIs (au format `Poi`, cf. apiToPoi.js). Zero stockage cote La Trace.
// 3. On ecoute les evenements du pont (clic POI, "rechercher dans cette zone"...).
// 4. (Optionnel) `createLaTraceGeocoder` alimente une barre de recherche cote hote.
// 5. (Optionnel) `buildNavigationUrl` rend une vignette statique cliquable.
//
// Le SDK est consomme via npm (`@la-trace/map-sdk`) exactement comme dans votre app.
import { createLaTraceExplore, createLaTraceGeocoder, buildNavigationUrl } from '@la-trace/map-sdk';
import '@la-trace/map-sdk/style.css';
import { apiToPoi } from './apiToPoi.js';

// Config injectee par le serveur depuis l'environnement (voir server.mjs + .env.example).
const cfg = window.LATRACE_CONFIG || {};

// Couleur du marqueur par categorie de marque (cf. apiToPoi.js -> category).
// Source UNIQUE de la couleur : la carte ET la vignette statique lisent cette table.
const POI_COLORS = {
  restaurant: { background: '#FFF3B0', text: '#C79A00' },
  bar: { background: '#FBE0E1', text: '#E5484D' },
  lodging: { background: '#DDEEF9', text: '#3B9BD6' },
  grocery: { background: '#FBE7D3', text: '#E8720C' },
  wineshop: { background: '#E7DCEE', text: '#774192' },
};

// Logo de marqueur custom. Les valeurs acceptees sont une URL `https` (SVG ou PNG)
// ou un data URI **SVG** ; un `data:image/png` ou un `http://` sont rejetes en silence
// (le marqueur retombe alors sur le glyphe La Trace). En local, une URL http:// serait
// donc refusee : d'ou le data URI ici. Chez vous : une URL https vers votre CDN.
const WINE_GLASS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#101214"' +
  ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 3h8l-.7 6.2a3.4 3.4 0 0 1-6.6 0L8 3Z"/><path d="M12 13v6"/><path d="M9 21h6"/></svg>';

// Table unique des logos, relue par la carte ET par la vignette statique. Mettez-y des
// URL `https` si vous voulez le logo AUSSI sur la vignette : le data URI ci-dessus ne
// vit que cote carte (cf. renderThumbnail).
const POI_ICONS = {
  // wineshop: 'https://cdn.exemple.com/pictos/cave.svg',
};

async function main() {
  const explore = createLaTraceExplore({
    container: '#map',
    apiKey: cfg.apiKey,               // cle publiable pk_test_* / pk_live_*
    configId: cfg.configId,           // id de config (theming + entitlement)
    exploreBaseUrl: cfg.exploreBaseUrl,
    locale: 'fr',                     // fr | en | nl
    config: {
      // 'externalPreview' : clic sur un POI -> preview compacte qui renvoie vers VOTRE page.
      // 'panel' : fiche riche complete affichee DANS la carte La Trace.
      poiDetailMode: 'externalPreview',
      poiColors: POI_COLORS,
      // Libelles des categories (titres de section + chips de filtre).
      categoryLabels: {
        restaurant: 'Restaurants', bar: 'Bars', lodging: 'Hotels',
        grocery: 'Commerces', wineshop: 'Caves',
      },
      // Remplace le glyphe La Trace au centre du marqueur par VOTRE logo. La forme et
      // la couleur du marqueur restent pilotees par poiColors.
      // LA CASSE TRANCHE : une cle qui matche exactement un PoiType canonique
      // ('Winegrower') est une cle de TYPE ; toute autre cle ('wineshop') est une
      // categorie hote. Precedence : poiType > category > glyphe La Trace.
      poiIcons: {
        wineshop: 'data:image/svg+xml,' + encodeURIComponent(WINE_GLASS_SVG),
      },
      // Nom des POIs dans le compteur de resultats. La carte choisit seule le singulier
      // ou le pluriel selon le total (le pluriel s'applique a partir de 2 : "0 Resultat").
      wording: { poiNounSingle: 'Résultat', poiNounPlural: 'Résultats' },
    },
  });

  // On attend que la carte soit prete avant de pousser les POIs.
  await explore.ready();

  // On charge nos donnees (ici un fichier ; chez vous : un appel a votre API) et on
  // les pousse au format `Poi`. `setPois` renvoie les eventuels POIs rejetes (invalides).
  const records = await fetch('/data/sample-pois.json').then((r) => r.json());
  const pois = records.map(apiToPoi);
  const { rejected } = explore.setPois(pois);
  if (rejected?.length) console.warn('POIs rejetes :', rejected);

  renderThumbnail(pois[0]);

  // Clic sur un POI (mode externalPreview) -> on ouvre la page de l'hote. L'event porte
  // deja l'`externalUrl` du POI : pas besoin de rechercher l'enregistrement d'origine.
  explore.on('external:open', ({ url }) => {
    if (url) window.open(url, '_blank', 'noopener');
  });

  // "Rechercher dans cette zone" : le SEUL declencheur d'un nouveau lot de POIs.
  // Chez vous : re-interroger votre API sur la bbox puis re-pousser via explore.setPois(...).
  explore.on('search:area', ({ bbox }) => {
    console.log('search:area (bbox a re-interroger cote hote) :', bbox);
  });

  window.__explore = explore; // pratique pour tester dans la console
}

// Vignette editoriale hors carte (ex. fiche article) : une carte statique est une IMAGE,
// donc l'URL est signee cote serveur (voir server.mjs). `buildNavigationUrl` l'enveloppe
// dans un lien qui lance la navigation Google Maps. Ce sont des URLs publiques Google
// Maps : ni cle, ni quota, ni facturation. Le helper est pur (aucun fetch) et fait la
// bascule [lng, lat] -> destination=lat,lng que Google attend : c'est le piege qu'il evite.
function renderThumbnail(poi) {
  // L'hexa se passe nu dans `markers` : le '#' devrait sinon etre encode en %23.
  const hex = (color) => String(color).replace('#', '');

  const link = document.querySelector('#thumb-link');
  const img = document.querySelector('#thumb-img');
  if (!poi || !link || !img) return;

  const [lng, lat] = poi.coords;
  const palette = POI_COLORS[poi.category];
  // Parite carte / vignette : on renvoie la MEME paire que poiColors, dans cet ordre.
  // `text` peint le corps de la goutte, `background` le disque sous le glyphe. Une
  // couleur seule peindrait la goutte et laisserait le disque a la couleur du type.
  const color = palette ? `${hex(palette.text)}-${hex(palette.background)}` : '';
  // `markers` est positionnel : lng,lat[,type[,color[,icon]]]. La carte colore par
  // categorie hote, la vignette prend un PoiType : le pont est a la charge de l'hote.
  //
  // 5e champ `icon` : votre logo, pour que la vignette porte le MEME marqueur que la
  // carte. ATTENTION, la contrainte n'est pas la meme des deux cotes : la carte accepte
  // un data URI SVG (rendu dans le navigateur), la vignette est composee par le serveur
  // qui ne sait que FETCHER une URL -> `https` uniquement. Un data URI est donc filtre
  // ici, sinon il partirait dans l'URL pour rien (et un ';' y casserait le decoupage).
  const iconUrl = POI_ICONS[poi.category] || '';
  const icon = iconUrl.startsWith('https://') && !iconUrl.includes(';') ? iconUrl : '';
  const markers = [lng, lat, poi.poiType || '', color, icon]
    .join(',')
    .replace(/,+$/, '');

  const params = new URLSearchParams({
    center: `${lng},${lat}`, zoom: '15', width: '560', height: '320', markers,
  });
  img.src = `/latrace/static-map?${params}`;
  img.alt = `Carte - ${poi.name}`;
  link.href = buildNavigationUrl(poi);
}

// Barre de recherche de lieu cote hote (hors iframe), optionnelle : le helper porte le
// fetch /geocode, le cache de predictions et la normalisation de bbox.
if (cfg.apiBase) {
  const geocoder = createLaTraceGeocoder({ apiKey: cfg.apiKey, apiBase: cfg.apiBase, countries: 'fr,be' });
  const input = document.querySelector('#search');
  const list = document.querySelector('#suggestions');
  let predictions = [];
  input?.addEventListener('input', async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.innerHTML = ''; return; }
    predictions = await geocoder.autocomplete(q);
    list.innerHTML = predictions.map((p, i) => `<li data-i="${i}">${p.label}</li>`).join('');
  });
  list?.addEventListener('click', async (e) => {
    const i = e.target?.dataset?.i;
    if (i == null) return;
    const { center } = await geocoder.geocode({ predictionId: predictions[i].id });
    window.__explore?.flyTo?.({ center: [center.lng, center.lat], zoom: 13 });
    list.innerHTML = '';
    input.value = predictions[i].label;
  });
}

main().catch((e) => console.error('Init carte KO :', e));
