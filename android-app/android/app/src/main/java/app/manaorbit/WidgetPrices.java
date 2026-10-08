package app.manaorbit;

import java.io.BufferedReader;
import java.io.IOException;
import java.text.Normalizer;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONArray;

/**
 * Estimation de la valeur du widget appli fermée, d'après le fichier de prix du serveur (prices.tsv, gen-prices.mjs) :
 * « #MOPX1 date nombre », puis « nom \t centimes € \t centimes $ » (prix « à partir de », l'impression la moins chère).
 * Ce fichier ne donne pas les mêmes prix que l'appli (impression par défaut de Scryfall) : on n'en garde que l'évolution (rapport),
 * appliquée à la dernière valeur de l'appli. Java pur (aucune classe Android) : testable hors de l'appareil.
 */
final class WidgetPrices {

    private WidgetPrices() {}

    private static final Pattern MARKS = Pattern.compile("[\u0300-\u036F]");
    private static final Pattern APOS = Pattern.compile("['\u2019\u2018`\u00B4]");
    private static final Pattern NON_ALNUM = Pattern.compile("[^a-z0-9]+");
    /** Garde-fous : une ligne plus longue ou un fichier plus grand n'est pas un fichier de prix. */
    private static final int MAX_LINE = 400;
    private static final int MAX_LINES = 400_000;

    /** normPart de core.js : æ/œ dépliés, accents retirés, minuscules, apostrophes supprimées, le reste des signes → espace. */
    static String part(String s) {
        String x = s.replace("\u00E6", "ae").replace("\u00C6", "ae").replace("\u0153", "oe").replace("\u0152", "oe");
        x = Normalizer.normalize(x, Normalizer.Form.NFD);
        x = MARKS.matcher(x).replaceAll("");
        x = x.toLowerCase(Locale.ROOT);
        x = APOS.matcher(x).replaceAll("");
        x = NON_ALNUM.matcher(x).replaceAll(" ");
        return x.trim();
    }

    /** ownKey de core.js : clé de collection d'un nom (face avant d'une carte « A // B »). */
    static String key(String name) {
        if (name == null) return "";
        for (String p : name.split("//", -1)) {
            String k = part(p);
            if (!k.isEmpty()) return k;
        }
        return "";
    }

    /** Collection envoyée par le site : [[clé, exemplaires, prix de référence en centimes], …] → clé → { q, ref, prix du jour (0 : inconnu) }. */
    static Map<String, long[]> items(JSONArray a) {
        Map<String, long[]> out = new HashMap<>();
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            JSONArray r = a.optJSONArray(i);
            if (r == null || r.length() < 3) continue;
            String k = r.optString(0, "");
            long q = r.optLong(1, 0), ref = r.optLong(2, 0);
            if (k.isEmpty() || q <= 0 || ref <= 0 || q > 100_000 || ref > 100_000_000L) continue;
            out.put(k, new long[]{q, ref, 0});
        }
        return out;
    }

    /**
     * Lit le fichier de prix et note, pour chaque carte de items, le plus bas prix en euros non nul (comme pxParse de data.js).
     * Retourne la date de l'en-tête, ou null : pas un fichier de prix, fichier anormal, ou lecture interrompue (stop).
     */
    static String read(BufferedReader r, Map<String, long[]> items, AtomicBoolean stop) throws IOException {
        String head = r.readLine();
        if (head == null || !head.startsWith("#MOPX1 ")) return null;
        String[] h = head.split(" ");
        if (h.length < 2 || h[1].isEmpty()) return null;
        String line;
        int n = 0;
        while ((line = r.readLine()) != null) {
            if (++n > MAX_LINES) return null;
            if ((n & 1023) == 0 && stop != null && stop.get()) return null;
            if (line.isEmpty() || line.length() > MAX_LINE) continue;
            int t1 = line.indexOf('\t');
            if (t1 <= 0) continue;
            int t2 = line.indexOf('\t', t1 + 1);
            if (t2 < 0) continue;                                  // « nom \t € \t $ » : trois colonnes au moins, comme pxParse
            long[] it = items.get(key(line.substring(0, t1)));
            if (it == null) continue;
            long e = cents(line.substring(t1 + 1, t2));
            if (e > 0 && (it[2] == 0 || e < it[2])) it[2] = e;
        }
        return h[1];
    }

    private static long cents(String s) {
        if (s.isEmpty() || s.length() > 9) return 0;
        try {
            return Math.max(0, Long.parseLong(s));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * Valeur estimée : v0 × (somme des prix du jour / somme des prix de référence), sur les cartes qui ont les deux.
     * -1 si ces cartes pèsent moins de la moitié de la valeur de référence, ou si le rapport sort de [0,5 ; 2] (fichier douteux).
     */
    static long estimate(long v0, Map<String, long[]> items) {
        double all = 0, ref = 0, cur = 0;
        for (long[] it : items.values()) {
            all += (double) it[0] * it[1];
            if (it[2] <= 0) continue;
            ref += (double) it[0] * it[1];
            cur += (double) it[0] * it[2];
        }
        if (v0 <= 0 || ref <= 0 || ref < all / 2) return -1;
        double k = cur / ref;
        if (k < 0.5 || k > 2) return -1;
        return Math.round(v0 * k);
    }
}
