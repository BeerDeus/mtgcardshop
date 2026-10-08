package app.manaorbit;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.os.Build;
import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;
import org.json.JSONObject;

/**
 * Valeur du widget tenue à jour appli fermée (JobScheduler, API du système : aucune dépendance ajoutée).
 * Toutes les ~12 h, avec du réseau : télécharge le fichier de prix du serveur (/prices.tsv, ≈ 400 Ko compressé, une fois par jour au plus
 * en données mobiles), recalcule le total des cartes envoyées par le site (setWidget, champ coll : [clé, exemplaires, prix de référence])
 * et applique son évolution à la dernière valeur de l'appli : le chiffre reste cohérent avec l'appli, marqué « estimée ».
 * Rien n'est planifié sans widget posé ni liste de cartes ; tout échec est silencieux (le widget garde ses chiffres et affiche leur âge).
 */
public class ValueRefreshJob extends JobService {

    /** Interrupteur : false → aucune tâche, le widget n'affiche que les chiffres envoyés par l'appli (le site n'envoie plus la liste de cartes). */
    static final boolean ENABLED = true;
    /** Identifiant de la tâche : loin des numéros pris par WorkManager (0, 1, 2…) qu'utilisent des bibliothèques de l'appli. */
    static final int JOB_ID = 0x4D6F5752;
    static final String PREFS = "mana_orbit_widget_bg";
    static final String KEY_COLL = "coll";
    private static final String KEY_ETAG = "etag";
    private static final String KEY_CHECK = "check";
    private static final String PRICES_URL = "https://card.m2s-photo.fr/prices.tsv";
    private static final long HOUR = 3_600_000L;
    private static final long PERIOD = 12 * HOUR;
    private static final long FLEX = 3 * HOUR;
    /** Écart minimal depuis les derniers chiffres frais (envoi du site ou fichier relu) : 11 h en Wi-Fi, 44 h en données mobiles. */
    private static final long EVERY = 11 * HOUR;
    private static final long EVERY_METERED = 44 * HOUR;
    /** Liste de cartes plus longue : refusée (le site en envoie 1 500 au plus, ≈ 50 Ko). */
    private static final int MAX_COLL = 400_000;

    private final AtomicBoolean stopped = new AtomicBoolean(false);

    /** Liste de cartes du dernier envoi du site (JSON { pa: date du fichier de prix, c: [[clé, q, prix]] }) ; null ou illisible : effacée. */
    static void store(Context context, String coll) {
        try {
            SharedPreferences.Editor e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_ETAG);
            boolean ok = false;
            if (ENABLED && coll != null && !coll.isEmpty() && coll.length() <= MAX_COLL) {
                try {
                    JSONObject o = new JSONObject(coll);
                    ok = o.optJSONArray("c") != null;
                } catch (Exception x) {
                    ok = false;
                }
            }
            if (ok) e.putString(KEY_COLL, coll);
            else e.remove(KEY_COLL);
            e.apply();
        } catch (Throwable t) {
            // stockage indisponible : pas d'estimation
        }
    }

    /** Planifie la tâche s'il y a un widget posé et une liste de cartes, l'annule sinon. Sans effet si elle est déjà planifiée (sa cadence est gardée). */
    static void sync(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            boolean want = ENABLED && ValueWidget.count(context) > 0
                && context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains(KEY_COLL);
            JobInfo cur = js.getPendingJob(JOB_ID);
            if (!want) {
                if (cur != null) js.cancel(JOB_ID);
                return;
            }
            if (cur != null) return;
            JobInfo.Builder b = new JobInfo.Builder(JOB_ID, new ComponentName(context, ValueRefreshJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD, FLEX);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setRequiresBatteryNotLow(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) b.setEstimatedNetworkBytes(500_000L, 1_000L);
            js.schedule(b.build());
        } catch (Throwable t) {
            // planification refusée : le widget garde les chiffres de l'appli
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        stopped.set(false);
        try {
            final Context app = getApplicationContext();
            new Thread(() -> {
                try {
                    refresh(app);
                } catch (Throwable t) {
                    // réseau, fichier, mémoire : on réessaiera à la prochaine échéance
                }
                ValueWidget.refreshAll(app);                      // même sans nouveau prix : l'âge affiché avance
                try {
                    jobFinished(params, false);
                } catch (Throwable t) {
                    // tâche déjà arrêtée par le système
                }
            }, "ManaOrbitWidget").start();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        stopped.set(true);
        return false;                                              // tâche périodique : la prochaine échéance suffit
    }

    private void refresh(Context ctx) throws Exception {
        SharedPreferences bg = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences wp = ctx.getSharedPreferences(ValueWidget.PREFS, Context.MODE_PRIVATE);
        String collRaw = bg.getString(KEY_COLL, null), dataRaw = wp.getString(ValueWidget.KEY, null);
        if (collRaw == null || dataRaw == null) return;
        JSONObject data = new JSONObject(dataRaw);
        long v0 = data.optLong("v", 0), at = data.optLong("at", 0), now = System.currentTimeMillis();
        if (v0 <= 0 || at <= 0 || data.optInt("n", 0) <= 0) return;
        // chiffres encore frais (appli ouverte récemment, ou fichier déjà relu) : rien à télécharger ; Wi-Fi de préférence
        long fresh = Math.max(at, bg.getLong(KEY_CHECK, 0));
        if (now - fresh < (metered(ctx) ? EVERY_METERED : EVERY)) return;
        JSONObject coll = new JSONObject(collRaw);
        Map<String, long[]> items = WidgetPrices.items(coll.optJSONArray("c"));
        if (items.isEmpty()) return;

        HttpURLConnection c = (HttpURLConnection) new URL(PRICES_URL).openConnection();
        try {
            c.setConnectTimeout(20_000);
            c.setReadTimeout(30_000);
            c.setRequestProperty("Accept-Encoding", "gzip");
            c.setRequestProperty("User-Agent", "ManaOrbit-widget/1 (Android)");
            String etag = bg.getString(KEY_ETAG, null);
            if (etag != null) c.setRequestProperty("If-None-Match", etag);
            int code = c.getResponseCode();
            if (code == HttpURLConnection.HTTP_NOT_MODIFIED) {           // même fichier que la dernière fois : estimation déjà faite
                bg.edit().putLong(KEY_CHECK, now).apply();
                return;
            }
            if (code != HttpURLConnection.HTTP_OK) return;
            String day;
            try (BufferedReader r = reader(c.getInputStream())) {
                day = WidgetPrices.read(r, items, stopped);
            }
            if (day == null) return;
            SharedPreferences.Editor e = bg.edit().putLong(KEY_CHECK, now);
            String tag = c.getHeaderField("ETag");
            if (tag != null && tag.length() < 200) e.putString(KEY_ETAG, tag);
            e.apply();
            if (day.equals(coll.optString("pa", ""))) return;             // le fichier dont l'appli s'est servie : rien n'a bougé
            long est = WidgetPrices.estimate(v0, items);
            if (est <= 0) return;
            if (!dataRaw.equals(wp.getString(ValueWidget.KEY, null))) return;     // le site a renvoyé ses chiffres entre-temps : ils priment
            ValueWidget.saveEstimate(ctx, at, est, now);
        } finally {
            c.disconnect();
        }
    }

    /** Corps de la réponse : gzip (demandé, comme le sert le serveur) ou texte brut si un intermédiaire l'a décompressé. */
    private static BufferedReader reader(InputStream raw) throws Exception {
        InputStream in = new BufferedInputStream(raw, 16_384);
        in.mark(2);
        int b0 = in.read(), b1 = in.read();
        in.reset();
        if (b0 == 0x1f && b1 == 0x8b) in = new GZIPInputStream(in, 16_384);
        return new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8), 16_384);
    }

    /** Réseau facturé au volume (données mobiles, partage de connexion) ; inconnu : on le suppose. */
    private static boolean metered(Context ctx) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            return cm == null || cm.isActiveNetworkMetered();
        } catch (Throwable t) {
            return true;
        }
    }
}
