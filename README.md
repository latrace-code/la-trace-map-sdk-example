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
| `src/main.js` | Init de la carte (`createLaTraceExplore`), push des POIs, ecoute des evenements, barre de recherche (`createLaTraceGeocoder`). |
| `src/apiToPoi.js` | **Le seul point a adapter chez vous** : mapper un enregistrement de votre API vers le format `Poi` du SDK. |
| `server.mjs` | Injecte la config au front (`/config.js`) et **signe** l'URL de carte statique (`/latrace/static-map`) - le secret ne quitte jamais le serveur. |
| `public/data/sample-pois.json` | Jeu de donnees d'exemple (a remplacer par votre API). |

## Les 3 briques

1. **Carte embarquee** : `createLaTraceExplore({ container, apiKey, configId, config })`,
   puis `await explore.ready()` et `explore.setPois(mesPois.map(apiToPoi))`.
   Le clic sur un POI, le "rechercher dans cette zone", etc. arrivent via `explore.on(...)`.

2. **Geocodage / autocomplete** (barre de recherche cote hote) :
   `createLaTraceGeocoder({ apiKey, apiBase }).autocomplete(texte)` puis `.geocode({ predictionId })`.

3. **Carte statique** (vignette hors carte, ex. fiche article) : l'URL doit etre
   **signee cote serveur** (un `<img>` ne porte pas de header d'auth). Voir
   `serveStaticMap` dans `server.mjs`, equivalent du helper
   `@la-trace/map-sdk/static-map`.

## Format `Poi` et contrat complet

Le format exact d'un POI pousse (champs requis / optionnels, categories, filtres,
evenements du pont, endpoints REST) est decrit dans le **contrat d'API** :
[`docs/API-CONTRACT.md`](docs/API-CONTRACT.md).

Contrat REST interactif (testable en direct) et doc du SDK : liens fournis par e-mail.

## Environnement

Tout tourne en **preprod** pendant l'integration. L'URL de production, les domaines
autorises et les quotas de la cle vous seront communiques a la mise en service.
