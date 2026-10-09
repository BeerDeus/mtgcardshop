# Mails de demande d'accord (EDHREC, Archidekt)

À envoyer avant toute publication sur un store. En anglais : les deux équipes sont anglophones.
Remplace `[Ton prénom]` et vérifie le lien de l'appli. Contacts : EDHREC (formulaire de contact du site ou leur Discord), Archidekt (Discord ou e-mail du support indiqué sur le site).

---

## EDHREC

**Objet :** Mana Orbit, a personal Magic collection app using EDHREC data: may I publish it?

Hi EDHREC team,

I'm [Ton prénom], a Magic player and the developer of **Mana Orbit** (https://card.m2s-photo.fr), a free app to track your Magic collection, see what your cards are worth and find the cheapest way to finish a deck. **Right now it's a personal project that I use only for myself.** Before publishing it on app stores (Google Play first) to share it with other players, I'd like to get your approval.

One of its features ranks the top Commander decklists by how much of each deck you already own, and links back to EDHREC for every commander. To do that, it reads the following:

- the monthly commander ranking;
- the average decklist of each commander (about 2,000 commanders).

How it works:

- A small job on my server reads the data **twice a week** (Monday and Thursday), slowly and with pauses between requests.
- The data is stored once and served from my own server. Users' phones **never call EDHREC directly**, so the load on your servers wouldn't grow with the number of users.
- EDHREC is credited in the app ("Données EDHREC", plus a sources page), with a link to each commander's page on edhrec.com.

If it's published, the app will stay free: no paywall and no paid features. To cover hosting and server costs (server, Firebase, and so on), I'd add a single small ad banner, nothing more. No user data is ever sold or shared.

I won't publish it on any store without your approval: it will stay a personal tool unless you're comfortable with this use. I'd also gladly follow any guidelines you have: preferred endpoints, request rate, attribution format, use of your name or logo. If you'd rather I didn't use your data, just tell me and I'll remove the feature.

Thanks a lot for EDHREC. It's a fantastic resource for the community.

Best regards,
[Ton prénom]
Mana Orbit · https://card.m2s-photo.fr

---

## Archidekt

**Objet :** Mana Orbit, a personal Magic collection app linking to Archidekt decks: may I publish it?

Hi Archidekt team,

I'm [Ton prénom], a Magic player and the developer of **Mana Orbit** (https://card.m2s-photo.fr), a free app to track your Magic collection, see what your cards are worth and find the cheapest way to finish a deck. **Right now it's a personal project that I use only for myself.** Before publishing it on app stores (Google Play first) to share it with other players, I'd like to get your approval.

For each popular commander, the app suggests a few real decklists, each with a link back to the deck on Archidekt:

- a **Budget** deck;
- a **Premium** deck;
- a **cEDH** deck, for competitive commanders.

To pick them, the app uses your public deck search: the most-viewed Commander decks updated in the last 12 months (about 10 to 12 candidates per commander). It then reads those decklists.

How it works:

- A small job on my server runs **twice a week**, spreads the work over several days, waits between requests and backs off on any error.
- The result is stored once and served from my own server. Users' phones **never call Archidekt directly**.
- Each suggested deck shows its name and a link to its page on archidekt.com, and Archidekt is credited in the app's sources page.

If it's published, the app will stay free: no paywall and no paid features. To cover hosting and server costs (server, Firebase, and so on), I'd add a single small ad banner, nothing more. No user data is ever sold or shared.

I won't publish it on any store without your approval: it will stay a personal tool unless you're comfortable with this use. I'd also gladly follow any guidelines you have: preferred endpoints, request rate, attribution format (for example showing the deck author), use of your name or logo. If you'd rather I didn't use your API, just tell me and I'll adapt.

Thanks for building Archidekt. It's a great tool for the community.

Best regards,
[Ton prénom]
Mana Orbit · https://card.m2s-photo.fr

---

## Relance avant le test fermé (EDHREC et Archidekt)

À envoyer à chacun, en réponse au premier mail, **avant tout message de recrutement** (`docs/store/test-ferme.md`). Remplace `[EDHREC / Archidekt]`, `[date]` et `[Ton prénom]`. La phrase sur le site dit qu'il n'a pas été partagé : retire-la si tu l'as déjà fait.

**Objet :** Mana Orbit: small private test before any public release

Hi again,

A quick follow-up on my message of [date].

Google now requires new developers to run a private, invite-only test before an app can be published: at least 12 testers for 14 days. I'd like to start it soon with about 20 Magic players, recruited by invitation only. To be fully transparent: the web version is online (https://card.m2s-photo.fr), but I haven't promoted it, so these testers will be the first players to use it.

Nothing changes in how your data is used: my server reads it twice a week, stores it, and the app credits [EDHREC / Archidekt] and links back to you. If you'd rather I hide the [EDHREC / Archidekt] feature during the test, just tell me and I'll switch it off. And as promised, I won't publish the app on the store without your approval.

One more thing, so there are no surprises: later on, I may add an optional one-time "supporter" purchase that only removes the ad banner. No feature and no data would ever be paid.

Thanks again for your time,
[Ton prénom]
Mana Orbit · https://card.m2s-photo.fr
