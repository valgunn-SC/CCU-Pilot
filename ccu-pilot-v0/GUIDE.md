# CCU-Pilot V1 — Guide de mise en place

Ce dossier est prêt à être publié tel quel dans `CCU-Pilot/ccu-pilot-v1/` ou à remplacer le contenu de `ccu-pilot-v0/`.

## 1. Ce qu’il faut préparer

- ton adresse Google exacte ;
- un projet Firebase gratuit ;
- l’accès administrateur au dépôt GitHub `valgunn-SC/CCU-Pilot` ;
- recommandé : un export JSON de la V0 avant remplacement.

Aucune clé RSI et aucun mot de passe RSI ne sont nécessaires.

## 2. Créer le projet Firebase

1. Ouvre <https://console.firebase.google.com/>.
2. Clique sur **Ajouter un projet**.
3. Laisse Google Analytics désactivé si tu n’en as pas besoin.
4. Dans **Paramètres du projet > Général > Vos applications**, ajoute une application **Web**.
5. Nomme-la `CCU-Pilot`.
6. Copie l’objet `firebaseConfig` affiché.

### Renseigner la configuration

Ouvre `firebase-config.js` et remplace toutes les valeurs `REMPLACER_...` :

```js
window.CCU_PILOT_FIREBASE = {
  ownerEmail: "ton.adresse@gmail.com",
  firebaseConfig: {
    apiKey: "...",
    authDomain: "ton-projet.firebaseapp.com",
    projectId: "ton-projet",
    storageBucket: "ton-projet.firebasestorage.app",
    messagingSenderId: "...",
    appId: "..."
  }
};
```

La clé `apiKey` d’une application Firebase Web n’est pas une clé privée. Ne mets en revanche **jamais** de compte de service, clé privée ou secret serveur dans GitHub.

## 3. Activer uniquement la connexion Google

1. Firebase Console > **Authentication** > **Commencer**.
2. Onglet **Sign-in method**.
3. Active **Google**.
4. Indique ton adresse comme adresse d’assistance du projet.
5. Dans **Authentication > Settings > Authorized domains**, vérifie ou ajoute :
   - `valgunn-sc.github.io`
   - ton futur domaine personnalisé, sans `https://`, si tu l’utilises plus tard.
6. Ne laisse pas d’autre méthode de connexion active si tu n’en as pas besoin.

L’application effectue un second contrôle : l’adresse Google connectée doit être strictement celle déclarée dans `ownerEmail`.

## 4. Créer Firestore et verrouiller les données

1. Firebase Console > **Firestore Database** > **Créer une base de données**.
2. Choisis le mode **Production**.
3. Choisis de préférence une région européenne proche.
4. Ouvre `firestore.rules`.
5. Remplace `REMPLACER_PAR_TON_ADRESSE_GOOGLE_EN_MINUSCULES` par ton adresse Google exacte en minuscules.
6. Dans Firebase Console > Firestore > **Règles**, remplace tout par le contenu de `firestore.rules`.
7. Clique sur **Publier**.

Les règles livrées imposent simultanément :

- une session Google valide ;
- une adresse vérifiée égale à l’adresse propriétaire ;
- un chemin Firestore dont l’UID est celui de la session ;
- un refus global de tous les autres documents.

### Test de sécurité recommandé

1. Connecte-toi à CCU-Pilot avec le compte propriétaire : l’application doit s’ouvrir.
2. Ouvre une fenêtre privée et connecte un autre compte Google : l’application doit afficher **Accès refusé**.
3. Dans l’onglet Firestore, vérifie que le seul document créé est sous `users/<ton UID>/app/state`.

## 5. Publier sur GitHub Pages

### Option A — garder la V0 et ajouter la V1

1. Dans le dépôt, crée le dossier `ccu-pilot-v1`.
2. Envoie **tout le contenu** de ce dossier, y compris :
   - `index.html` ;
   - `app.js`, `core.mjs`, `styles.css` ;
   - `firebase-config.js` ;
   - `service-worker.js`, `manifest.webmanifest`, `icon.svg`.
3. Valide le commit.
4. Ouvre : `https://valgunn-sc.github.io/CCU-Pilot/ccu-pilot-v1/`.

### Option B — remplacer la V0 en gardant l’URL actuelle

1. Exporte d’abord la sauvegarde JSON depuis la V0.
2. Remplace le contenu de `ccu-pilot-v0` par les fichiers de la V1.
3. Garde exactement le nom de dossier `ccu-pilot-v0`.
4. Valide le commit.
5. Recharge `https://valgunn-sc.github.io/CCU-Pilot/ccu-pilot-v0/` avec `Ctrl + F5`.

La V1 essaie de migrer plusieurs clés `localStorage` usuelles de la V0. Comme le schéma exact de la V0 peut différer, l’export/import JSON reste la méthode sûre.

## 6. Première utilisation

1. Ouvre l’application.
2. Connecte le compte Google propriétaire.
3. Importe la sauvegarde JSON de la V0 depuis **Réglages & sauvegardes**.
4. Ouvre **Inventaire** et vérifie les noms des vaisseaux et CCU.
5. Clique sur **Actualiser prix & disponibilité**.
6. Vérifie la flotte directement sous le tableau de bord.
7. Exporte une nouvelle sauvegarde V1.

## 7. Prix et disponibilité automatiques

La V1 interroge directement, depuis le navigateur, l’endpoint public :

`https://api.star-citizen.wiki/api/shipmatrix/vehicles/{slug}`

Pour chaque nom connu dans la flotte, les CCU et les chaînes, l’application récupère notamment :

- le MSRP / prix catalogue ;
- les SKU disponibles ;
- le prix Warbond lorsqu’il est présent ;
- le statut de production ;
- la date de mise à jour de la source ;
- le lien Pledge Store lorsqu’il est fourni.

L’actualisation se lance :

- lors de l’ajout d’un vaisseau ou d’un CCU ;
- au clic sur le bouton du tableau de bord ;
- automatiquement après le délai configuré, par défaut 12 heures.

### Limites à connaître

- Il n’existe pas d’API publique officielle RSI documentée pour l’ensemble des prix et disponibilités CCU.
- La source utilisée est communautaire et agrège des données RSI ; une disponibilité peut être indicative ou retardée.
- La V1 n’appelle pas le backend privé de Citizens’ Hub et ne recopie pas son code.
- Une PWA statique GitHub Pages ne peut pas stocker une clé API serveur en sécurité.
- Vérifie toujours le Pledge Store RSI avant un achat.
- Si un nom n’est pas reconnu, utilise le nom commercial exact, par exemple `Avenger Titan` plutôt que `Aegis Titan`.

## 8. Données locales et synchronisation

- Une copie locale est conservée dans le profil du navigateur pour le mode hors ligne.
- La clé locale contient l’UID Google afin de séparer les sessions.
- La copie synchronisée se trouve dans Firestore sous le compte propriétaire.
- Les modifications sont envoyées automatiquement après environ 800 ms.
- En cas de panne réseau, la copie locale reste disponible et Firestore reprend la synchronisation au retour du réseau.

Important : toute personne ayant un accès administrateur au PC et aux outils développeur du même profil navigateur peut techniquement lire le stockage local. Utilise un profil Chrome personnel verrouillé et respecte la politique de ton PC professionnel.

## 9. Mise à jour de la PWA

Après un commit :

1. attends la fin de l’action GitHub Pages ;
2. recharge avec `Ctrl + F5` ;
3. si l’ancienne version reste affichée, ferme toutes les fenêtres de l’application installée puis vide les données du site ;
4. au besoin, change la constante `CACHE` dans `service-worker.js` avant le commit.

## 10. Ce qu’il me faut encore de ta part

Indispensable pour finaliser la mise en ligne réelle :

1. l’adresse Google exacte à autoriser ;
2. l’objet `firebaseConfig` généré par ton projet Firebase ;
3. idéalement un export JSON de la V0 pour valider la migration de toutes les données ;
4. une liste de 5 à 10 noms réels de vaisseaux/CCU qui ne seraient pas reconnus automatiquement.

Ne partage jamais de mot de passe Google, mot de passe RSI, cookie RSI ou clé privée Firebase.
