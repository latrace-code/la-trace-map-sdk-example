// Exemple d'integration du SDK carto La Trace.
//
// 1. On instancie la carte embarquee /explore via `createLaTraceExplore`.
// 2. On lui POUSSE nos POIs (au format `Poi`, cf. apiToPoi.js). Zero stockage cote La Trace.
// 3. On ecoute les evenements du pont (clic POI, "rechercher dans cette zone"...).
// 4. (Optionnel) `createLaTraceGeocoder` alimente une barre de recherche cote hote.
//
// Le SDK est consomme via npm (`@la-trace/map-sdk`) exactement comme dans votre app.
import { createLaTraceExplore, createLaTraceGeocoder } from '@la-trace/map-sdk';
import '@la-trace/map-sdk/style.css';
import { apiToPoi } from './apiToPoi.js';

// Config injectee par le serveur depuis l'environnement (voir server.mjs + .env.example).
const cfg = window.LATRACE_CONFIG || {};

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
      // Couleur du marqueur par categorie de marque (cf. apiToPoi.js -> category).
      poiColors: {
        restaurant: { background: '#FFF3B0', text: '#C79A00' },
        bar: { background: '#FBE0E1', text: '#E5484D' },
        lodging: { background: '#DDEEF9', text: '#3B9BD6' },
        grocery: { background: '#FBE7D3', text: '#E8720C' },
        wineshop: { background: '#E7DCEE', text: '#774192' },
      },
      // Libelles des categories (titres de section + chips de filtre).
      categoryLabels: {
        restaurant: 'Restaurants', bar: 'Bars', lodging: 'Hotels',
        grocery: 'Commerces', wineshop: 'Caves',
      },
    },
  });

  // On attend que la carte soit prete avant de pousser les POIs.
  await explore.ready();

  // On charge nos donnees (ici un fichier ; chez vous : un appel a votre API) et on
  // les pousse au format `Poi`. `setPois` renvoie les eventuels POIs rejetes (invalides).
  const records = await fetch('/data/sample-pois.json').then((r) => r.json());
  const { rejected } = explore.setPois(records.map(apiToPoi));
  if (rejected?.length) console.warn('POIs rejetes :', rejected);

  // Clic sur un POI (mode externalPreview) -> on ouvre la page de l'hote.
  explore.on('external:open', ({ poiId }) => {
    const rec = records.find((r) => String(r.id) === String(poiId));
    if (rec?.url) window.open(rec.url, '_blank');
  });

  // "Rechercher dans cette zone" : le SEUL declencheur d'un nouveau lot de POIs.
  // Chez vous : re-interroger votre API sur la bbox puis re-pousser via explore.setPois(...).
  explore.on('search:area', ({ bbox }) => {
    console.log('search:area (bbox a re-interroger cote hote) :', bbox);
  });

  window.__explore = explore; // pratique pour tester dans la console
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
