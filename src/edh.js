/* ── edh.js : commandants joués (EDHREC) et decks à compléter, depuis la collection ───────────────────────────
   Données : edh.tsv, généré chaque semaine par GitHub Actions (gen-edhrec.mjs) et servi par le site : commandants (nombre de decks, identité de couleur),
   deck moyen de chacun et prix Cardmarket des cartes. Une seule requête, gardée sur l'appareil ; tout le calcul se fait ici, sans réseau. */
const EDH_KEY = 'edh:v1', EDH_BIN_KEY = 'edh:v2', EDH_FILE = 'edh.tsv', EDH_BIN = 'edh.bin.gz', EDH_FRESH = DAY;      // v2 : fichier binaire (EDH2) ; v1 : ancien texte, gardé en repli
const EDH_SORTS = [['have', 'Plus possédées'], ['cost', 'Moins cher'], ['pop', 'Meilleur tier']];
const EDH_TIER_NAMES = ['S', 'A', 'B', 'C', 'D'], EDH_IM_KEY = 'edh:im', EDH_SMALL = 'https://cards.scryfall.io/small/';
/** Thèmes EDHREC (style du commandant, vaut pour tous ses decks) : noms affichés en français, par libellé EDHREC en minuscules ; un libellé absent s'affiche tel que l'écrit EDHREC. */
const EDH_THEME_FR = { 'control': 'Contrôle', 'discard': 'Défausse', 'mill': 'Meule', 'self-mill': 'Auto-meule', 'lifegain': 'Gain de vie', 'lifedrain': 'Drain de vie', 'card draw': 'Pioche', 'counterspells': 'Contresorts', 'reanimator': 'Réanimation', 'extra turns': 'Tours supplémentaires', 'politics': 'Politique', 'theft': 'Vol', 'blink': 'Blink', 'equipment': 'Équipements', 'artifacts': 'Artefacts', 'tokens': 'Jetons', 'graveyard': 'Cimetière', '+1/+1 counters': 'Marqueurs +1/+1', 'proliferate': 'Prolifération', 'lands matter': 'Terrains', 'treasure': 'Trésors', 'big mana': 'Gros mana', 'vehicles': 'Véhicules', 'forced combat': 'Combat forcé', 'land destruction': 'Destruction de terrains', 'x spells': 'Sorts à X', 'bounce': 'Rebond', 'exile': 'Exil', 'infect': 'Poison', 'poison': 'Poison', 'food': 'Nourriture', 'blood': 'Sang', 'curses': 'Malédictions', 'donate': 'Don', 'enchantress': 'Enchantements', 'monarch': 'Monarque', 'superfriends': 'Superfriends', 'planeswalkers': 'Planeswalkers' };
const edhThemeName = t => EDH_THEME_FR[t.label.toLowerCase()] || t.label;
/** À quoi correspond chaque thème (le « i » de la liste des thèmes et de la feuille d'un deck), par libellé EDHREC en minuscules : un libellé sans description n'a pas de « i ». Rédigées d'après des sources de stratégie Commander (EDHREC, MTG Wiki, Draftsim, Card Kingdom, Commander's Herald…) ; la fin « Ex. : » liste des cartes emblématiques, séparées par « · » (affichée à part). */
const EDH_THEME_INFO = {
  'aggro': 'Gagner par le combat : déployer vite beaucoup de créatures peu chères et frapper avant que la table soit installée. En multijoueur (40 points de vie par adversaire), il faut une courbe de mana basse, des protections et de quoi se relancer après un balayage. Ex. : Craterhoof Behemoth · Sword of Feast and Famine',
  'midrange': 'Jeu flexible : survivre au début de partie, puis accumuler mana et cartes avec des moteurs de valeur et un peu d\'interaction, en s\'adaptant à la table. La valeur seule ne gagne pas : il faut de vraies conditions de victoire. Ex. : Mystic Remora · Aurelia, the Warleader · Orcish Bowmasters',
  'control': 'Neutraliser les menaces de la table (contresorts, élimination, balayages) en gardant l\'avantage en cartes, puis conclure avec peu de menaces résistantes. Face à trois adversaires qui piochent, l\'élimination compte autant que le contresort ; le piège est de dominer sans jamais finir. Ex. : Counterspell · Cyclonic Rift · Swords to Plowshares',
  'combo': 'Assembler quelques cartes précises dont l\'interaction gagne la partie sur-le-champ (boucle infinie de mana ou de dégâts, victoire alternative), en s\'aidant de tuteurs et de pioche pour les trouver. Fragile face à l\'élimination et aux contresorts : il faut de la redondance et de la protection. Ex. : Thassa\'s Oracle · Demonic Consultation · Sanguine Bond',
  'tempo': 'Entre aggro et contrôle : poser des menaces efficaces, puis faire perdre du temps et du mana aux adversaires (rebonds, contresorts peu chers) pour creuser l\'avance. En Commander, le rebond de masse est plus rentable que le rebond ciblé, et il faut des menaces pour en profiter. Ex. : Cyclonic Rift · Cryptic Command',
  'stax': 'Poser des permanents qui taxent ou bloquent les ressources adverses (mana, terrains, sorts), en s\'en protégeant mieux que la table, puis gagner une fois le verrou en place. Piège : un verrou sans condition de victoire rapide rend la partie interminable. Proche de Prison, qui vise des verrous plus précis. Ex. : Winter Orb · Rule of Law · Smokestack',
  'prison': 'Verrouiller le jeu adverse par des effets durs : empêcher de dégager ses permanents (Stasis), de jouer des sorts peu chers (Trinisphere) ou d\'attaquer (Ensnaring Bridge). Proche du Stax, mais avec des verrous précis et un plan de victoire que le verrou ne gêne pas. Ex. : Stasis · Ensnaring Bridge · Trinisphere',
  'pillow fort': 'Se rendre peu attractif à attaquer sans empêcher les autres de jouer : taxe par créature attaquante, limite d\'attaquants, effets dissuasifs. On accumule de la valeur derrière ces défenses et on gagne tard, hors combat. Vulnérable à l\'élimination d\'enchantements et aux combos rapides. Ex. : Propaganda · Ghostly Prison · Windborn Muse',
  'voltron': 'Empiler équipements, auras et bonus de puissance sur une seule créature, souvent le commandant, avec de l\'évasion et de la protection, pour infliger 21 dégâts de commandant à un même adversaire, un par un. Une seule élimination ou un seul exil annule plusieurs tours d\'investissement. Ex. : Lightning Greaves · Swiftfoot Boots · Ethereal Armor',
  'storm': 'Storm est un mot-clé : quand on lance le sort, il est copié une fois pour chaque sort lancé plus tôt dans le tour. Le deck enchaîne rituels, pioche, réductions de coût et tuteurs pour faire monter ce compte, puis finit avec un sort à storm (dégâts, perte de vie, mill). Fragile face aux contresorts et à la défausse. Ex. : Grapeshot · Tendrils of Agony · Brain Freeze',
  'good stuff': 'Pas de synergie centrale ni de plan unique : le deck réunit les cartes les plus puissantes et polyvalentes des couleurs du commandant (accélération, tuteurs, pioche, élimination). Les parties se terminent de façons variées, donc prévoir quand même quelques moyens de conclure. Ex. : Demonic Tutor · Rhystic Study · Swords to Plowshares',
  'toolbox': 'Une boîte à outils : des réponses ciblées (élimination, contresorts, protection, pioche, finisseurs) et des tuteurs, souvent de créatures, pour trouver le bon outil au bon moment. Le deck s\'adapte à la table et gagne au combat, par combo ou par dégâts directs. Ex. : Chord of Calling · Eladamri\'s Call · Green Sun\'s Zenith',
  'stompy': 'Un deck, surtout vert, qui accélère son mana tôt (créatures-mana, ramp) pour poser de grosses créatures dès les premiers tours et submerger les adversaires au combat. Son point faible est le plateau bloqué : il lui faut de l\'évasion et de l\'élimination. Ex. : Garruk\'s Uprising · Rhythm of the Wild · Verdurous Gearhulk',
  'weenies': 'Un deck de petites créatures bon marché (souvent à 1 ou 2 mana, surtout en blanc), posées en nombre pour submerger la table, puis exploitées par des synergies : déclencheurs d\'arrivée, sacrifices, pioche, dégâts de masse. Vulnérable aux balayages. Ex. : Mentor of the Meek · Skullclamp · Welcoming Vampire',
  'chaos': 'Un deck qui mise sur le hasard et l\'imprévisibilité : dés, pile ou face, échanges de cartes, effets aléatoires, attaques forcées. Il gagne en bouleversant le plateau plutôt que par un plan linéaire, et se joue mieux après en avoir parlé avec la table (règle 0). Ex. : Chaos Warp · Possibility Storm · Scrambleverse',
  'politics': 'Un deck qui gagne en orientant les autres joueurs : votes, accords, cadeaux ou menaces d\'élimination pour décider qui attaque qui, souvent avec le monarque ou le goad. Il exige de tenir ses promesses et de punir les traîtres. Ex. : Plea for Power · Split Decision · Council\'s Judgment',
  'group hug': 'Un deck qui aide toute la table (pioche, mana, gain de vie, créatures) au lieu de chercher un avantage personnel. Ces cadeaux servent à se faire des alliés et à détourner l\'agression ; certains decks visent une vraie victoire, d\'autres surtout le chaos. Ex. : Howling Mine · Temple Bell · Dictate of Kruphix',
  'group slug': 'Faire perdre de la vie à toute la table peu à peu, par des effets de masse (dégâts à chaque pioche, terrain ou sort ; parfois symétriques, soi-même compris). On gagne par usure en se protégeant mieux (lien de vie, prévention), mais le deck devient vite la cible. Ex. : Sulfuric Vortex · Underworld Dreams · Ankh of Mishra',
  'hatebears': 'Un deck de petites créatures bon marché dont l\'effet gêne les adversaires : taxes, interdictions, limites de pioche ou de recherche. Contrairement au Stax, il garde une pression au combat pour gagner. Vulnérable aux balayages, il a besoin de pioche. Ex. : Drannith Magistrate · Aven Mindcensor · Archon of Emeria',
  'big mana': 'Un deck qui produit bien plus de mana que nécessaire (créatures et rochers de mana, ramp de terrains) pour lancer des sorts très chers (souvent 7 mana et plus), des sorts à X ou des Eldrazi. Contrairement au ramp classique, l\'excès de mana est le plan principal. Ex. : Thran Dynamo · Nyxbloom Ancient · Omniscience',
  'ramp': 'Accélérer son mana au-delà d\'un terrain par tour : sorts qui cherchent des terrains, créatures-mana, rochers de mana. On lance ses grosses cartes plus tôt, voire plusieurs sorts par tour. Un deck équilibré joue en général une dizaine de sources ; trop de ramp laisse sans rien à lancer. Ex. : Cultivate · Rampant Growth · Birds of Paradise',
  'spellslinger': 'Deck bâti sur les éphémères et les rituels : beaucoup de sorts peu chers et des créatures ou permanents qui se déclenchent à chaque sort lancé (jetons, dégâts, copies, réduction de coût). On gagne avec des jetons, de petites créatures, des dégâts directs ou un combo. Souvent bleu-rouge. Ex. : Guttersnipe · Young Pyromancer · Talrand, Sky Summoner',
  'counterspells': 'Jouer des contresorts, qui annulent un sort adverse au moment où il est lancé, pour empêcher un combo ou une menace de se résoudre. En multijoueur chaque contresort n\'écarte qu\'un seul sort, et il faut garder du mana ouvert pendant le tour des autres. Ex. : Counterspell · Force of Will · Mana Drain',
  'card draw': 'Piocher au-delà de la pioche du tour pour ne jamais dépendre de la carte du dessus : moteurs répétables, sorts de pioche ponctuels, créatures qui piochent en arrivant. À distinguer des cantrips, qui ne font que se remplacer ; on vise une dizaine de sources d\'avantage de cartes. Ex. : Rhystic Study · Phyrexian Arena · Consecrated Sphinx',
  'cantrips': 'Sorts très bon marché qui piochent une carte en plus de leur effet, donc se remplacent : on gagne en efficacité et en sélection plutôt qu\'en avantage de cartes. Ils servent à lancer beaucoup de sorts par tour pour nourrir des cartes qui récompensent chaque sort (spellslinger). Ex. : Brainstorm · Ponder · Opt',
  'x spells': 'Des sorts dont l\'effet dépend d\'un X payé en mana : plus on dépense, plus l\'effet est grand. Le deck cherche donc beaucoup de mana, souvent en vert et bleu, et des cartes qui copient ou amplifient les sorts à X. Ex. : Hydroid Krasis · Villainous Wealth · Unbound Flourishing',
  'flash': 'Cartes avec flash, lançables à tout moment où l\'on pourrait lancer un éphémère : bloqueur surprise après la déclaration des attaques, ou créature posée à la fin du tour adverse pour attaquer juste après. Des cartes comme Vedalken Orrery donnent flash à tous les sorts. Ex. : Vendilion Clique · Nightpack Ambusher · Vedalken Orrery',
  'burn': 'Dégâts directs hors combat : sorts qui blessent n\'importe quelle cible, et permanents qui infligent des dégâts à chaque événement (créature qui arrive, sacrifice, sort lancé). On tue des créatures ou on vide la vie des adversaires, plus dur en Commander avec 40 points de vie chacun. Ex. : Lightning Bolt · Guttersnipe · Impact Tremors',
  'lifegain': 'Gagner de la vie à répétition, par tous les moyens (lien de vie, déclencheurs, sorts de soin), pour activer des cartes qui réagissent à chaque gain : marqueurs +1/+1, pioche, jetons, drain final. La vie sert aussi de ressource à dépenser. Ex. : Soul Warden · Archangel of Thune · Aetherflux Reservoir',
  'lifedrain': 'Faire perdre de la vie aux adversaires hors combat, souvent en en gagnant autant : drains en un coup ou déclencheurs répétés à chaque créature qui meurt. On gagne par la perte de vie plutôt que par les attaques, surtout en noir. Ex. : Gray Merchant of Asphodel · Blood Artist · Sanguine Bond',
  'mill': 'Envoyer les cartes du dessus de la bibliothèque des adversaires au cimetière jusqu\'à ce qu\'un adversaire doive piocher dans une bibliothèque vide et perde. Face à trois bibliothèques de 99 cartes, il faut des effets massifs (la moitié de la bibliothèque), des doubleurs ou des effets répétés à chaque tour. Ex. : Bruvac the Grandiloquent · Maddening Cacophony · Mesmeric Orb',
  'self-mill': 'Mettre les cartes du dessus de sa propre bibliothèque au cimetière pour en faire une ressource : réanimation, lancer des cartes depuis le cimetière, cartes qui comptent le cimetière. Le mill est ici un carburant, pas une condition de victoire ; l\'exil de cimetière adverse est le grand danger. Ex. : Stitcher\'s Supplier · Muldrotha, the Gravetide',
  'discard': 'Faire défausser les adversaires pour les priver de ressources avant qu\'elles ne soient jouées, souvent avec des cartes qui punissent chaque défausse ou une main vide. Il faut des cartes de conclusion (dégâts, drain), sinon la partie s\'enlise. Ex. : Megrim · Waste Not · Liliana\'s Caress',
  'wheels': 'Effets « wheel » : chaque joueur défausse sa main et en pioche une nouvelle, souvent de sept cartes (d\'après Wheel of Fortune). Le deck se regarnit plus vite que la table, perturbe les grosses mains adverses et exploite les pioches et défausses avec des cartes à déclencheur. Ex. : Wheel of Fortune · Windfall · Notion Thief',
  'theft': 'Gagner avec les cartes des adversaires : prendre le contrôle de leurs créatures ou artefacts (Control Magic), les emprunter un tour (Threaten) ou lancer leurs cartes exilées. Les effets temporaires se marient aux sacrifices pour se débarrasser de la créature avant qu\'elle ne revienne. Ex. : Control Magic · Threaten · Hostage Taker',
  'bounce': 'Renvoyer des permanents en main : les siens pour rejouer leurs effets d\'arrivée, ceux des adversaires pour gagner du tempo, contourner l\'indestructible et faire disparaître les jetons. Le rebond ne gagne pas seul : il sert à frapper ou à gagner le temps nécessaire. Ex. : Cyclonic Rift · Cloudstone Curio · Aether Adept',
  'exile': 'Thème bâti sur la zone d\'exil : surtout jouer des cartes depuis l\'exil (pioche impulsive, suspend, aventure, cartes volées), qui donne de l\'avantage de cartes et souvent des jetons Trésor, plus rarement l\'exil comme retrait définitif. Ex. : Ignite the Future · Reckless Impulse · Swords to Plowshares',
  'land destruction': 'Détruire les terrains adverses pour étouffer leur mana : destruction ciblée (Stone Rain) ou de masse (Armageddon, Ruination), avec récursion de terrains et accélération pour s\'en remettre avant les autres. Stratégie très mal vue : à valider avec la table. Ex. : Stone Rain · Armageddon · Ruination',
  'extra turns': 'Sorts donnant un ou plusieurs tours supplémentaires : un autre dégagement, une autre attaque et une pioche de plus pour finir la partie ou enchaîner un combo. Le deck rejoue ces sorts par récursion ou copie, jusqu\'à la boucle infinie. Sans plan de victoire, on devient l\'ennemi de la table. Ex. : Time Warp · Nexus of Fate · Expropriate',
  'forced combat': 'Forcer les créatures adverses à attaquer : le goad (elles doivent attaquer à chaque combat si possible, et pas vous, jusqu\'à votre prochain tour) ou des effets statiques. Le deck profite du chaos (drain, pioche) et se protège de la riposte. Ex. : Disrupt Decorum · Grand Melee · Fumiko the Lowblood',
  'tokens': 'Créer beaucoup de jetons de créature, les multiplier avec des doubleurs, puis les convertir en dégâts avec des effets de masse. Le nombre résiste aux éliminations ciblées, mais pas aux balayages. Ex. : Bitterblossom · Anointed Procession · Craterhoof Behemoth',
  'aristocrats': 'Variante du sacrifice : des créatures-fodder (souvent des jetons), un moyen de les sacrifier à volonté et des cartes qui se déclenchent à chaque mort (drain, pioche, Trésor). Les balayages adverses nourrissent le moteur ; le deck gagne en vidant la vie des adversaires. Ex. : Blood Artist · Zulaport Cutthroat · Cruel Celebrant',
  'sacrifice': 'Sacrifier des permanents (créatures, jetons, artefacts, parfois terrains) pour en tirer de la valeur : pioche, mana, dégâts, marqueurs. Il faut du fodder, des moyens de sacrifier et des cartes qui en profitent. Plus large que les aristocrats, centrés sur le drain. Ex. : Viscera Seer · Ashnod\'s Altar · Greater Good',
  'reanimator': 'Remplir son cimetière de grosses créatures (défausse, pioche-défausse, mise en cimetière depuis la bibliothèque), puis les ramener sur le champ de bataille pour 1 à 3 mana. Gros gain de tempo, mais fragile face à l\'exil de cimetière (Relic of Progenitus). Ex. : Reanimate · Animate Dead · Entomb',
  'graveyard': 'Faire du cimetière une seconde réserve de cartes : on le remplit (défausse, self-mill) puis on rejoue des sorts (flashback), on récupère des cartes ou on exile des cartes pour réduire des coûts (delve). Plus large que le réanimator ; vulnérable à l\'exil de cimetière (Rest in Peace, Bojuka Bog). Ex. : Eternal Witness · Living Death · Meren of Clan Nel Toth',
  'blink': 'Exiler ses permanents puis les remettre aussitôt sur le champ de bataille pour redéclencher leurs effets d\'arrivée (pioche, mana, élimination, jetons) : on gagne à l\'usure, et un clignotement à l\'instant esquive une élimination. Attention : le permanent revient neuf (marqueurs et auras perdus, jeton exilé détruit). Ex. : Ephemerate · Mulldrifter · Soulherder',
  'clones': 'Copier des créatures, les siennes ou celles des adversaires, pour répéter leurs effets d\'arrivée ou profiter de la plus puissante du champ de bataille ; en singleton, cela donne plusieurs exemplaires de ses meilleures cartes. Un copieur dépend toutefois d\'une bonne cible déjà en jeu. Ex. : Clone · Phyrexian Metamorph · Sakashima of a Thousand Faces',
  '+1/+1 counters': 'Poser des marqueurs +1/+1 sur ses créatures pour les faire grandir, surtout en vert et en blanc. On amplifie avec des effets qui en ajoutent ou en doublent (Hardened Scales ajoute 1 marqueur, Doubling Season double), puis on gagne avec un plateau surdimensionné ou des bonus déclenchés par les marqueurs. Ex. : Hardened Scales · Doubling Season · Corpsejack Menace',
  'proliferate': 'Mot-clé qui permet de choisir n\'importe quel nombre de permanents et/ou de joueurs portant des marqueurs et de leur en donner un de plus de chaque type déjà présent (+1/+1, loyauté, poison, charge…). Sert à accélérer les ultimes de planeswalkers, grossir des créatures ou empoisonner. Ex. : Evolution Sage · Flux Channeler · Contagion Engine',
  'infect': 'Mot-clé infect : les dégâts d\'une source avec infect ne retirent pas de points de vie, ils donnent des marqueurs poison aux joueurs (10 = défaite) et des marqueurs -1/-1 permanents aux créatures. Le deck aligne des créatures infect, des boosts de force et de la prolifération. Ex. : Glistener Elf · Blightsteel Colossus · Hand of the Praetors',
  'poison': 'Gagner en empoisonnant les adversaires : un joueur qui a 10 marqueurs poison ou plus perd la partie, quel que soit son total de points de vie, et le poison ne s\'enlève pratiquement jamais. Sources : infect, toxic, poisonous ou effets directs, souvent amplifiés par la prolifération. Ex. : Venerated Rotpriest · Prologue to Phyresis · Infectious Inquiry',
  'artifacts': 'Un deck rempli d\'artefacts qui se renforcent entre eux : réduction de coût, recyclage et sacrifice, effets d\'arrivée et jetons, pour poser tôt de grosses menaces. Fragile aux destructions de masse d\'artefacts (Bane of Progress, Vandalblast), qui emportent aussi les artefacts de mana. Ex. : Foundry Inspector · Goblin Welder · Krark-Clan Ironworks',
  'equipment': 'Équiper ses créatures (en phase principale, en payant le coût d\'équipement) avec des équipements qui donnent bonus, évasion, protection ou pioche, souvent en Voltron sur le commandant. Contrairement aux auras, l\'équipement reste sur le champ de bataille si la créature meurt et se rééquipe ailleurs. Ex. : Lightning Greaves · Swiftfoot Boots · Skullclamp',
  'auras': 'Enchanter ses créatures avec des auras (bonus, protection) pour en faire des menaces. Risque : si la créature meurt ou quitte le champ de bataille, l\'aura part au cimetière (deux cartes perdues pour une). Les Umbra (qui survivent à une destruction) et la pioche liée aux auras compensent. Ex. : Ethereal Armor · Bear Umbra · Kor Spiritdancer',
  'enchantress': 'Deck centré sur les enchantements (auras, sagas, enchantements-créatures) avec des « enchantresses » qui piochent à chaque enchantement lancé ou arrivé sur le champ de bataille (constellation). Ramp et protection assurent la mise en place, jetons ou gain de vie concluent. Vulnérable aux balayages d\'enchantements. Ex. : Argothian Enchantress · Eidolon of Blossoms · Sythis, Harvest\'s Hand',
  'planeswalkers': 'Deck qui joue beaucoup de planeswalkers et active leurs capacités de loyauté chaque tour pour piocher, faire du mana, créer des jetons ou contrôler la table. Ils attirent les attaques ; contrairement à Superfriends, le commandant n\'est pas forcément bâti autour d\'eux. Ex. : The Eternal Wanderer · Wrenn and Realmbreaker · Oath of Teferi',
  'superfriends': 'Archétype bâti autour des planeswalkers : on les protège (taxes d\'attaque, bloqueurs, destruction de masse) et on accélère leur loyauté avec la prolifération et les doubleurs de marqueurs pour atteindre les ultimes. Plan lent, et les planeswalkers attirent les attaques. Ex. : Doubling Season · The Chain Veil · Deepglow Skate',
  'vehicles': 'Les Véhicules sont des artefacts qui deviennent des créatures-artefacts jusqu\'à la fin du tour quand on engage des créatures de puissance totale suffisante (Équipage N), même celles arrivées ce tour. Il faut des créatures pour les piloter, et la destruction d\'artefacts les menace. Ex. : Smuggler\'s Copter · Parhelion II · Heart of Kiran',
  'landfall': 'Landfall se déclenche chaque fois qu\'un terrain arrive sous votre contrôle sur le champ de bataille : jetons, cartes, mana ou bonus selon la carte. Le deck joue plus de terrains (Exploration, Cultivate, recyclage) et des créatures ou enchantements qui en profitent. Ex. : Avenger of Zendikar · Scute Swarm · Rampaging Baloths',
  'lands matter': 'Deck qui tire sa valeur des terrains eux-mêmes plutôt que des seuls sorts : terrains joués en plus, rejoués depuis le cimetière, sacrifiés ou utilitaires puissants, souvent avec Landfall. Plus large que Landfall, il gagne par accumulation de valeur : jetons, cartes, créatures géantes. Ex. : Exploration · Crucible of Worlds · The Gitrog Monster',
  'treasure': 'Créer des jetons Trésor : des artefacts qui s\'engagent et se sacrifient pour ajouter un mana de n\'importe quelle couleur, une seule fois. Ce mana jetable permet de lancer de gros sorts tôt, et les cartes qui récompensent artefacts, sacrifices ou jetons le transforment en dégâts ou en avantage. Ex. : Smothering Tithe · Academy Manufactor · Goldspan Dragon',
  'food': 'Créer des jetons Nourriture : des artefacts qu\'on engage et sacrifie, pour 2 mana, afin de gagner 3 points de vie. Le gain de vie est secondaire : le deck les produit surtout pour les sacrifier et déclencher des synergies (sacrifice, pioche, jetons, combos). Ex. : Peregrin Took · Gilded Goose · Witch\'s Oven',
  'blood': 'Créer des jetons Sang : un artefact qui, pour 1 mana, en s\'engageant, en défaussant une carte et en se sacrifiant, fait piocher une carte (on défausse avant de piocher). Lié aux vampires (surtout noir et rouge), le Sang sert de carburant aux effets de sacrifice et de drain. Ex. : Bloodtithe Harvester · Blood Fountain · Glass-Cast Heart',
  'monarch': 'Le monarque pioche une carte au début de sa propre étape de fin de tour ; dès qu\'une créature inflige des blessures de combat au monarque, son contrôleur le devient. Le deck prend la couronne puis la garde avec des bloqueurs, des jetons et du pillow fort. Ex. : Queen Marchesa · Thorn of the Black Rose · Court of Grace',
  'curses': 'Les malédictions sont des Auras qui s\'attachent à un joueur et le handicapent. Le deck en empile sur un adversaire et ajoute enchantements et recyclage depuis le cimetière. Plan lent : chaque malédiction ne cible qu\'un joueur. Ex. : Curse of Opulence · Curse of Verbosity · Curse of Misfortunes',
  'donate': 'Donner à un adversaire un permanent nuisible que vous contrôlez, via Donate ou Harmless Offering : le contrôle change, pas le propriétaire. Typique : Illusions of Grandeur, qui fait gagner 20 points de vie puis en fait perdre 20 en quittant le champ de bataille. Jeu politique. Ex. : Donate · Illusions of Grandeur · Zedruu the Greathearted',
};
const edhThemeInfo = t => EDH_THEME_INFO[t.label.toLowerCase()] || '';
/** Description d'un thème en HTML : le texte, puis « Ex. : cartes » sur sa propre ligne. */
const edhInfoHtml = x => { const i = x.indexOf(' Ex. : '); return i < 0 ? esc(x) : `${esc(x.slice(0, i))} <span class="th-ex">Ex. : ${esc(x.slice(i + 7))}</span>`; };
const EDH_BUDGETS = [[0, 'Budget illimité'], [3000, '≤ 30 €'], [6000, '≤ 60 €'], [10000, '≤ 100 €'], [20000, '≤ 200 €']];
const EDH = { data: null, p: null, err: '', at: 0, sort: 'have', cols: new Set(), tiers: new Set(), mine: false, budget: 0, shown: 30, memo: null, im: null, q: '', qm: 'cmd', themes: new Set() };

/** Fichier du site (null hors http, ou s'il manque) : { buf, etag }. same : ETag déjà connu ; si le site répond avec le même, le corps n'est pas lu → { same: true }. */
async function edhGet(file, same) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  let r; try { r = await fetch(new URL(file, location.href).href, { cache: 'no-cache' }); } catch (e) { return null; }
  if (!r.ok) return null;
  const etag = r.headers.get('etag') || '';
  if (same && etag && etag === same) { try { if (r.body) r.body.cancel(); } catch (e) { /* ignore */ } return { same: true, etag }; }
  try { return { buf: await r.arrayBuffer(), etag }; } catch (e) { return null; }
}
/** Fichier texte du site (ancien format), ou null. */
async function edhFetch() { const g = await edhGet(EDH_FILE); try { return g ? new TextDecoder().decode(g.buf) : null; } catch (e) { return null; } }
/** Fichier binaire du site, décompressé (le serveur l'envoie déjà décompressé par le navigateur ; sinon DecompressionStream) : { buf, etag }, { same: true } si l'ETag est inchangé, ou null. */
async function edhFetchBin(same) {
  const g = await edhGet(EDH_BIN, same); if (!g || g.same) return g;
  let b = g.buf; const u = new Uint8Array(b);
  if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') return null;
    try { b = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); } catch (e) { return null; }
  }
  return { buf: b, etag: g.etag };
}
/** Copie de l'appareil déjà affichée : en arrière-plan, une lecture de contrôle (ETag : rien n'est relu si le site n'a pas changé) ; une version plus récente la remplace tout de suite. */
async function edhRevalidate(rec) {
  try {
    const g = await edhFetchBin(rec.etag); if (!g || g.same) return;
    const n = { buf: g.buf, at: Date.now(), etag: g.etag }, x = edhRead(n); if (!x || !x.decks.length) return;
    Cache.set(EDH_BIN_KEY, n);
    if (x.at && EDH.data && EDH.data.at && x.at <= EDH.data.at) return;      // même version : rien à changer
    EDH.data = x; EDH.at = n.at; EDH.memo = null; if (COLL.el) collPaintBody(true);
  } catch (e) { /* hors ligne ou fichier douteux : la copie de l'appareil reste */ }
}
/** Index lu depuis un enregistrement du cache ({ buf } binaire ou { text } ancien format), ou null s'il est illisible. */
function edhRead(rec) {
  try { const d = rec && rec.buf ? parseEdhBin(rec.buf) : rec && rec.text ? parseEdh(rec.text) : null; return d && d.v === 1 && d.cmds.length ? d : null; } catch (e) { return null; }
}
/** Charge les données : copie locale de moins de 1 jour (affichée tout de suite, puis contrôlée en arrière-plan : une version plus récente du site la remplace), sinon le fichier binaire du site, sinon l'ancien fichier texte ; une copie plus ancienne sert si le site ne répond pas. */
function edhLoad() {
  if (EDH.data) return Promise.resolve(EDH.data);
  if (EDH.p) return EDH.p;
  EDH.err = '';
  EDH.p = (async () => {
    const get = k => Cache.get(k, 90 * DAY).catch(() => null), fresh = r => !!r && Date.now() - r.at < EDH_FRESH;
    const [rb, rt] = await Promise.all([get(EDH_BIN_KEY), get(EDH_KEY)]);
    let d = fresh(rb) ? edhRead(rb) : null, at = d ? rb.at : 0; const cached = !!d;
    if (!d) {
      const g = await edhFetchBin(), rec = g && g.buf ? { buf: g.buf, at: Date.now(), etag: g.etag } : null, x = rec && edhRead(rec);
      if (x && x.decks.length) { d = x; at = rec.at; Cache.set(EDH_BIN_KEY, rec); }
    }
    if (!d && fresh(rt)) { d = edhRead(rt); at = d ? rt.at : 0; }
    if (!d) {
      const t = await edhFetch(), rec = t ? { text: t, at: Date.now() } : null, x = rec && edhRead(rec);
      if (x && x.decks.length) { d = x; at = rec.at; Cache.set(EDH_KEY, rec); }
    }
    if (!d) { const x = edhRead(rb); if (x) { d = x; at = rb.at; } }
    if (!d) { const x = edhRead(rt); if (x) { d = x; at = rt.at; } }
    if (!d) throw new Error(rb || rt ? 'illisible' : 'absent');
    EDH.data = d; EDH.at = at; EDH.memo = null;
    if (cached) edhRevalidate(rb);
    return d;
  })().catch(e => { EDH.err = e && e.message === 'absent' ? 'Données EDHREC indisponibles : le fichier edh.bin.gz n\'est pas encore généré ou le site est injoignable.' : 'Données EDHREC illisibles.'; throw e; })
    .finally(() => { EDH.p = null; if (COLL.el) collPaintBody(true); });
  return EDH.p;
}
/** Lance le chargement s'il n'a pas déjà eu lieu ou échoué (un échec ne se relance qu'au toucher de « Réessayer »). */
function edhEnsure() { if (!EDH.data && !EDH.p && !EDH.err) edhLoad().catch(() => {}); }
const edhRetry = () => { EDH.err = ''; edhEnsure(); if (COLL.el) collPaintBody(true); };

const edhDate = () => { const d = EDH.data && EDH.data.at ? new Date(EDH.data.at) : null; return d && !isNaN(d) ? d.toLocaleDateString('fr-FR') : ''; };
/** Décks classés selon la collection et les réglages de l'écran (mémorisés tant que rien ne change). */
function edhRows() {
  if (!EDH.data) return [];
  for (const t of [...EDH.themes]) if (!EDH.data.themeIx.has(t)) EDH.themes.delete(t);      // un thème absent du fichier chargé (version plus ancienne ou plus récente) ne filtre plus rien
  const q = edhQuery(), sig = [COLL.u, collCount(), EDH.at, EDH.sort, engSig(), [...EDH.cols].sort().join(''), [...EDH.tiers].sort().join(''), [...EDH.themes].sort().join(','), EDH.mine, EDH.budget, q, EDH.qm].join('|');
  if (EDH.memo && EDH.memo.sig === sig) return EDH.memo.rows;
  const rows = edhRank(EDH.data, collQty, { held: k => engTotal(XS.eng, k), cols: EDH.cols, tiers: EDH.tiers, themes: EDH.themes, mine: EDH.mine, budget: EDH.budget, sort: EDH.sort, q, qm: EDH.qm });
  EDH.memo = { sig, rows }; return rows;
}
/** Recherche en cours, ou '' : un nom de commandant dès 1 lettre, une carte à partir de 2 (sinon presque tous les decks la contiennent). */
const edhQuery = () => { const t = edhTokens(EDH.q); return t.length && (EDH.qm === 'cmd' || t.join('').length >= 2) ? EDH.q : ''; };
const EDH_QMODES = [['cmd', 'Commandant', 'Rechercher un commandant'], ['card', 'Carte dans le deck', 'Rechercher une carte dans les decks']];
/** Compteurs des thèmes et leur ordre d'après les decks qui restent (mêmes filtres que la liste, thèmes déjà choisis compris), mémorisés avec la liste. */
function edhThemeView() {
  const rows = edhRows(), m = EDH.memo, e = EDH.data;
  if (m && m.tv && m.rows === rows) return m.tv;
  const counts = edhThemeCounts(e, rows), tv = { counts, order: edhThemeOrder(e, counts, EDH.themes) };
  if (m) m.tv = tv; return tv;
}
/** Thèmes EDHREC : les plus présents parmi les decks restants en puces (avec ceux déjà choisis), et « Tous » qui ouvre la liste complète. Vide si le fichier chargé n'a pas de thèmes (ancienne version, avant la prochaine génération). */
const EDH_TH_QUICK = 5;
function edhThemesHtml() {
  const e = EDH.data, all = e.themeOrder || []; if (!all.length) return '';
  const v = edhThemeView(), show = v.order.filter(i => v.counts[i] > 0).slice(0, EDH_TH_QUICK); for (const s of EDH.themes) { const i = e.themeIx.get(s); if (i !== undefined && !show.includes(i)) show.push(i); }
  return `<div class="fopts dk-themes" role="group" aria-label="Thèmes du commandant (EDHREC)"><span class="dk-lbl">Thème</span>${all.length > show.length || EDH.themes.size ? `<button type="button" class="fopt" data-act="dthall">${all.length > EDH_TH_QUICK ? `Tous (${nf0(all.length)})` : 'Plus…'}</button>` : ''}${show.map(i => { const t = e.themes[i]; return `<button type="button" class="fopt" data-act="dth" data-s="${esc(t.slug)}" aria-pressed="${EDH.themes.has(t.slug)}">${esc(edhThemeName(t))}</button>`; }).join('')}</div>`;
}
/** Barre de thèmes repeinte sur place (pendant la frappe dans la recherche, qui ne repeint que les résultats) : les puces suivent la recherche. */
function edhThemesSync() { const el = COLL.el && $('.dk-themes', COLL.el); if (el && EDH.data) el.outerHTML = edhThemesHtml(); }
/** Liste complète des thèmes (feuille) : une ligne par thème (on coche : le commandant doit les avoir tous) avec un « i » qui déplie ce que le thème veut dire ; le nombre de decks restants se met à jour. */
function openEdhThemes() {
  const e = EDH.data; if (!e || !(e.themeOrder || []).length) return;
  openSheet('Thèmes', 'Style des commandants d\'après EDHREC · vaut pour tous leurs decks', api => {
    const shown = new Set();      // thèmes dont la description est dépliée (gardés quand la liste est repeinte)
    const paint = () => {
      const v = edhThemeView();
      api.body.innerHTML = `<p class="hint">Choisis un ou plusieurs thèmes : seuls les decks dont le commandant les a tous restent. Touche « i » pour savoir ce que le thème veut dire. Le nombre = decks qui ont ce thème parmi ceux qui restent avec tes autres réglages (couleurs, tier, recherche…) : la liste se reclasse à chaque choix.</p>
        <div class="th-list" role="group" aria-label="Thèmes">${v.order.map(i => {
          const t = e.themes[i], nm = edhThemeName(t), inf = edhThemeInfo(t), on = shown.has(t.slug), sel = EDH.themes.has(t.slug), c = v.counts[i];
          return `<div class="th-row${c || sel ? '' : ' th-zero'}"><button type="button" class="th-main" data-s="${esc(t.slug)}" aria-pressed="${sel}"${c || sel ? '' : ' disabled'}><span>${esc(nm)}</span><small>${nf0(c)}</small></button>${inf ? `<button type="button" class="th-i" data-i="${esc(t.slug)}" aria-expanded="${on}" aria-label="Que veut dire ${esc(nm)} ?">i</button>` : ''}${inf ? `<p class="th-desc"${on ? '' : ' hidden'}>${edhInfoHtml(inf)}</p>` : ''}</div>`;
        }).join('')}</div>`;
      const n = edhRows().length;
      api.setFoot(`<button class="btn ghost" type="button" id="thClr"${EDH.themes.size ? '' : ' disabled'}>Effacer</button><button class="btn" type="button" data-close>${nf0(n)} deck${n > 1 ? 's' : ''}</button>`);
      const clr = $('#thClr', api.foot); if (clr) clr.onclick = () => { EDH.themes.clear(); EDH.shown = 30; haptic('tap'); paint(); api.body.scrollTop = 0; collPaintBody(true); };
    };
    api.body.addEventListener('click', ev => {
      const inf = ev.target.closest('button[data-i]');
      if (inf) {      // « i » : déplier / replier la description, sans toucher au filtre
        const s = inf.dataset.i, on = !shown.has(s); if (on) shown.add(s); else shown.delete(s);
        inf.setAttribute('aria-expanded', on); const d = inf.parentNode.querySelector('.th-desc'); if (d) d.hidden = !on; return;
      }
      const b = ev.target.closest('button[data-s]'); if (!b) return;
      const s = b.dataset.s; if (EDH.themes.has(s)) EDH.themes.delete(s); else EDH.themes.add(s);
      EDH.shown = 30; haptic('tap');
      paint(); api.body.scrollTop = 0; collPaintBody(true);
    });
    paint();
  });
}
const edhPips = ci => manaHtml(ci ? '{' + ci.split('').join('}{') + '}' : '{C}');
const edhSrcLabel = d => d.src === 'archidekt' ? 'Archidekt' : 'EDHREC · deck moyen';
function edhPanelHtml() {
  if (!EDH.data) {
    return EDH.err ? `<div class="dv-empty"><b>Decks indisponibles</b><p>${esc(EDH.err)}</p><div class="coll-cta"><button class="btn ghost" type="button" data-act="dretry">Réessayer</button></div></div>`
      : '<p class="hint listempty">Chargement des decks EDHREC…</p>';
  }
  const all = EDH.data.cmds.length, mineN = EDH.data.cmds.filter(c => c.keys.some(k => collQty(k) > 0)).length;
  const gcOn = !!(EDH.data.gc && EDH.data.gc.size);
  const tiersHave = EDH.data.tiers || (EDH.data.tiers = new Set(EDH.data.decks.map(d => d.cmd.tier)));      // seuls les tiers qui ont des decks : pas de bouton « D » vide
  const qm = EDH_QMODES.find(m => m[0] === EDH.qm) || EDH_QMODES[0];
  const search = `<div class="dk-search"><div class="fbar-row"><label class="fsearch"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg><input type="search" id="dkQ" data-act="dq" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(EDH.q)}" placeholder="${esc(qm[2])}" aria-label="${esc(qm[2])}"><button type="button" class="fclear" data-act="dqx" aria-label="Effacer la recherche"${EDH.q ? '' : ' hidden'}><svg class="i"><use href="#i-close"/></svg></button></label></div>
      <div class="fopts" role="group" aria-label="Chercher par">${EDH_QMODES.map(([v, l]) => `<button type="button" class="fopt" data-act="dqm" data-v="${v}" aria-pressed="${EDH.qm === v}">${l}</button>`).join('')}</div></div>`;
  const ctl = `${search}<p class="hint">Deck moyen EDHREC des commandants les plus joués (et decks réels Archidekt pour les premiers), comparés à ta collection (terrains de base ignorés). Prix : tendance Cardmarket${edhDate() ? ' au ' + edhDate() : ''}.</p>
    <details class="dk-help"><summary>Tier${gcOn ? ', bracket' : ''} et thèmes : comment lire</summary><p class="hint"><b>Tier</b> : popularité du commandant sur EDHREC (nombre de decks). S = les 30 plus joués, A jusqu'au 150ᵉ, B jusqu'au 500ᵉ, C jusqu'au 1 500ᵉ, D au-delà. C'est un classement de popularité, pas de puissance.${gcOn ? ' <b>Bracket</b> : estimation d\'après le nombre de Game Changers du deck (0 → 2, 1 à 3 → 3, 4 et plus → 4) ; les terrains détruits, tours supplémentaires et combos ne sont pas lus.' : ''}${(EDH.data.themeOrder || []).length ? ' <b>Thèmes</b> : le style du commandant d\'après EDHREC (contrôle, gain de vie, défausse, meule…), les mêmes pour tous ses decks, Archidekt compris. Seuls les thèmes généraux portés par au moins 1 % de ses decks sont gardés. Dans la liste complète, le nombre à côté d\'un thème = decks qui l\'ont parmi ceux qui restent avec tes autres réglages (couleurs, tier, recherche…).' : ''}</p></details>
    <div class="dk-ctl"><div class="fopts" role="group" aria-label="Classer par">${EDH_SORTS.map(([v, l]) => `<button type="button" class="fopt" data-act="dsort" data-v="${v}" aria-pressed="${EDH.sort === v}">${l}</button>`).join('')}</div>
      <div class="fopts" role="group" aria-label="Tier du commandant"><span class="dk-lbl">Tier</span>${EDH_TIER_NAMES.filter(t => tiersHave.has(t)).map(t => `<button type="button" class="fopt tier t-${t.toLowerCase()}" data-act="dtier" data-t="${t}" aria-pressed="${EDH.tiers.has(t)}" aria-label="Tier ${t}">${t}</button>`).join('')}</div>
      ${edhThemesHtml()}
      <div class="dk-row"><div class="fcols" role="group" aria-label="Couleurs permises">${COLOR_DEF.filter(c => c[0] !== 'C').map(([c, n]) => `<button type="button" class="fcol mc-${c.toLowerCase()}" data-act="dcol" data-c="${c}" aria-pressed="${EDH.cols.has(c)}" aria-label="${n}" title="${n}">${c}</button>`).join('')}</div>
        <label class="sortsel"><select data-act="dbudget" aria-label="Budget maximum à acheter">${EDH_BUDGETS.map(([v, l]) => `<option value="${v}"${EDH.budget === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="fopts"><button type="button" class="fopt" data-act="dmine" aria-pressed="${EDH.mine}">J'ai le commandant${mineN ? ` (${nf0(mineN)})` : ''}</button></div></div>`;
  return `${ctl}<div class="dk-res">${edhResHtml()}</div>`;
}
/** Résultats (résumé, liste, « Afficher plus ») : repeints seuls pendant la frappe, pour que le champ de recherche garde le focus. */
function edhResHtml() {
  const rows = edhRows(), shown = rows.slice(0, EDH.shown), near = rows.filter(r => r.miss <= 10).length, q = edhQuery(), card = EDH.qm === 'card';
  const sum = `<p class="hint dk-sum">${nf0(rows.length)} deck${rows.length > 1 ? 's' : ''} sur ${nf0(EDH.data.decks.length)}${q ? ` · ${card ? 'contenant' : 'commandant'} « ${esc(EDH.q.trim())} »` : ''}${EDH.cols.size ? ' · couleurs ⊆ ' + [...EDH.cols].join('') : ''}${EDH.tiers.size ? ' · tier ' + EDH_TIER_NAMES.filter(t => EDH.tiers.has(t)).join(' ') : ''}${EDH.themes.size ? ' · thème' + (EDH.themes.size > 1 ? 's' : '') + ' : ' + esc([...EDH.themes].map(s => { const i = EDH.data.themeIx.get(s); return i === undefined ? s : edhThemeName(EDH.data.themes[i]); }).join(' + ')) : ''}${near ? ` · <b>${nf0(near)}</b> à 10 cartes ou moins` : ''}</p>`;
  let note = '', none = 'Aucun deck ne correspond à ces réglages.';
  if (q && !card) {
    const toks = edhTokens(q), found = EDH.data.cmds.filter(c => edhCmdHas(c, toks)), has = EDH.data.withDeck || (EDH.data.withDeck = new Set(EDH.data.decks.map(d => d.cmd.slug))), nod = found.filter(c => !has.has(c.slug)).sort((a, b) => a.rank - b.rank);
    if (!found.length) none = 'Aucun commandant ne correspond à « ' + esc(EDH.q.trim()) + ' ».';
    else if (nod.length) note = `<p class="hint dk-note">Sans deck dans le fichier (fourni pour les 1 000 commandants les plus joués) : ${nod.slice(0, 6).map(c => esc(c.names.join(' + ')) + ' (n° ' + nf0(c.rank) + ')').join(', ')}${nod.length > 6 ? ' et ' + (nod.length - 6) + ' autres' : ''}.</p>`;
  } else if (q) {
    none = 'Aucun deck ne contient « ' + esc(EDH.q.trim()) + ' » avec ces réglages.';
    const cnt = new Map(); for (const r of rows) for (const [k, n] of r.hit) { const e = cnt.get(k); if (e) e[1]++; else cnt.set(k, [n, 1]); }
    const top = [...cnt.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (top.length) note = `<p class="hint dk-note">Cartes trouvées : ${top.slice(0, 5).map(([n, c]) => '<b>' + esc(n) + '</b> (' + nf0(c) + ')').join(', ')}${top.length > 5 ? ' et ' + (top.length - 5) + ' autres' : ''}.</p>`;
  } else if (EDH.qm === 'card' && edhTokens(EDH.q).length) note = '<p class="hint dk-note">Tape au moins 2 lettres.</p>';
  return `${sum}${note}${shown.length ? `<div class="coll-list">${shown.map((r, i) => edhRowHtml(r, i)).join('')}</div>` : `<p class="hint listempty">${none}</p>`}
    ${rows.length > shown.length ? `<button class="btn ghost block coll-more" type="button" data-act="dmore">Afficher ${nf0(Math.min(30, rows.length - shown.length))} de plus · ${nf0(rows.length - shown.length)} restants</button>` : ''}`;
}
function edhRowHtml(r, i) {
  const c = r.cmd, name = c.names.join(' + '), img = (ownLangImg(c.keys[0]) || {}).src || c.img || (COLL.meta[c.keys[0]] && COLL.meta[c.keys[0]].im) || '', pct = Math.round(100 * (r.have - r.eng) / r.total), pe = Math.min(100 - pct, Math.round(100 * r.eng / r.total));      // bleu : possédées et libres · orange : possédées mais engagées dans un deck monté
  const tags = [`<span class="dk-pips">${edhPips(c.ci)}</span>`]; if (c.rank) tags.push(`<span class="tag" title="Rang de popularité du commandant sur EDHREC">n° ${nf0(c.rank)}</span>`); if (c.decks) tags.push(`<span class="tag">${nf0(c.decks)} decks</span>`);
  tags.push(`<span class="tag${r.deck.src === 'edhrec' ? '' : ' accent'}">${r.deck.src === 'edhrec' ? 'Deck moyen' : esc(edhSrcLabel(r.deck))}</span>`);
  if (r.br) tags.push(`<span class="tag${r.br >= 4 ? ' warn' : ''}" title="${esc(edhBracketNote(r))}">Bracket ${r.br}</span>`);
  if (r.mine) tags.push('<span class="tag good">Commandant possédé</span>');
  const right = r.miss ? `<b>${nf0(r.miss)}</b><small>à acheter</small><em>${r.cost ? '≈ ' + esc(fmt(r.cost, 'EUR')) : 'prix inconnu'}</em>${r.cost && r.unpriced ? `<small>+ ${nf0(r.unpriced)} sans prix</small>` : ''}` : '<b class="ok">✓</b><small>complet</small>';
  return `<div class="crow dk" role="button" tabindex="0" data-dk="${i}" aria-label="${esc(name)} : tier ${esc(r.tier)}, ${r.have} cartes sur ${r.total}${r.eng ? ' (dont ' + r.eng + ' engagée' + (r.eng > 1 ? 's' : '') + ' dans un deck)' : ''}, ${r.miss} à acheter">${r.tier ? `<i class="dk-tier t-${esc(r.tier.toLowerCase())}" aria-hidden="true">${esc(r.tier)}</i>` : ''}<span class="thumb" style="--h:${hash32(c.slug) % 360}">${esc((name.trim()[0] || '?').toUpperCase())}${img ? `<img alt="" loading="lazy" decoding="async" src="${esc(img)}">` : ''}</span>
    <span class="row-main"><span class="row-name">${esc(name)}</span><span class="row-meta">${tags.join('')}</span><span class="dk-bar" aria-hidden="true"><i style="width:${pct}%"></i>${r.eng ? `<i class="eng" style="width:${pe}%"></i>` : ''}</span><span class="dk-have">${nf0(r.have)} / ${nf0(r.total)} possédées${r.eng ? ` <em class="dk-eng" title="Exemplaires déjà réservés par un de tes decks complets">· dont ${nf0(r.eng)} engagée${r.eng > 1 ? 's' : ''}</em>` : ''}</span>${c.th.length ? `<span class="dk-th">${c.th.slice(0, 3).map(([i, n]) => { const t = EDH.data.themes[i]; return EDH.themes.has(t.slug) ? '<b>' + esc(edhThemeName(t)) + '</b>' : esc(edhThemeName(t)); }).join(' · ')}</span>` : ''}${r.deck.src !== 'edhrec' && r.deck.label ? `<span class="dk-lab">${esc(r.deck.label)}</span>` : ''}${r.hit ? `<span class="dk-lab dk-hitl">Contient : ${esc(r.hit.slice(0, 2).map(h => h[1]).join(' · '))}${r.hit.length > 2 ? ' +' + (r.hit.length - 2) : ''}</span>` : ''}</span>
    <span class="row-px dk-px">${right}</span></div>`;
}

/** Petites images des cartes d'un deck : ta collection d'abord, puis la mémoire / le cache de l'appareil, puis Scryfall (75 noms par requête, une seule fois par carte). entries : [[clé, nom]] · seed : Map clé → url déjà connue. Retourne Map clé → url. */
async function edhImages(entries, seed) {
  if (!EDH.im) {
    EDH.im = new Map();
    try { const o = await Cache.get(EDH_IM_KEY, 90 * DAY); if (o && typeof o === 'object' && !Array.isArray(o)) for (const k in o) EDH.im.set(k, o[k]); } catch (e) { /* cache absent */ }
  }
  const out = new Map(), need = [];
  for (const [k, n] of entries) {
    const own = (ownLangImg(k) || {}).src || (COLL.meta[k] && COLL.meta[k].im), sd = seed && seed.get(k), cached = EDH.im.get(k), u = own || sd || (cached ? EDH_SMALL + cached : '');
    if (u) out.set(k, u); else if (cached === undefined) need.push([k, n]);
  }
  if (need.length && !scryLeft()) {
    try {
      const got = await scryCollection(need.map(x => x[1]));
      for (const [k] of need) { const g = got.get(k), m = g && g.im ? /\/small\/([^?]+)/.exec(g.im) : null; EDH.im.set(k, m ? m[1] : ''); if (m) out.set(k, EDH_SMALL + m[1]); }
      Cache.set(EDH_IM_KEY, Object.fromEntries(EDH.im));
    } catch (e) { /* hors ligne ou Scryfall en pause : pas d'aperçu pour l'instant, on réessaiera à la prochaine ouverture */ }
  }
  return out;
}
function edhPaintThumbs(root, m) {
  for (const th of $$('.thumb[data-ik]', root)) { const u = m.get(th.dataset.ik); if (u && !$('img', th)) { const im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.src = u; th.appendChild(im); } }
}
const edhBracketNote = r => `Bracket estimé ${r.br} : ${r.gc.length ? r.gc.length + ' Game Changer' + (r.gc.length > 1 ? 's' : '') + ' (' + r.gc.join(', ') + ')' : 'aucun Game Changer'}. Estimation : terrains détruits, tours supplémentaires et combos ne sont pas lus.`;

/** Feuille d'un deck : cartes à acheter (les plus chères d'abord), déjà possédées, aperçu de chaque carte (appui = en grand, glisser = carte suivante) et deux actions. */
function openEdhDeck(r) {
  const c = r.cmd, name = c.names.join(' + '), url = r.deck.url || (r.deck.src === 'edhrec' ? 'https://edhrec.com/average-decks/' + encodeURIComponent(c.slug) : '');
  openSheet(name, `${r.tier ? 'Tier ' + r.tier + ' · n° ' + nf0(r.rank) + ' · ' : ''}${nf0(r.have)} / ${nf0(r.total)} possédées${r.eng ? ` (dont ${nf0(r.eng)} engagée${r.eng > 1 ? 's' : ''})` : ''} · ${edhSrcLabel(r.deck)}`, api => {
    const row = (x, own) => {
      const tg = (c.keys.includes(x.k) ? '<span class="tag accent">Commandant</span>' : '') + (own && x.eg ? `<span class="tag warn" title="Déjà réservé par un de tes decks complets">dont ${x.eg} engagée${x.eg > 1 ? 's' : ''}</span>` : '') + (x.gc ? '<span class="tag warn" title="Liste Game Changers (brackets Commander)">Game Changer</span>' : '');
      const ex = own ? 'Dans ta collection' + (x.q > 1 ? ' · × ' + x.q : '') + (x.eg ? ' · dont ' + x.eg + ' engagée' + (x.eg > 1 ? 's' : '') : '') : 'À acheter' + (x.q > 1 ? ' × ' + x.q : '') + (x.u ? ' · ≈ ' + fmt(x.u * x.q, 'EUR') : '');
      return `<div class="crow ro dk-card" role="button" tabindex="0" data-ik="${esc(x.k)}" data-nm="${esc(x.n)}" data-ex="${esc(ex)}" aria-label="${esc(x.n)} : voir en grand"><span class="thumb" data-ik="${esc(x.k)}" style="--h:${hash32(x.k) % 360}">${esc((x.n.trim()[0] || '?').toUpperCase())}</span><span class="row-main"><span class="row-name">${esc(x.n)}</span>${tg ? `<span class="row-meta">${tg}</span>` : ''}</span><span class="row-price"><b>${own ? '✓' : x.u ? esc(fmt(x.u * x.q, 'EUR')) : '—'}</b>${x.q > 1 ? `<small>× ${x.q}${!own && x.u ? ' · ' + esc(fmt(x.u, 'EUR')) : ''}</small>` : ''}</span></div>`;
    };
    const cmdSet = new Set(c.keys), byK = new Map([...r.missing.map(x => [x.k, [x, false]]), ...r.owned.map(x => [x.k, [x, true]])]);
    const hitSet = new Set((r.hit || []).map(h => h[0]).filter(k => !cmdSet.has(k))), hitRows = [...hitSet].map(k => byK.get(k)).filter(Boolean);      // cartes cherchées : juste sous le commandant
    const cmdRows = c.keys.map(k => byK.get(k)).filter(Boolean), buy = r.missing.filter(x => !cmdSet.has(x.k) && !hitSet.has(x.k)), have = r.owned.filter(x => !cmdSet.has(x.k) && !hitSet.has(x.k));      // le commandant est toujours en tête, avec son prix ou ✓
    const lvl = [r.tier ? `Tier ${esc(r.tier)} · n° ${nf0(r.rank)} sur EDHREC` : '', r.br ? `<span title="${esc(edhBracketNote(r))}">bracket ≈ ${r.br}${r.gc.length ? ' · ' + r.gc.length + ' Game Changer' + (r.gc.length > 1 ? 's' : '') : ''}</span>` : ''].filter(Boolean).join(' · ');
    api.body.innerHTML = `<div class="ci-sum"><div><b>${nf0(r.miss)}</b> carte${r.miss > 1 ? 's' : ''} à acheter${r.cost ? ' · ≈ <b>' + esc(fmt(r.cost, 'EUR')) + '</b>' : ''}</div><span>${r.unpriced ? `${r.unpriced} sans prix connu · ` : ''}${c.decks ? nf0(c.decks) + ' decks EDHREC · ' : ''}couleurs ${esc(c.ci || 'incolore')}</span>${lvl ? `<span>${lvl}</span>` : ''}${c.th.length ? `<details class="ci-thd"><summary title="Nombre de decks EDHREC du commandant qui ont ce thème">Thèmes EDHREC : ${c.th.map(([i, n]) => esc(edhThemeName(EDH.data.themes[i])) + ' (' + nf0(n) + ')').join(' · ')}</summary><dl class="ci-thl">${c.th.map(([i]) => { const t = EDH.data.themes[i], inf = edhThemeInfo(t); return `<dt>${esc(edhThemeName(t))}</dt>${inf ? `<dd>${edhInfoHtml(inf)}</dd>` : ''}`; }).join('')}</dl></details>` : ''}</div>
      ${cmdRows.length ? `<h3 class="cs-h">${cmdRows.length > 1 ? 'Commandants' : 'Commandant'}</h3><div class="cs-top dk-cmd">${cmdRows.map(([x, o]) => row(x, o)).join('')}</div>` : ''}
      ${hitRows.length ? `<h3 class="cs-h">${hitRows.length > 1 ? 'Cartes cherchées' : 'Carte cherchée'}</h3><div class="cs-top dk-hit">${hitRows.map(([x, o]) => row(x, o)).join('')}</div>` : ''}
      ${buy.length ? `<h3 class="cs-h">À acheter <small>${nf0(buy.length)} cartes</small></h3><div class="cs-top dk-miss">${buy.map(x => row(x, false)).join('')}</div>` : r.miss ? '' : '<p class="hint">Tu as déjà toutes les cartes de ce deck.</p>'}
      ${have.length ? `<details class="dk-own" open><summary>Déjà dans ta collection (${nf0(have.length)})</summary><div class="cs-top dk-have-l">${have.map(x => row(x, true)).join('')}</div></details>` : ''}
      <p class="hint dk-tap">Touche une carte pour la voir en grand.</p>`;
    let imgs = new Map(), settled = false;
    api.body.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
    api.body.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
    const seed = new Map(); if (c.img) seed.set(c.keys[0], c.img);
    edhImages([...r.missing, ...r.owned].map(x => [x.k, x.n]), seed).then(m => { imgs = m; settled = true; if (api.wrap.isConnected) edhPaintThumbs(api.body, m); });
    const open = rw => {
      const u = imgs.get(rw.dataset.ik); if (!u) { toast(settled ? 'Pas d\'aperçu pour cette carte' : 'Aperçus en cours de chargement…'); return; }
      const items = []; let at = 0;
      for (const x of $$('.crow[data-ik]', api.body)) { const v = imgs.get(x.dataset.ik); if (!v) continue; if (x === rw) at = items.length; items.push({ key: x.dataset.ik, name: x.dataset.nm, wl: viewLang(x.dataset.ik, !!x.closest('.dk-have-l')), small: v, lang: 'en', plain: true, extra: x.dataset.ex }); }
      haptic('tap'); openCardViewer(items, at);
    };
    api.body.addEventListener('click', e => { const rw = e.target.closest('.crow[data-ik]'); if (rw) open(rw); });
    api.body.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.crow[data-ik]')) { e.preventDefault(); open(e.target); } });
    api.setFoot(`${url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.deck.src === 'edhrec' ? 'EDHREC' : 'Voir le deck')} ↗</a>` : '<button class="btn ghost" type="button" data-close>Fermer</button>'}<button class="btn" type="button" id="dkGo">${r.miss ? 'Chercher les manquantes' : 'Charger le deck'}</button>`);
    $('#dkGo', api.foot).onclick = () => { api.close(); edhUseDeck(r); };
  });
}
/** Charge le deck dans la page de saisie, collection déduite : la recherche ne porte que sur les cartes manquantes. */
function edhUseDeck(r) {
  haptic('ok'); closeCollection();
  S.useColl = true; try { $('#optColl').checked = true; saveStore(); } catch (e) { /* ignore */ }
  putDeckText(edhDeckText(r.deck), r.cmd.names.join(' + '));
}
/** Clics de l'onglet « Decks » (appelé depuis l'écran de la collection). Retourne true si le clic était pour lui. */
function edhClick(e) {
  const row = e.target.closest('.crow.dk');
  if (row) { const r = edhRows()[Number(row.dataset.dk)]; if (r) { haptic('tap'); openEdhDeck(r); } return true; }
  const b = e.target.closest('button[data-act]'); if (!b) return false;
  const act = b.dataset.act;
  if (act === 'dsort') { if (EDH.sort !== b.dataset.v) { EDH.sort = b.dataset.v; EDH.shown = 30; haptic('tap'); collPaintBody(true); } }
  else if (act === 'dcol') { const c = b.dataset.c; if (EDH.cols.has(c)) EDH.cols.delete(c); else EDH.cols.add(c); EDH.shown = 30; haptic('tap'); collPaintBody(true); }
  else if (act === 'dtier') { const t = b.dataset.t; if (EDH.tiers.has(t)) EDH.tiers.delete(t); else EDH.tiers.add(t); EDH.shown = 30; haptic('tap'); collPaintBody(true); }
  else if (act === 'dth') { const t = b.dataset.s; if (EDH.themes.has(t)) EDH.themes.delete(t); else EDH.themes.add(t); EDH.shown = 30; haptic('tap'); collPaintBody(true); }
  else if (act === 'dthall') { haptic('tap'); openEdhThemes(); }
  else if (act === 'dmine') { EDH.mine = !EDH.mine; EDH.shown = 30; haptic('tap'); collPaintBody(true); }
  else if (act === 'dqm') { if (EDH.qm !== b.dataset.v) { EDH.qm = b.dataset.v; EDH.shown = 30; haptic('tap'); collPaintBody(true); const i = $('#dkQ', COLL.el); if (i && EDH.q) i.focus({ preventScroll: true }); } }
  else if (act === 'dqx') { EDH.q = ''; EDH.shown = 30; collPaintBody(true); const i = $('#dkQ', COLL.el); if (i) i.focus({ preventScroll: true }); }
  else if (act === 'dmore') { EDH.shown += 30; collPaintBody(true); }
  else if (act === 'dretry') edhRetry();
  else return false;
  return true;
}
/** Frappe dans le champ de recherche des decks : seuls les résultats sont repeints (le champ garde le focus). Retourne true si l'événement était pour lui. */
let edhQT = 0;
function edhInput(e) {
  const i = e.target && e.target.closest && e.target.closest('#dkQ'); if (!i) return false;
  EDH.q = i.value; EDH.shown = 30; const x = $('.fclear', i.parentNode); if (x) x.hidden = !i.value;
  clearTimeout(edhQT); edhQT = setTimeout(() => { const res = COLL.el && $('.dk-res', COLL.el); if (res && EDH.data) { res.innerHTML = edhResHtml(); edhThemesSync(); } }, 120);
  return true;
}
/** Filtre « Joués en commandant » sans données : chargement en cours, ou erreur avec repli sur « Peuvent l'être ». */
function edhWaitHtml() {
  return EDH.err ? `<div class="dv-empty"><b>Commandants EDHREC indisponibles</b><p>${esc(EDH.err)}</p><div class="coll-cta"><button class="btn ghost" type="button" data-act="dretry">Réessayer</button><button class="btn ghost" type="button" data-act="dcan">Voir ceux qui peuvent l'être</button></div></div>`
    : '<p class="hint listempty">Chargement des commandants EDHREC…</p>';
}
