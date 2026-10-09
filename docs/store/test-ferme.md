# Test fermé Google Play : Mana Orbit

Compte développeur personnel créé après le 13 novembre 2023 : avant la production, Google exige un **test fermé avec au moins 12 testeurs inscrits sans interruption pendant les 14 derniers jours**. Si le nombre passe sous 12, les 14 jours repartent de zéro. Vise **18 à 20 testeurs**.

Tout ce qu'il faut est ici : les étapes, le groupe Google, où recruter, les textes à coller (blocs gris), et la vérification de chaque jour. Remplace les `[crochets]`.

---

## 1. Avant de recruter : EDHREC et Archidekt

Les mails de demande disent « un projet personnel que j'utilise seul » (`docs/mails-partenaires.md`), alors que le site sert déjà leurs données à tout le monde. Recruter en public y amènera du monde.

1. Envoie d'abord la **relance** à EDHREC et à Archidekt (`docs/mails-partenaires.md`, en bas).
2. Recrute uniquement par le **groupe Google** et le **lien d'inscription au test**. Ne donne jamais l'adresse du site dans les messages.
3. Si l'un des deux refuse : coupe sa fonction pendant le test (interrupteur serveur à prévoir, `docs/a-faire.md`).

## 2. Les étapes

**J-7 à J-1 : préparation**
- Termine la fiche (`docs/store/fiche.md` : textes, captures, classification, sécurité des données, public cible, annonces). Un test fermé ne part pas sans tout ça.
- Construis un `.aab` signé avec le **vrai** identifiant d'appli AdMob (`admob_app_id`, `strings.xml`), mais laisse **`ADMOB_BANNER_ID` vide** sur Hostinger : les testeurs voient le bandeau de test de Google. Pas de trafic invalide, et AdMob ne validera pas l'appli avant la production de toute façon.
- Envoie-le d'abord en **test interne** (toi seul). Ajoute dans Firebase le SHA-1 de la clé de signature Play, puis vérifie la connexion Google dans l'appli installée depuis le Play Store.
- Crée le groupe Google (§ 3) et, si tu veux, un petit serveur Discord avec trois salons : `#annonces`, `#bugs`, `#idées`.

**J0 : canal « Test fermé »**
- Play Console › Tests › **Test fermé** › Créer un canal (ou celui proposé par défaut).
- **Testeurs** : ajoute le groupe Google `mana-orbit-testeurs@googlegroups.com`.
- **Pays** : France, Belgique, Suisse, Luxembourg, Canada. Si tu recrutes sur les sous-reddits d'échange de tests (§ 4), ouvre à **tous les pays** : sinon ces testeurs ne peuvent pas installer.
- **URL ou e-mail pour les commentaires** : l'invitation Discord, ou ton e-mail.
- Envoie la version en examen. Le premier examen d'une nouvelle appli peut prendre plusieurs jours : **recrute en même temps** (§ 4). Vise 18 personnes inscrites avant l'accord de Google.

**J0 à J14 : le test**
- Message de bienvenue et missions (§ 5), questionnaire chaque dimanche.
- Vérification de chaque jour (§ 6).
- Les corrections du site arrivent tout de suite chez les testeurs (l'appli charge le site en ligne). Une correction native part sur le même canal avec un nouveau `versionCode` : les 14 jours ne repartent pas.

**J15 ou plus tard : la production**
- Play Console › Tableau de bord › **Demander l'accès à la production**. Réponses : § 5, dernier bloc.
- **Garde tous les testeurs inscrits jusqu'à l'accord.** Préviens-les dans `#annonces` : « ne vous désinscrivez pas encore ».

L'appli n'a aucune mesure d'audience (c'est voulu) : les seules preuves d'engagement seront les questionnaires, Discord, les e-mails et Android vitals. Tiens un tableau tout simple : *retour · gravité · corrigé le*. Il servira pour le formulaire de production.

## 3. Le groupe Google

Les testeurs s'y inscrivent eux-mêmes : bien plus simple que de collecter des adresses.

1. https://groups.google.com › **Créer un groupe**.
2. Nom : `Mana Orbit testeurs` · adresse : `mana-orbit-testeurs` (`@googlegroups.com`).
3. Confidentialité :
   - Qui peut rechercher le groupe : **tout le monde sur le Web** ;
   - Qui peut rejoindre le groupe : **tout le monde peut rejoindre** ;
   - Qui peut afficher les conversations et publier : **gestionnaires seulement** (le groupe ne sert qu'à la liste) ;
   - Qui peut voir les membres : **gestionnaires seulement** (les adresses des testeurs restent privées).
4. Lien à donner : `https://groups.google.com/g/mana-orbit-testeurs`. Lien d'inscription au test (une fois le canal créé) : `https://play.google.com/apps/testing/app.manaorbit`.

L'ordre compte pour les testeurs : **1.** rejoindre le groupe avec le compte Google de leur Play Store, **2.** accepter l'invitation au test, **3.** installer depuis le Play Store.

## 4. Où recruter (du plus fiable au moins fiable)

1. **Ton groupe de jeu et tes amis** : 5 à 8 personnes, les plus sûres.
2. **Boutiques de jeux** : aux soirées Commander, demande d'abord au gérant. Message et affiche au § 5.
3. **Discord francophones** : « MTG [FR] » (environ 3 000 membres), « Le Royaume des Commandants (SpellTable EDH FR) », « Modern [FR] ». Demande à un modérateur avant de poster, dans le salon d'autopromotion s'il existe.
4. **Forums** : Magic Corporation, Magic-Ville (forums), groupes Facebook régionaux de Magic et d'échange de cartes.
5. **Reddit anglophone** : r/EDH, r/mtgfinance. Lis leurs règles d'autopromotion avant ; r/magicTCG est strict.
6. **Échange de tests** : r/AndroidClosedTesting, r/TestersCommunity. Au plus 5 testeurs par ce biais : ils aident à rester au-dessus de 12, mais donnent peu de retours. **Jamais** de service de testeurs payant (comptes fictifs ou inactifs).

Règles :
- Aucune récompense contre une note ou un avis. Un remerciement dans l'appli (« Merci aux testeurs ») est permis, à ajouter avant la production si tu le promets.
- Ne demande **jamais** à personne de toucher les publicités.

## 5. Textes à coller

**Message long (Reddit, forum, Facebook)**
```
Titre : Je cherche 15 testeurs Android pour Mana Orbit, une appli gratuite de collection Magic (scan VF, cote Cardmarket, decks Commander)

Salut à tous !

Je suis joueur de Magic et je développe seul Mana Orbit, une appli Android gratuite pensée d'abord pour les joueurs francophones :
• scan des cartes en VF ou en VO, lu sur le téléphone (la photo n'est jamais envoyée) ;
• la cote de ta collection au prix tendance Cardmarket, mise à jour chaque jour, avec sa courbe et un widget pour l'écran d'accueil ;
• les decks Commander dont tu as déjà le plus de cartes, et la liste de celles qui te manquent ;
• ta liste d'échange (doublons et cartes recherchées) en un lien ou un QR code ; sur la liste d'un ami, « Pour toi » montre ce que vous pouvez échanger.
Pas de compte obligatoire, aucune donnée revendue.

Pour publier une appli sur le Play Store, Google impose maintenant un test fermé : au moins 12 testeurs inscrits pendant 14 jours d'affilée. Je cherche donc 15 à 20 joueurs avec un téléphone Android.

Ce que je te demande :
1. Rejoindre le groupe des testeurs avec le compte Google de ton Play Store : [lien du groupe Google]
2. Accepter l'invitation au test : https://play.google.com/apps/testing/app.manaorbit
3. Installer Mana Orbit depuis le Play Store et la garder jusqu'au [date].
4. L'ouvrir 2 ou 3 fois par semaine et répondre à un petit questionnaire le dimanche (3 minutes).

Si tu veux, ton pseudo apparaîtra dans les remerciements de l'appli.
Questions et retours : [lien Discord], ou dans l'appli : Réglages › Aide et avis › Envoyer un avis.

Merci d'avance, et n'hésite pas à faire passer à ton groupe de jeu !

Mana Orbit est un contenu de fan non officiel, ni approuvé ni soutenu par Wizards of the Coast.
```

**Version courte (Discord)**
```
Salut ! Je développe Mana Orbit, une appli Android gratuite pour ta collection Magic : scan VF/VO sur le téléphone, cote Cardmarket chaque jour (et en widget), decks Commander que tu peux déjà monter, liste d'échange en un lien ou un QR code. Pas de compte obligatoire.
Avant sa sortie, Google m'impose 12 testeurs pendant 14 jours. Partant pour m'aider ? 2 ou 3 ouvertures par semaine suffisent.
1. Rejoins le groupe : [lien du groupe Google]
2. Inscris-toi au test : https://play.google.com/apps/testing/app.manaorbit
3. Installe l'appli depuis le Play Store et garde-la jusqu'au [date].
Merci ! Retours ici ou en MP.
```

**Au gérant d'une boutique**
```
Bonjour,
Je suis joueur de Magic (je viens aux soirées [Commander] du [jour]) et je développe Mana Orbit, une appli Android gratuite pour suivre sa collection : scan des cartes en VF, cote Cardmarket, decks Commander à compléter, liste d'échange à montrer en QR code.
Avant sa sortie sur le Play Store, je cherche une quinzaine de testeurs. Serait-il possible de poser une petite affiche avec un QR code près des tables, ou d'en parler deux minutes en début de soirée ? L'appli est gratuite et ne vend rien.
Merci beaucoup,
[Prénom]
```

**Affiche A5**
```
TESTEURS RECHERCHÉS
Mana Orbit, l'appli gratuite pour ta collection Magic
Scan VF ou VO · Cote Cardmarket · Decks Commander à monter · Liste d'échange en QR code
Android uniquement · 14 jours · 2 ou 3 ouvertures par semaine
Scanne le QR code pour rejoindre le test
[QR code vers le groupe Google]
Contenu de fan non officiel, ni approuvé ni soutenu par Wizards of the Coast.
```

**Bienvenue et missions** (à épingler dans Discord ou à envoyer par e-mail ; la semaine 2 part le 7e jour)
```
Bienvenue dans le test de Mana Orbit, et merci !
Pour que le test compte, garde l'appli installée et reste inscrit jusqu'au [date] : Google compte les testeurs inscrits sans interruption pendant 14 jours. Ouvre-la 2 ou 3 fois par semaine.
Une question ? Le « ? » en bas de l'accueil (« Comment ça marche ? ») répond aux plus courantes.

SEMAINE 1 (du [date] au [date]) : les bases
1. Installe Mana Orbit depuis le Play Store et passe l'accueil.
2. Ajoute des cartes : Ma collection › importe un CSV (ManaBox, Moxfield, Dragon Shield…) ou scanne une dizaine de cartes, VF et VO.
3. Regarde la cote de ta collection sur l'accueil, puis Ma collection › Stats.
4. Ma collection › Decks : quels decks Commander peux-tu déjà monter ?
5. Pose le widget « Valeur de la collection » sur ton écran d'accueil, et active les notifications (Réglages › Gérer les notifications).

SEMAINE 2 (du [date] au [date]) : l'usage réel
1. Une vraie session de scan : 30 cartes ou plus. Note celles qui ne sont pas reconnues.
2. Copie une decklist, puis sur l'accueil : Nouveau panier › « Coller une liste », et touche « Voir les prix ».
3. Enregistre un deck et active les alertes de prix (Réglages › Gérer les notifications) : tu seras prévenu si une carte qui lui manque baisse fortement.
4. Ma collection › Échange : crée ton lien (compte nécessaire) et montre ton QR code à un ami. Ouvre sa liste : l'onglet « Pour toi » montre ce que vous pouvez échanger.
5. Facultatif : ouvre ta collection sur un 2e appareil, essaie l'anglais, le thème clair, le mode avion.

Chaque dimanche : le questionnaire (3 minutes) : [lien]
Un bug ? Réglages › Aide et avis › Envoyer un avis (la version de l'appli est déjà notée), ou dans #bugs avec une capture.
```

**Questionnaire de la semaine** (Google Forms, réglé pour ne **pas** collecter les adresses e-mail)
```
1. Qu'as-tu fait dans Mana Orbit cette semaine ? (scan · import CSV · cote et Stats · decks Commander · nouveau panier · liste d'échange et QR code · « Pour toi » · alertes de prix · widget · compte · aide)
2. Qu'est-ce qui t'a bloqué, surpris ou agacé ?
3. Au scan, sur 10 cartes, combien ont été reconnues du premier coup ? (0 à 10)
4. De 1 à 5 : « Je continuerai à utiliser Mana Orbit après le test. »
5. Une fonction qui te manque, une idée ?
6. (Facultatif) Modèle de téléphone et version d'Android.
```

**Échange de tests (anglais, r/AndroidClosedTesting, r/TestersCommunity)**
```
[Test for test] Mana Orbit – free Magic: The Gathering collection app (EN/FR) – 14 days
I'll test your app back for the full 14 days: drop your opt-in link in the comments.
1) Join: [Google Group link]  2) Opt in: https://play.google.com/apps/testing/app.manaorbit  3) Install from Play and open it a few times a week.
On-device card scanner, collection value at Cardmarket prices with a home screen widget, Commander decks you can already build, trade list by link or QR code. Feedback welcome in English or French: Settings › Help and feedback › Send feedback.
```

**Demande d'accès à la production** (squelette, remplace les chiffres)
```
Recrutement : joueurs de Magic de mon groupe de jeu, de la boutique [nom] et des serveurs Discord francophones (MTG [FR], Le Royaume des Commandants), plus quelques développeurs en échange de tests. [N] testeurs inscrits, dont [N] joueurs de Magic.
Engagement : missions et questionnaire chaque semaine ([N] réponses), salon Discord ([N] messages), [N] avis envoyés depuis l'appli. L'appli n'a volontairement aucun outil de mesure d'audience : les retours viennent des testeurs eux-mêmes.
Retours principaux et corrections : [3 à 5 exemples datés : bug, correction, date].
Public : joueurs de Magic, 13 ans et plus, francophones d'abord, qui possèdent des cartes physiques.
Valeur : collection et cote au prix Cardmarket, scan sur le téléphone, decks à compléter avec ses propres cartes, liste d'échange partagée, gratuit et sans compte.
Prêt pour la production : [taux sans plantage %], rapport de pré-lancement sans erreur bloquante, retours de la 2e semaine positifs ([moyenne]/5).
```

## 6. Chaque jour (5 minutes)

- [ ] Play Console › Test fermé : **testeurs inscrits ≥ 12** (vise 15 et plus). En baisse ? Relance tout de suite (§ 4) ; sous 12, les 14 jours repartent.
- [ ] Avis reçus (objet « Mana Orbit · avis ») et `#bugs` : réponds dans la journée, note chaque retour dans le tableau (*retour · gravité · corrigé le*).
- [ ] Android vitals : plantages et ANR. Après chaque nouvelle version : le rapport de pré-lancement.
- [ ] Correction du site en ligne ? Annonce-la dans `#annonces` (« corrigé, rouvre l'appli »).
- [ ] Le bandeau publicitaire est toujours celui de **test** (`ADMOB_BANNER_ID` vide) ; ne touche jamais une vraie pub.
- [ ] Dimanche : lien du questionnaire. Lundi : lis les réponses. 7e jour : missions de la semaine 2.
