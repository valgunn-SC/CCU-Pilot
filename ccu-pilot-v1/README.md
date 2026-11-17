# CCU-Pilot V1

PWA statique pour piloter une flotte et des chaînes CCU, avec :

- accès réservé à une adresse Google ;
- synchronisation Firestore isolée par UID et règles de sécurité ;
- copie locale et mode hors ligne ;
- actualisation automatique des prix et disponibilités indicatives ;
- flotte affichée directement sous le tableau de bord ;
- inventaire de tokens et CCU ;
- réservation exclusive des éléments par chaîne ;
- séparation argent frais / Store Credit / historique ;
- TVA calculée à partir du TTC ;
- alerte de chaîne non meltable pour Gifts CIG et Referral Rewards ;
- import/export JSON.

## Démarrage

1. Lire `GUIDE.md`.
2. Configurer `firebase-config.js`.
3. Publier `firestore.rules` dans Firebase Console.
4. Envoyer les fichiers dans le sous-dossier GitHub Pages choisi.

## Tests

Avec Node.js 20 ou plus récent :

```bash
npm test
```

## Source des données publiques

CCU-Pilot utilise l’API communautaire Star Citizen Wiki pour les informations publiques de catalogue. La disponibilité est indicative. Toujours vérifier le Pledge Store RSI avant une décision d’achat.

## Licence et indépendance

Cette version est une implémentation indépendante. Elle ne contient pas de code Citizens’ Hub et n’appelle pas son backend privé. Citizens’ Hub est distribué sous Elastic License 2.0 ; ses restrictions de service hébergé ne sont donc pas importées dans CCU-Pilot.
