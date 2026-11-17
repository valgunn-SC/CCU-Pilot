# CCU Pilot V0

PWA locale en français pour générer des chaînes CCU Star Citizen à partir de l’inventaire de l’utilisateur.

## Fonctions livrées

- génération dynamique, sans chaînes pré-enregistrées ;
- picking automatique dans les CCU libres ;
- verrouillage exclusif des CCU et du token à l’enregistrement ;
- suppression d’une chaîne avec libération des éléments ;
- séparation Store Credit / argent frais / coût historique ;
- montants TTC en dollars et ventilation HT/TVA ;
- valeurs actuelle et estimée ;
- propagation non meltable des Gifts CIG et Referral Rewards ;
- suivi manuel des Warbonds passés et CCU spéculatifs ;
- import direct de `Optimisation_chaines_CCU.xlsx` sans dépendance externe ;
- sauvegarde locale, import/export JSON ;
- PWA hors ligne ;
- synchronisation optionnelle Firestore avec connexion Google uniquement.

## Démarrer

- Ouverture directe : `index.html`.
- Serveur local : `start-pc.bat` puis <http://localhost:8080>.
- Tests : `node tests/core.test.js` et `node tests/xlsx-lite.test.js`.

Lire `GUIDE.md` pour l’installation PC/Android et Firebase.

## Structure

- `core.js` : moteur de génération et règles métier.
- `app.js` : interface, stockage, imports/exports et synchronisation.
- `xlsx-lite.js` : lecteur XLSX minimal pour Chrome moderne.
- `seed.js` / `initial-data.json` : inventaire initial issu de l’Excel.
- `firebase-config.js` : configuration à compléter.
- `firestore.rules` : cloisonnement par utilisateur Google.
- `service-worker.js` / `manifest.webmanifest` : installation PWA et mode hors ligne.
