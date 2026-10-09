package app.manaorbit;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget d'écran d'accueil « Ma collection » : valeur, variation, ancienneté des chiffres, courbe et un bouton (Scanner ou Prix rapide).
 * Les chiffres viennent du site (setWidget du plugin ManaOrbit, gardés dans SharedPreferences) ; appli fermée, ValueRefreshJob peut
 * les estimer d'après le fichier de prix du serveur (valeur précédée de « ≈ », mention « estimée » jusqu'au prochain envoi du site).
 * Quatre mises en page : 2 × 1 (valeur, variation), 4 × 1 (+ bouton), 2 × 2 (titre, cartes, bouton rond), 4 × 2 et plus (+ courbe).
 * Redessiné à chaque envoi du site, après chaque estimation, quand le lanceur le demande, et toutes les 6 h (updatePeriodMillis : âge affiché).
 * Langue et format des nombres : ceux de l'appli (champ lang) ; sans données, la langue du téléphone.
 */
public class ValueWidget extends AppWidgetProvider {

    static final String PREFS = "mana_orbit_widget";
    static final String KEY = "data";
    /** Estimation appli fermée (ValueRefreshJob) : { base: « at » des données du site, v, at, p: [[t, v], …] } ; ignorée dès que le site renvoie. */
    static final String KEY_EST = "est";
    /** Extra de l'intent du widget : vue du site à ouvrir (relayée par ManaOrbitPlugin, événement « open ») : collection, scan ou quick. */
    static final String EXTRA_OPEN = "app.manaorbit.open";

    private static final int COLOR_UP = 0xFF4FD1A1;
    private static final int COLOR_DOWN = 0xFFFF8091;
    private static final int COLOR_FLAT = 0xFFA9B3CF;
    private static final int COLOR_DIM = 0xFF8F98B8;
    private static final long DAY = 86_400_000L;
    /** Chiffres plus vieux : « il y a 3 j » à côté (même arrondi que pxAgo de l'appli). */
    private static final long STALE = 36 * 3_600_000L;
    private static final long CHART_SPAN = 30 * DAY;
    private static final int MAX_POINTS = 40;

    /** Tailles (dp) des mises en page : complète à partir de deux rangées, large à partir de quatre colonnes. */
    private static final float FULL_W = 100f;
    private static final float FULL_H = 120f;
    private static final float WIDE_W = 250f;
    private static final int SMALL = 0;
    private static final int WIDE = 1;
    private static final int FULL = 2;
    private static final int LARGE = 3;

    /** Un code de PendingIntent par cible : avec FLAG_UPDATE_CURRENT, un même code réécrirait l'extra de l'autre. */
    private static final int RC_COLLECTION = 0x4D4F;
    private static final int RC_SCAN = 0x4D50;
    private static final int RC_QUICK = 0x4D51;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
        ValueRefreshJob.sync(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id);
    }

    /** Dernier widget retiré : plus d'estimation en arrière-plan. */
    @Override
    public void onDisabled(Context context) {
        ValueRefreshJob.sync(context);
    }

    /** Nombre de widgets posés. */
    static int count(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager == null ? null : manager.getAppWidgetIds(new ComponentName(context, ValueWidget.class));
            return ids == null ? 0 : ids.length;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** Redessine tous les widgets posés (après un envoi du site ou une estimation). */
    static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) return;
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, ValueWidget.class));
            if (ids != null) for (int id : ids) update(context, manager, id);
        } catch (Throwable t) {
            // jamais d'arrêt de l'appli pour un widget
        }
    }

    static void update(Context context, AppWidgetManager manager, int id) {
        try {
            Snap s = Snap.read(context);
            // taille en portrait (largeur mini, hauteur maxi) : 0 tant que le lanceur ne l'a pas donnée → taille par défaut, 4 × 2
            Bundle o = manager.getAppWidgetOptions(id);
            int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            RemoteViews views;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12 et plus : le lanceur prend la mise en page la plus proche de la taille réelle, à chaque taille et orientation
                Map<SizeF, RemoteViews> sizes = new HashMap<>();
                sizes.put(new SizeF(40f, 40f), build(context, s, SMALL, w, h));
                sizes.put(new SizeF(WIDE_W, 40f), build(context, s, WIDE, w, h));
                sizes.put(new SizeF(FULL_W, FULL_H), build(context, s, FULL, w, h));
                sizes.put(new SizeF(WIDE_W, FULL_H), build(context, s, LARGE, w, h));
                views = new RemoteViews(sizes);
            } else {
                boolean tall = h == 0 || h >= FULL_H, wide = w == 0 || w >= WIDE_W;
                views = build(context, s, tall ? (wide ? LARGE : FULL) : (wide ? WIDE : SMALL), w, h);
            }
            manager.updateAppWidget(id, views);
        } catch (Throwable t) {
            try {
                manager.updateAppWidget(id, fallback(context));
            } catch (Throwable ignored) {
                // le lanceur garde l'affichage précédent
            }
        }
    }

    private static int layout(int kind) {
        switch (kind) {
            case WIDE: return R.layout.widget_value_wide;
            case FULL: return R.layout.widget_value;
            case LARGE: return R.layout.widget_value_large;
            default: return R.layout.widget_value_small;
        }
    }

    private static RemoteViews build(Context context, Snap s, int kind, int wDp, int hDp) {
        Resources res = localized(context, s.lang);
        RemoteViews v = new RemoteViews(context.getPackageName(), layout(kind));
        boolean big = kind == FULL || kind == LARGE;
        v.setOnClickPendingIntent(android.R.id.background, open(context, "collection", RC_COLLECTION));
        if (kind != SMALL) {
            // le bouton : choisi dans l'appli (Réglages › Widget), « Scanner » par défaut
            boolean quick = "quick".equals(s.btn);
            String label = res.getString(quick ? R.string.widget_btn_quick : R.string.widget_btn_scan);
            v.setOnClickPendingIntent(R.id.widget_btn, quick ? open(context, "quick", RC_QUICK) : open(context, "scan", RC_SCAN));
            v.setImageViewResource(R.id.widget_btn_icon, quick ? R.drawable.widget_ic_quick : R.drawable.widget_ic_scan);
            v.setContentDescription(R.id.widget_btn, label);
            if (kind != FULL) v.setTextViewText(R.id.widget_btn_label, label);
        }
        if (big) v.setTextViewText(R.id.widget_title, res.getString(R.string.widget_title));
        if (s.n <= 0) {
            String empty = res.getString(R.string.widget_empty);
            v.setViewVisibility(R.id.widget_value, View.GONE);
            v.setViewVisibility(R.id.widget_delta, View.GONE);
            if (big) v.setViewVisibility(R.id.widget_count, View.GONE);
            if (kind == LARGE) v.setViewVisibility(R.id.widget_chart_box, View.GONE);
            v.setTextViewText(R.id.widget_empty, empty);
            v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            v.setContentDescription(android.R.id.background, empty);
            return v;
        }
        Locale loc = locale(s.lang);
        String value = (s.est ? "\u2248\u00A0" : "") + eur(s.v, loc, s.lang);
        v.setViewVisibility(R.id.widget_empty, View.GONE);
        v.setTextViewText(R.id.widget_value, value);
        v.setViewVisibility(R.id.widget_value, View.VISIBLE);

        // variation : ▲ +12 € / ▼ −8 € (U+2212) / ± 0 € sous 1 €, et sa durée en jours (7 j, ou la période du prix de marché)
        String delta = null;
        int color = COLOR_FLAT;
        if (s.d != null) {
            boolean flat = Math.abs(s.d) < 100;
            String amount = flat ? "\u00B1\u00A0" + eur(0, loc, s.lang) : (s.d < 0 ? "\u25BC \u2212" : "\u25B2 +") + eur(Math.abs(s.d), loc, s.lang);
            delta = res.getString(R.string.widget_delta, amount, s.dd);
            color = flat ? COLOR_FLAT : s.d < 0 ? COLOR_DOWN : COLOR_UP;
        }
        // note grise, sur la ligne des cartes (2 × 2, 4 × 2) ou à la suite de la variation (une rangée) : « il y a 3 j » (chiffres de plus de 36 h),
        // sinon « estimée » (le « ≈ » de la valeur le dit déjà : une seule mention, qui tient même en anglais dans la colonne du 4 × 2)
        String age = age(res, s, System.currentTimeMillis()), estimated = s.est ? res.getString(R.string.widget_estimated) : "";
        String note = age.isEmpty() ? estimated : age;
        String cards = res.getQuantityString(R.plurals.widget_cards, s.n, NumberFormat.getIntegerInstance(loc).format(s.n));
        if (big) {
            setLine(v, R.id.widget_delta, delta, "", color);
            v.setTextViewText(R.id.widget_count, withNote(cards, note));
            v.setViewVisibility(R.id.widget_count, View.VISIBLE);
        } else if (kind == SMALL && !age.isEmpty()) {
            setLine(v, R.id.widget_delta, null, age, color);          // 2 × 1 : pas la place pour les deux, l'âge des chiffres prime sur leur variation
        } else {
            setLine(v, R.id.widget_delta, delta, note, color);
        }
        if (kind == LARGE) chart(context, res, v, s, wDp, hDp);
        String a11y = res.getString(R.string.widget_a11y, value, cards) + (delta == null ? "" : ", " + delta)
            + (estimated.isEmpty() ? "" : ", " + estimated) + (age.isEmpty() ? "" : ", " + age);
        v.setContentDescription(android.R.id.background, a11y);
        return v;
    }

    /** Ligne de variation : texte coloré, suivi de la note grise ; cachée s'il n'y a ni l'un ni l'autre. */
    private static void setLine(RemoteViews v, int id, String text, String note, int color) {
        if (text == null && note.isEmpty()) {
            v.setViewVisibility(id, View.GONE);
            return;
        }
        v.setTextViewText(id, withNote(text, note));
        v.setTextColor(id, text == null ? COLOR_DIM : color);
        v.setViewVisibility(id, View.VISIBLE);
    }

    private static CharSequence withNote(String head, String note) {
        if (note.isEmpty()) return head;
        SpannableStringBuilder b = new SpannableStringBuilder();
        if (head != null) b.append(head);
        int from = b.length();
        if (head != null) b.append(" \u00B7 ");
        b.append(note);
        b.setSpan(new ForegroundColorSpan(COLOR_DIM), from, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return b;
    }

    /** « il y a 3 j » si les chiffres (de l'appli, ou de la dernière estimation) ont plus de 36 h ; sinon rien. */
    private static String age(Resources res, Snap s, long now) {
        long ref = s.est ? s.estAt : s.at;
        return ref > 0 && now - ref > STALE ? res.getString(R.string.widget_age, (int) Math.round((now - ref) / (double) DAY)) : "";
    }

    /** Courbe du grand widget, à la taille de sa place (largeur et hauteur du widget en portrait, moins le reste de la mise en page). */
    private static void chart(Context context, Resources res, RemoteViews v, Snap s, int wDp, int hDp) {
        float cw = Math.max(80f, ((wDp > 0 ? wDp : 300) - 28) * 0.53f - 10f);
        float ch = Math.max(36f, (hDp > 0 ? hDp : 150) - 66f);
        Bitmap bm = s.pt.length >= 2 ? WidgetChart.draw(s.pt, s.pv, s.pe, cw, ch, context.getResources().getDisplayMetrics().density) : null;
        v.setViewVisibility(R.id.widget_chart_box, View.VISIBLE);
        if (bm == null) {
            v.setViewVisibility(R.id.widget_chart, View.GONE);
            v.setViewVisibility(R.id.widget_chart_span, View.GONE);
            v.setTextViewText(R.id.widget_chart_wait, res.getString(R.string.widget_chart_wait));
            v.setViewVisibility(R.id.widget_chart_wait, View.VISIBLE);
            return;
        }
        v.setImageViewBitmap(R.id.widget_chart, bm);
        v.setViewVisibility(R.id.widget_chart, View.VISIBLE);
        v.setViewVisibility(R.id.widget_chart_wait, View.GONE);
        int days = (int) Math.round((s.pt[s.pt.length - 1] - s.pt[0]) / (double) DAY);
        if (days >= 1) {
            v.setTextViewText(R.id.widget_chart_span, res.getString(R.string.widget_chart_span, days));
            v.setViewVisibility(R.id.widget_chart_span, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.widget_chart_span, View.GONE);
        }
    }

    /** En cas d'erreur : l'invitation à ouvrir l'appli, qui ouvre la collection. */
    private static RemoteViews fallback(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_value_small);
        v.setViewVisibility(R.id.widget_value, View.GONE);
        v.setViewVisibility(R.id.widget_delta, View.GONE);
        v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
        v.setOnClickPendingIntent(android.R.id.background, open(context, "collection", RC_COLLECTION));
        return v;
    }

    /** Euros entiers comme l'appli : « 1 234 € » en français (allemand, espagnol, italien : euro après le nombre), « €1,234 » en anglais, « € 1.234 » en portugais du Brésil. */
    private static String eur(long cents, Locale loc, String lang) {
        String n = NumberFormat.getIntegerInstance(loc).format(Math.round(cents / 100.0));
        if ("en".equals(lang)) return "\u20AC" + n;
        if ("pt".equals(lang)) return "\u20AC\u00A0" + n;
        return n + "\u00A0\u20AC";
    }

    /** Langues du widget : celles de l'appli qui ont leurs textes ici (values-fr/, -de/, -es/, -it/, -pt/ ; values/ : anglais). */
    static final String[] LANGS = { "fr", "en", "de", "es", "it", "pt" };

    /** Langue envoyée par le site → une langue du widget ; inconnue ou absente : anglais. */
    static String langOf(String l) {
        for (String x : LANGS) if (x.equals(l)) return x;
        return "en";
    }

    /** Portugais : celui du Brésil (langue des cartes Magic portugaises), comme l'appli par défaut. */
    private static Locale locale(String lang) {
        String l = langOf(lang);
        return Locale.forLanguageTag("pt".equals(l) ? "pt-BR" : l);
    }

    /** Textes dans la langue de l'appli (values/ : anglais, values-fr/, -de/, -es/, -it/, -pt/) ; null : langue du téléphone. */
    private static Resources localized(Context context, String lang) {
        if (lang == null) return context.getResources();
        Configuration conf = new Configuration(context.getResources().getConfiguration());
        conf.setLocale(locale(lang));
        return context.createConfigurationContext(conf).getResources();
    }

    /** Ouvre l'appli (ou la ramène devant) sur une vue du site. Même action et catégorie que l'icône du lanceur : l'intent correspond au filtre de MainActivity. */
    private static PendingIntent open(Context context, String view, int code) {
        Intent i = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_OPEN, view);
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Jour calendaire local (un relevé par jour, comme dayOf de l'appli). */
    static long dayOf(long t) {
        return (t + TimeZone.getDefault().getOffset(t)) / DAY;
    }

    /** Enregistre une estimation appli fermée (ValueRefreshJob) : valeur et relevé du jour, ajouté aux précédents faits depuis le même envoi du site. */
    static void saveEstimate(Context context, long base, long value, long at) {
        try {
            SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String o = mergeEstimate(p.getString(KEY_EST, null), base, value, at);
            if (o != null) p.edit().putString(KEY_EST, o).apply();
        } catch (Exception e) {
            // estimation perdue : le widget garde les chiffres de l'appli
        }
    }

    /** Nouvelle estimation (JSON) : relevés estimés précédents du même envoi (base), un par jour, puis celui-ci. null si illisible. Sans Android : testable. */
    static String mergeEstimate(String oldRaw, long base, long value, long at) {
        try {
            JSONObject old = parse(oldRaw);
            JSONArray prev = old != null && old.optLong("base", -1) == base ? old.optJSONArray("p") : null;
            List<JSONArray> keep = new ArrayList<>();
            if (prev != null) {
                for (int i = 0; i < prev.length(); i++) {
                    JSONArray r = prev.optJSONArray(i);
                    if (r != null && r.length() >= 2 && r.optLong(0, 0) < at && dayOf(r.optLong(0, 0)) != dayOf(at)) keep.add(r);
                }
            }
            JSONArray pts = new JSONArray();
            for (int i = Math.max(0, keep.size() - (MAX_POINTS - 1)); i < keep.size(); i++) pts.put(keep.get(i));
            pts.put(new JSONArray().put(at).put(value));
            return new JSONObject().put("base", base).put("v", value).put("at", at).put("p", pts).toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject parse(String raw) {
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Chiffres laissés par le site : { v: centimes, d: variation (centimes) | null, dd: sa durée en jours, n: cartes, at, h: [[t, v], …] (relevés
     * des 30 derniers jours), b: 'scan' | 'quick', lang, cur }, plus l'estimation appli fermée si elle suit ce même envoi. Illisibles ou absents : n = 0.
     */
    static final class Snap {

        long v;
        Long d;
        int dd = 7;
        int n;
        long at;
        String lang;
        String btn = "scan";
        boolean est;
        long estAt;
        long[] pt = new long[0];
        long[] pv = new long[0];
        boolean[] pe = new boolean[0];

        static Snap read(Context context) {
            SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return parse(p.getString(KEY, null), p.getString(KEY_EST, null));
        }

        /** Chiffres du site (raw) et estimation (estRaw, peut être null) → ce qu'affiche le widget. Sans Android : testable. */
        static Snap parse(String raw, String estRaw) {
            Snap s = new Snap();
            if (raw == null) return s;
            try {
                JSONObject o = new JSONObject(raw);
                s.lang = langOf(o.optString("lang"));
                s.v = o.optLong("v", 0);
                s.d = o.isNull("d") ? null : o.optLong("d", 0);
                s.dd = Math.max(1, Math.min(999, o.optInt("dd", 7)));
                s.n = o.optInt("n", 0);
                s.at = o.optLong("at", 0);
                s.btn = "quick".equals(o.optString("b")) ? "quick" : "scan";
                List<long[]> pts = new ArrayList<>();
                add(pts, o.optJSONArray("h"), false);
                // estimation faite depuis ce même envoi (base = at) : elle remplace la valeur, prolonge la variation et la courbe
                JSONObject e = ValueWidget.parse(estRaw);
                long ev = e == null ? 0 : e.optLong("v", 0), ea = e == null ? 0 : e.optLong("at", 0);
                if (e != null && s.at > 0 && s.v > 0 && e.optLong("base", -1) == s.at && ev > 0 && ea > s.at) {
                    int days = (int) Math.round((ea - s.at) / (double) DAY);
                    s.d = (s.d == null ? 0 : s.d) + (ev - s.v);
                    s.dd = Math.max(1, Math.min(999, (o.isNull("d") ? 0 : s.dd) + days));
                    s.v = ev;
                    s.est = true;
                    s.estAt = ea;
                    add(pts, e.optJSONArray("p"), true);
                }
                window(s, pts);
            } catch (Exception ex) {
                s.n = 0;
            }
            return s;
        }

        /** Ajoute des relevés [t, v] dans l'ordre : un par jour (le plus récent l'emporte), jamais en arrière. */
        private static void add(List<long[]> pts, JSONArray a, boolean est) {
            if (a == null) return;
            for (int i = 0; i < a.length() && i < 400; i++) {
                JSONArray r = a.optJSONArray(i);
                if (r == null || r.length() < 2) continue;
                long t = r.optLong(0, 0), v = r.optLong(1, -1);
                if (t <= 0 || v < 0) continue;
                long[] last = pts.isEmpty() ? null : pts.get(pts.size() - 1);
                if (last != null && t < last[0]) continue;
                long[] pt = {t, v, est ? 1 : 0};
                if (last != null && dayOf(t) == dayOf(last[0])) pts.set(pts.size() - 1, pt);
                else pts.add(pt);
            }
        }

        /** Garde les 30 derniers jours (MAX_POINTS relevés au plus) pour la courbe. */
        private static void window(Snap s, List<long[]> pts) {
            if (pts.isEmpty()) return;
            long end = pts.get(pts.size() - 1)[0];
            int from = 0;
            while (from < pts.size() - 1 && (pts.get(from)[0] < end - CHART_SPAN || pts.size() - from > MAX_POINTS)) from++;
            int n = pts.size() - from;
            s.pt = new long[n];
            s.pv = new long[n];
            s.pe = new boolean[n];
            for (int i = 0; i < n; i++) {
                long[] x = pts.get(from + i);
                s.pt[i] = x[0];
                s.pv[i] = x[1];
                s.pe[i] = x[2] == 1;
            }
        }
    }
}
