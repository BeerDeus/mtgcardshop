# Mails de demande d'accord (EDHREC, Archidekt)

À envoyer avant la sortie sur le Play Store. En anglais : les deux équipes sont anglophones.
Remplace `[Ton prénom]` et vérifie le lien de l'appli. Contacts : EDHREC (formulaire de contact du site ou leur Discord), Archidekt (Discord ou e-mail du support indiqué sur le site).

---

## EDHREC

**Objet :** Mana Orbit, a free Magic collection app crediting EDHREC: may we keep using your data?

Hi EDHREC team,

I'm [Ton prénom], a Magic player and the developer of **Mana Orbit** (https://card.m2s-photo.fr), a free app to track your Magic collection, see what your cards are worth and find the cheapest way to finish a deck. It is a web app today and will soon be on the Google Play Store.

One of its features ranks the top Commander decklists by how much of each deck you already own, and links back to EDHREC for every commander. To do that, we read the following:

- the monthly commander ranking;
- the average decklist of each commander (about 2,000 commanders).

How we use it:

- A small job on our server reads the data **twice a week** (Monday and Thursday), slowly and with pauses between requests.
- We store it once and serve it from our own server. Users' phones **never call EDHREC directly**, so the load on your servers doesn't grow with our user count.
- We credit EDHREC in the app ("Données EDHREC", plus a sources page) and link to each commander's page on edhrec.com.

The app is and will stay free: no paywall and no paid features. To cover hosting and server costs (our server, Firebase, and so on), we plan to add a single small ad banner, nothing more. We don't sell or share any user data.

Since this becomes a public app with that small ad banner, we'd like your permission before release. We'd also gladly follow any guidelines you have: preferred endpoints, request rate, attribution format, use of your name or logo. If you'd rather we didn't use your data, just tell us and we'll remove the feature.

Thanks a lot for EDHREC. It's a fantastic resource for the community.

Best regards,
[Ton prénom]
Mana Orbit · https://card.m2s-photo.fr

---

## Archidekt

**Objet :** Mana Orbit, a free Magic collection app linking to Archidekt decks: may we use your public deck search?

Hi Archidekt team,

I'm [Ton prénom], a Magic player and the developer of **Mana Orbit** (https://card.m2s-photo.fr), a free app to track your Magic collection, see what your cards are worth and find the cheapest way to finish a deck. It is a web app today and will soon be on the Google Play Store.

For each popular commander, the app suggests a few real decklists, each with a link back to the deck on Archidekt:

- a **Budget** deck;
- a **Premium** deck;
- a **cEDH** deck, for competitive commanders.

To pick them, we use your public deck search: the most-viewed Commander decks updated in the last 12 months (about 10 to 12 candidates per commander). We then read those decklists.

How we use it:

- A small job on our server runs **twice a week**, spreads the work over several days, waits between requests and backs off on any error.
- We store the result once and serve it from our own server. Users' phones **never call Archidekt directly**.
- Each suggested deck shows its name and a link to its page on archidekt.com, and Archidekt is credited in the app's sources page.

The app is and will stay free: no paywall and no paid features. To cover hosting and server costs (our server, Firebase, and so on), we plan to add a single small ad banner, nothing more. We don't sell or share any user data.

Since this becomes a public app with that small ad banner, we'd like your permission before release. We'd also gladly follow any guidelines you have: preferred endpoints, request rate, attribution format (for example showing the deck author), use of your name or logo. If you'd rather we didn't use your API, just tell us and we'll adapt.

Thanks for building Archidekt. It's a great tool for the community.

Best regards,
[Ton prénom]
Mana Orbit · https://card.m2s-photo.fr
