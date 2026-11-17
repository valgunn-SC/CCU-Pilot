# CCU Pilot V0 — guide d’installation et d’utilisation

## 1. Démarrage immédiat sur PC

### Mode simple

1. Décompresser `CCU-Pilot-V0.zip`.
2. Ouvrir `index.html` avec Chrome ou Edge.
3. L’application fonctionne immédiatement en local : inventaire, génération, réservation des CCU, sauvegarde et export JSON.

Le mode fichier ne permet pas l’installation PWA ni la synchronisation Google. Pour ces fonctions, utiliser le mode hébergé ci-dessous.

### Mode serveur local

Si Python est installé :

1. Exécuter `start-pc.bat` sous Windows.
2. Ouvrir `http://localhost:8080`.
3. Dans Chrome, utiliser l’icône **Installer** dans la barre d’adresse.

Les données sont conservées dans le stockage local du navigateur. Ne pas vider les données du site sans avoir exporté une sauvegarde JSON.

## 2. Installation PC + Android et synchronisation Google

La V0 est une PWA. La même application web s’installe dans Chrome sur Windows et Android. La synchronisation utilise Firebase/Firestore avec connexion Google uniquement ; elle ne lit pas les cookies RSI et n’utilise pas l’API interne de synchronisation de Chrome.

### Préparer Firebase

1. Créer un projet sur <https://console.firebase.google.com/>.
2. Ajouter une **application Web**.
3. Dans **Authentication > Sign-in method**, activer uniquement **Google**.
4. Créer une base **Cloud Firestore**.
5. Copier les valeurs de `firebaseConfig` dans `firebase-config.js`.
6. Installer Node.js, puis exécuter :

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy
```

Le fichier `firestore.rules` limite les lectures et écritures au propriétaire connecté par Google. Ne pas remplacer ces règles par un accès public.

### Installer sur PC

1. Ouvrir l’URL Firebase Hosting dans Chrome.
2. Cliquer sur **Installer CCU Pilot** dans la barre d’adresse ou sur le bouton **Installer** de l’application.
3. Cliquer sur **Connexion Google**.

### Installer sur Android

1. Ouvrir la même URL dans Chrome avec le même compte Google.
2. Menu Chrome > **Ajouter à l’écran d’accueil** ou **Installer l’application**.
3. Ouvrir CCU Pilot, puis cliquer sur **Connexion Google**.
4. Charger la sauvegarde distante si elle est plus récente.

## 3. Première utilisation

La V0 contient l’inventaire extrait de `Optimisation_chaines_CCU.xlsx` :

- 12 tokens ;
- 15 CCU, dont un CCU incomplet conservé comme « à identifier » ;
- aucune chaîne pré-enregistrée ;
- Store Credit initial : 275 $ ;
- TVA initiale : 20 %.

Les anciennes affectations du classeur ne sont volontairement pas reprises. Tous les CCU valides commencent disponibles.

## 4. Générer une chaîne

1. Ouvrir **Générateur**.
2. Choisir le token de base.
3. Saisir le vaisseau cible, sa valeur actuelle TTC et sa valeur estimée.
4. Si la dernière étape est un Warbond, activer **CCU Warbond final**, puis renseigner :
   - le vaisseau de départ ;
   - sa valeur ;
   - le coût en argent frais TTC.
5. Cliquer sur **Générer la meilleure route**.
6. Contrôler la prévisualisation.
7. Cliquer sur **Enregistrer et réserver les CCU**.

Le moteur maximise la valeur couverte par les CCU possédés compatibles. Les trous standards sont comptés en Store Credit. Un Warbond final est compté en argent frais. Les deux budgets ne sont jamais fusionnés.

Tant que la prévisualisation n’est pas enregistrée, aucun CCU n’est réservé. Après enregistrement, le token et chaque CCU sélectionné deviennent indisponibles pour les autres chaînes. La suppression de la chaîne les libère.

## 5. Tokens non meltables

Dans **Tokens**, les types disponibles sont :

- Standard ;
- Gift CIG ;
- Referral Reward.

Un Gift CIG ou Referral Reward est automatiquement marqué non meltable. Toute chaîne construite sur ce token affiche une alerte non meltable pour l’ensemble de la chaîne.

## 6. CCU spéculatifs et historique Warbond

1. Ouvrir **Spéculation**.
2. Consulter l’historique sur Citizens’ Hub avec le bouton prévu.
3. Ajouter les observations vérifiées : date, prix catalogue et prix Warbond.
4. Dans **CCU**, cliquer sur **Modifier** pour renseigner la valeur estimée, le caractère spéculatif et le niveau de risque.

La V0 ne récupère pas automatiquement Citizens’ Hub. L’historique reste manuel et vérifiable. Les valeurs estimées sont affichées séparément des valeurs actuelles.

## 7. Importer l’Excel

Dans **Réglages > Import / export** :

1. Cliquer sur **Importer Optimisation_chaines_CCU.xlsx**.
2. Choisir le classeur.
3. Confirmer.

L’import lit `Flotte_Tokens` et `Inventaire_CCU`. Il remplace tokens et CCU, puis efface les chaînes existantes afin d’éviter des réservations incohérentes. Exporter auparavant une sauvegarde JSON si nécessaire.

## 8. Sauvegarde et restauration

- **Exporter la sauvegarde JSON** : export complet des réglages, tokens, CCU, chaînes et historiques.
- **Importer JSON** : restauration complète.
- **Exporter cette chaîne** : export d’une chaîne seule pour archivage.
- La sauvegarde locale est automatique après chaque modification.

## 9. Limites assumées de la V0

- Pas de connexion automatique au compte RSI.
- Pas de récupération automatique des prix ou Warbonds de Citizens’ Hub.
- La synchronisation Google nécessite la configuration Firebase du propriétaire.
- Les données de paiement historiques de l’Excel ne distinguent pas leur origine Store Credit/argent frais ; elles restent dans une catégorie historique séparée. Les montants restant à investir sont, eux, strictement séparés.
- Le moteur optimise les CCU disponibles selon les valeurs saisies ; il ne garantit pas la disponibilité future d’un CCU ou d’un Warbond RSI.
