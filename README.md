# Exemple d'integration - SDK carto La Trace

Exemple minimal et executable du SDK `@la-trace/map-sdk` : une carte interactive
embarquee (le vrai `/explore` La Trace), une barre de recherche de lieu (geocodage),
et la generation d'une carte statique signee cote serveur.

Le SDK est **zero-stockage** : vous poussez vos POIs a la carte, rien n'est stocke
cote La Trace.

## Demarrage

```bash
cp .env.example .env      # renseigner les valeurs de demo (fournies par e-mail)
npm install               # @la-trace/map-sdk + maplibre-gl + esbuild
npm start                 # build + serveur -> http://localhost:8080
```

Node >= 20. `npm start` bundle `src/main.js` (esbuild) puis lance `server.mjs`.

## Ce que montre l'exemple

| Fichier | Role |
|---|---|
| `src/main.js` | Init de la carte (`createLaTraceExplore`), push des POIs, ecoute des evenements, barre de recherche (`createLaTraceGeocoder`), vignette cliquable (`buildNavigationUrl`). |
| `src/apiToPoi.js` | **Le seul point a adapter chez vous** : mapper un enregistrement de votre API vers le format `Poi` du SDK. |
| `server.mjs` | Injecte la config au front (`/config.js`) et **signe** l'URL de carte statique (`/latrace/static-map`) - le secret ne quitte jamais le serveur. |
| `public/data/sample-pois.json` | Jeu de donnees d'exemple (a remplacer par votre API). |

## Les 3 briques

1. **Carte embarquee** : `createLaTraceExplore({ container, apiKey, configId, config })`,
   puis `await explore.ready()` et `explore.setPois(mesPois.map(apiToPoi))`.
   Le clic sur un POI, le "rechercher dans cette zone", etc. arrivent via `explore.on(...)`.

2. **Geocodage / autocomplete** (barre de recherche cote hote) :
   `createLaTraceGeocoder({ apiKey, apiBase }).autocomplete(texte)` puis `.geocode({ predictionId })`.
   Par defaut l'API ne propose que des **lieux et des adresses** (communes, arrondissements,
   voies, numeros), jamais un hotel ou un commerce ; `types: [..., 'landmark']` ajoute les
   reperes (canal, gare, parc), `'poi'` les etablissements. Chaque prediction porte un `type` :
   une **zone** (`city`, `district`, `region`) se cherche dans son `viewport`, un **point**
   (`address`) autour de son `center`. Voir le gestionnaire de clic dans `src/main.js`.

3. **Carte statique** (vignette hors carte, ex. fiche article) : l'URL doit etre
   **signee cote serveur** (un `<img>` ne porte pas de header d'auth). Voir
   `serveStaticMap` dans `server.mjs`, equivalent du helper
   `@la-trace/map-sdk/static-map`. La vignette etant une image, `buildNavigationUrl(poi)`
   l'enveloppe dans un lien qui lance la navigation Google Maps (URLs publiques :
   ni cle, ni quota, ni facturation). Voir `renderThumbnail` dans `src/main.js`.

## Personnaliser les marqueurs

- `config.poiColors` : couleur du marqueur, keyee par **categorie hote** (`Poi.category`).
  Source unique : la vignette statique relit la meme table (`markers=lng,lat,type,corps-disque`).
- `config.poiIcons` : remplace le glyphe par **votre logo**, keye par `PoiType` (`Winegrower`)
  **ou** categorie hote (`wineshop`) - **la casse tranche**. Valeurs acceptees : URL `https`
  ou data URI `data:image/svg+xml`.
  **Pour avoir ce logo aussi sur la vignette statique**, il faut une URL `https` : la carte
  rend le data URI dans le navigateur, la vignette est composee par le serveur qui ne sait
  que fetcher une URL. Passez-la en 5e champ de `markers` (`lng,lat,type,corps-disque,icon`),
  cf. `POI_ICONS` / `renderThumbnail` dans `src/main.js`. Sans elle, la vignette retombe sur
  le glyphe La Trace du `type` alors que la carte porte votre logo.
- `config.wording` : `poiNounSingle` / `poiNounPlural` renomment les POIs dans le compteur
  de resultats.

## Format `Poi` et contrat complet

Le format exact d'un POI pousse (champs requis / optionnels, categories, filtres,
evenements du pont, endpoints REST) est decrit dans le **contrat d'API**, qui fait foi.

Ce depot n'en embarque **volontairement pas de copie** : une copie diverge de la version
courante et vous mettrait sur une fausse piste. Le contrat SDK et le contrat REST
interactif (testable en direct) sont publies en ligne ; les liens vous sont fournis avec
les identifiants de demo, par e-mail. La version du SDK epinglee dans `package.json` vous
dit a quelle revision du contrat cet exemple se refere.

## Environnement

Tout tourne en **preprod** pendant l'integration. L'URL de production, les domaines
autorises et les quotas de la cle vous seront communiques a la mise en service.
