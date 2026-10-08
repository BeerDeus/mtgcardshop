# À faire

## Prochaines améliorations (prévues)
- **Système d'échanges** (liste d'échange, lien public) : à retravailler. Attentes à préciser.
- **Widget Android** (valeur de la collection : `ValueWidget`, `ManaOrbitPlugin.setWidget`, `src/widget.js`) : à améliorer. Attentes à préciser.

## Avant la publication sur le Play Store
- Attendre les réponses d'EDHREC et d'Archidekt (`docs/mails-partenaires.md`).
- AdMob : remplacer les identifiants de test par les vrais.
  - `admob_app_id` dans `android-app/android/app/src/main/res/values/strings.xml`.
  - `ADMOB_BANNER_ID` sur Hostinger.
- Créer la clé de signature release (`.jks`, à garder précieusement).
- Après le premier `.aab`, ajouter dans Firebase le SHA-1 de la clé de signature Play (`docs/android.md`).
- Vérifier auprès de l'URSSAF (ou d'un comptable) si l'édition d'une appli financée par la publicité doit être ajoutée aux activités de Martin Stuis EI.
- Compte développeur personnel récent : test fermé obligatoire (12 testeurs pendant 14 jours) avant la production.
- Play Console : remplir la fiche et le formulaire Sécurité des données d'après `docs/store/fiche.md`.
