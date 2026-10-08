# Mana Orbit sur Android : guide pas à pas

Le dossier `android-app/` contient l'appli Android. C'est une coque native (Capacitor) qui ouvre https://card.m2s-photo.fr et ajoute ce qu'un navigateur ne sait pas faire :

- l'appareil photo natif pour le scan, fluide comme Snapchat ;
- plus tard : la pub AdMob, les notifications Firebase et le widget d'écran d'accueil.

Toute mise à jour du site arrive tout de suite dans l'appli. Il ne faut refaire l'appli que si la partie native change (plugins, icônes, permissions).

Les boutons d'Android Studio sont écrits **en anglais, tels qu'ils apparaissent à l'écran**, avec la traduction entre parenthèses.

---

## 1. Installer les outils (une seule fois)

1. **Node.js 22 LTS** : https://nodejs.org. Clique sur le bouton « LTS » et garde les options par défaut pendant l'installation.
2. **Git** : https://git-scm.com/download/win. Options par défaut.
3. **Android Studio** : déjà installé. Au premier lancement, accepte le téléchargement du SDK proposé par l'assistant : **Next** (suivant) puis **Finish** (terminer).

Pour vérifier, ouvre un terminal : sous Windows, tape « PowerShell » dans le menu Démarrer. Puis :

```bash
node -v        # doit afficher v22.x
git --version  # doit afficher une version
```

---

## 2. Récupérer le projet

Dans le terminal, place-toi dans le dossier de ton choix (par exemple `cd Documents`), puis :

```bash
git clone https://github.com/BeerDeus/mtgcardshop.git
cd mtgcardshop/android-app
npm run setup
npm run open
```

- `npm run setup` installe Capacitor et ses plugins, puis prépare le projet Android. Compte 1 à 2 minutes.
- `npm run open` ouvre le projet dans Android Studio.

**Variante sans terminal externe, depuis Android Studio :**
1. Sur l'écran d'accueil, clique **Clone Repository** (cloner un dépôt).
2. Dans **URL**, mets `https://github.com/BeerDeus/mtgcardshop.git`. Dans **Directory** (dossier), choisis l'emplacement, puis **Clone** (cloner).
3. Ouvre l'onglet **Terminal** en bas de la fenêtre, puis tape :
   ```bash
   cd android-app
   npm run setup
   ```
4. **File › Open…** (Fichier › Ouvrir) : choisis `mtgcardshop/android-app/android`, puis **OK**. Le projet Android est dans ce sous-dossier, pas à la racine du dépôt.

Si `npm run open` ne trouve pas Android Studio, ouvre le projet à la main :
1. Dans Android Studio : **File › Open…** (Fichier › Ouvrir).
2. Choisis le dossier `mtgcardshop/android-app/android`.
3. Clique **OK**.

Si Android Studio demande s'il doit faire confiance au projet, clique **Trust Project** (faire confiance au projet).

À la première ouverture, Android Studio lance une **Gradle Sync** (synchronisation Gradle) : une barre de progression en bas à droite. Elle télécharge ce qu'il faut et dure quelques minutes. Attends qu'elle soit finie avant la suite.

---

## 3. Essayer sur ton téléphone (Xiaomi 14)

### Sur le téléphone

1. **Paramètres › À propos du téléphone** : touche **Version de l'OS** 7 fois de suite. Le message « Vous êtes maintenant développeur » apparaît.
2. **Paramètres › Paramètres supplémentaires › Options pour les développeurs**, puis active :
   - **Débogage USB** ;
   - **Installer via USB**. Xiaomi demande de te connecter à ton compte Mi pour celle-ci.
3. Branche le téléphone en USB au PC. À la question « Autoriser le débogage USB ? », coche « Toujours autoriser » puis **OK**.

### Dans Android Studio

1. En haut de la fenêtre, dans la liste des appareils (**Device Manager**, gestionnaire d'appareils, ou la liste déroulante à côté de « app »), choisis ton Xiaomi.
2. Clique le bouton vert **Run ▶** (exécuter), ou **Run › Run 'app'**.
3. L'appli s'installe et s'ouvre sur le téléphone.

**Pour tester le scan :** Ma collection › Scanner. L'aperçu de l'appareil photo est maintenant natif. Le nom de la carte est lu sur le téléphone par ML Kit (Google), sans rien télécharger.

Dis-moi ce que tu vois. Je n'ai pas pu tester le scan natif sur un vrai téléphone : si l'aperçu est décalé ou si l'image est mal orientée, je corrige.

---

## 4. Publier sur le Play Store

### 4.1. Créer le fichier à envoyer à Google (.aab)

1. Dans Android Studio : **Build › Generate Signed App Bundle or APK…** (générer un App Bundle ou un APK signé).
2. Choisis **Android App Bundle**, puis **Next** (suivant).
3. **Key store path** (emplacement de la clé) : clique **Create new…** (créer). Ensuite :
   - choisis où enregistrer le fichier `.jks`, par exemple `mana-orbit.jks` ;
   - mets un mot de passe dans **Password** et **Confirm** (confirmer) ;
   - dans **Key** (clé) : **Alias** `mana-orbit`, un mot de passe, et **Validity (years)** (validité en années) à 25 ;
   - dans **Certificate** (certificat), remplis au moins **First and Last Name** (prénom et nom) ;
   - clique **OK**.
4. **Garde précieusement le fichier `.jks` et ses deux mots de passe** (gestionnaire de mots de passe et copie de sauvegarde). Sans eux, tu ne pourras plus jamais mettre l'appli à jour.
5. Clique **Next**, choisis **release** (version de publication), puis **Create** (créer).
6. Le fichier `app-release.aab` est créé dans `android-app/android/app/release/`. Android Studio affiche une notification avec un lien **locate** (afficher dans le dossier).

### 4.2. Play Console (play.google.com/console)

1. **Créer une application** :
   - nom « Mana Orbit » ;
   - Application (pas Jeu) ;
   - Gratuite.
2. **Fiche Play Store principale** :
   - description courte et description complète ;
   - icône 512 × 512 : `pwa/icons/icon-512.png` ;
   - image de présentation 1024 × 500 (je peux te la faire) ;
   - au moins 2 captures d'écran du téléphone.
   - Pas de « Magic: The Gathering » dans le titre. Dans la description, « pour les joueurs de Magic » suffit.
3. **Contenu de l'appli** :
   - Règles de confidentialité : `https://card.m2s-photo.fr/privacy`
   - Suppression de compte : `https://card.m2s-photo.fr/?delete-account`
   - Annonces : « Non » pour l'instant. Passe à « Oui » quand AdMob sera ajouté.
   - Sécurité des données :
     - adresse e-mail (compte, facultatif) ;
     - collection et decks (compte, facultatif) ;
     - aucune donnée partagée ;
     - chiffrement en transit ;
     - suppression possible.
   - Public cible : 13 ans et plus.
   - Classification du contenu : remplis le questionnaire (aucun contenu sensible).
4. **Tests › Tests internes** : envoie le fichier `.aab` et ajoute ton adresse e-mail comme testeur. Tu installes la version de test depuis le lien donné par Google.
5. Si ton compte développeur est un **compte personnel créé après novembre 2023**, Google impose un **test fermé avec au moins 12 testeurs pendant 14 jours** avant la mise en production. Les testeurs s'inscrivent via un lien.

**À ne publier qu'une fois l'accord d'EDHREC et d'Archidekt obtenu** (voir `docs/mails-partenaires.md`).

### 4.3. Mises à jour

- **Le site** (la plupart des changements) : un push sur `main` suffit. L'appli affiche la nouvelle version au lancement suivant.
- **La partie native** (plugins, icônes, permissions) :
  1. Dans `android-app/android/app/build.gradle`, augmente `versionCode` de 1 (par exemple 1 → 2) et change `versionName` (par exemple "1.1").
  2. Dans le terminal, depuis `android-app` : `npm run sync`.
  3. Refais un fichier `.aab` signé (étape 4.1) avec le même fichier `.jks`.
  4. Envoie-le dans la Play Console : **Créer une release** dans la piste de test ou de production.

---

## Notifications (Firebase Cloud Messaging)

Dans l'appli, les notifications « recherche terminée » et les alertes de prix passent par **Firebase Cloud Messaging** (FCM). La WebView d'Android ne reçoit pas les notifications Web Push du site. Le site, le navigateur et l'appli installée depuis le navigateur (PWA) gardent Web Push (clés VAPID), sans changement.

Le serveur envoie les notifications de l'appli avec un **compte de service** Firebase. À faire une seule fois :

1. Ouvre la **console Firebase** (console.firebase.google.com) et choisis le projet de l'appli, celui du fichier `google-services.json`.
2. Clique la roue dentée en haut à gauche, puis **Paramètres du projet**, onglet **Comptes de service**.
3. Clique **Générer une nouvelle clé privée**, puis **Générer la clé**. Un fichier `.json` est téléchargé.
4. Garde ce fichier en lieu sûr : c'est un secret. Il permet d'envoyer des notifications au nom de ton projet. Ne le mets jamais dans GitHub.
5. Sur **Hostinger**, ouvre ton site Node.js, puis **Variables d'environnement**. Ajoute `FCM_SERVICE_ACCOUNT`. Comme valeur, mets le contenu du fichier, de l'une de ces deux façons :
   - **le JSON sur une seule ligne** : ouvre le fichier dans le Bloc-notes et supprime les retours à la ligne entre les champs. Les `\n` écrits dans `private_key` restent tels quels.
   - **le JSON en base64**, plus sûr si l'interface coupe ou abîme le texte. Dans PowerShell :
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\<toi>\Downloads\<fichier>.json")) | Set-Clipboard
     ```
     Le résultat est copié : colle-le comme valeur. Sur Mac : `base64 -i fichier.json | pbcopy`.
6. Enregistre, puis redéploie ou redémarre le site.
7. Vérifie : `https://card.m2s-photo.fr/__ping` doit afficher `"fcm":true`. Sinon, le journal du serveur dit pourquoi : « Notifications de l'appli (FCM) désactivées : … ».
8. Dans l'appli : **Réglages › Notifications › Prévenir quand la recherche est finie**, et/ou **Réglages › Alertes de prix**. Android 13 et plus demande alors l'autorisation d'envoyer des notifications.

Sur un serveur à toi, tu peux plutôt donner le chemin du fichier : `FCM_SERVICE_ACCOUNT_FILE=/chemin/vers/fichier.json`.

Bon à savoir :

- Le compte de service doit venir du **même projet** que `google-services.json`. Sinon FCM refuse les jetons (SENDER_ID_MISMATCH) et l'appareil est retiré.
- L'**API Firebase Cloud Messaging (V1)** doit être active : **Paramètres du projet › Cloud Messaging**. Elle l'est d'office sur les projets récents. Si elle est marquée « Désactivée », clique **⋮ › Gérer l'API dans Google Cloud Console**, puis **Activer**.
- Toucher une notification ouvre la bonne page : la recherche reprend (« recherche terminée »), ou la feuille des alertes s'ouvre. Si l'appli est déjà ouverte, un message s'affiche en bas de l'écran avec **Voir**.
- L'appli redemande son jeton FCM à chaque lancement. S'il a changé, les alertes repartent avec le nouveau et l'ancien est effacé du serveur.
- Un jeton refusé par FCM (appli désinstallée, données effacées) est retiré du serveur, comme un abonnement Web Push expiré.
- Si les notifications ont été refusées sur le téléphone : **Paramètres › Applications › Mana Orbit › Notifications**.
- Aucune dépendance côté serveur : `proxy.mjs` signe lui-même la demande de jeton Google (RS256) et garde ce jeton jusqu'à 5 minutes avant son expiration (1 h).

---

## 5. Prochaines étapes natives (prévues)

| Fonction | Plugin | Remarque |
| --- | --- | --- |
| Scan natif | `@capacitor-community/camera-preview` + `@pantrist/capacitor-plugin-ml-kit-text-recognition` | installés ; le site détecte l'appli Android (`Capacitor.isNativePlatform()`) |
| Bandeau de pub | `@capacitor-community/admob` | compte AdMob + identifiant de l'appli ; consentement (UMP) en Europe |
| Notifications | `@capacitor/push-notifications` | Firebase Cloud Messaging (fichier `google-services.json` depuis la console Firebase) |
| Connexion Google | `@capacitor-firebase/authentication` | Google bloque sa fenêtre de connexion dans les applis ; e-mail et mot de passe marchent déjà |
| Widget (valeur de la collection) | code Kotlin natif | lit la valeur que l'appli lui laisse |

---

## 6. Problèmes fréquents

- **« Incompatible Gradle JVM version… Gradle 8.14.3 supports Java versions between 1.8 and 24 »** (version de Java incompatible) : Android Studio lance Gradle avec Java 25, trop récent. Pour choisir Java 21 :
  1. **File › Settings…** (Fichier › Paramètres).
  2. **Build, Execution, Deployment › Build Tools › Gradle** (Compilation › Outils de compilation › Gradle).
  3. **Gradle JDK** : choisis **jbr-21** (le Java 21 fourni avec Android Studio). S'il n'est pas dans la liste : **Download JDK…** (télécharger un JDK), version **21**, fournisseur **JetBrains Runtime** ou **Eclipse Temurin**, puis **Download**.
  4. **OK**, puis l'icône éléphant **Sync Project with Gradle Files** (synchroniser le projet avec Gradle).

- **« SDK location not found »** (emplacement du SDK introuvable) : **File › Project Structure… › SDK Location** (Fichier › Structure du projet › Emplacement du SDK), puis indique le dossier du SDK. Par défaut : `C:\Users\<toi>\AppData\Local\Android\Sdk`.
- **Le téléphone n'apparaît pas** :
  - débranche et rebranche le câble ;
  - sur le téléphone, choisis le mode USB « Transfert de fichiers » ;
  - vérifie que « Débogage USB » est bien activé.
- **Gradle Sync échoue** : **File › Invalidate Caches… › Invalidate and Restart** (vider les caches et redémarrer), puis relance la synchronisation avec l'icône éléphant **Sync Project with Gradle Files** (synchroniser le projet avec Gradle).
- **L'appli affiche « Mana Orbit a besoin d'Internet »** : le téléphone n'avait pas de réseau au lancement. Reconnecte-toi puis rouvre l'appli.

---

## Option : laisser Claude faire sur ton PC

Claude Code peut travailler directement sur ton ordinateur : l'appli de bureau (claude.ai/download), ou le terminal (`npm install -g @anthropic-ai/claude-code`, puis `claude` dans le dossier `mtgcardshop`).

Une session ouverte là-bas peut lancer elle-même toutes les commandes ci-dessus (npm, Gradle, émulateur). Tu n'as qu'à valider chaque action. Le branchement du téléphone (débogage USB) et la connexion à la Play Console restent à faire par toi.
