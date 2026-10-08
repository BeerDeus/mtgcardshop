package app.manaorbit;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.json.JSONObject;

/**
 * Widget d'écran d'accueil « Ma collection » : valeur, variation sur 7 jours et nombre de cartes.
 * Les chiffres viennent du site (setWidget du plugin ManaOrbit, gardés dans SharedPreferences) : le widget ne lit rien sur le réseau
 * et n'a pas de mise à jour périodique ; il est redessiné à chaque envoi du site, et quand le lanceur le demande (pose, redimensionnement).
 * Deux mises en page : compacte (une rangée : valeur + variation) et complète (logo, titre, valeur, variation, cartes).
 * Langue et format des nombres : ceux de l'appli (champ lang) ; sans données, la langue du téléphone.
 */
public class ValueWidget extends AppWidgetProvider {

    static final String PREFS = "mana_orbit_widget";
    static final String KEY = "data";
    /** Extra de l'intent du widget : vue du site à ouvrir (relayée par ManaOrbitPlugin, événement « open »). */
    static final String EXTRA_OPEN = "app.manaorbit.open";

    private static final int COLOR_UP = 0xFF4FD1A1;
    private static final int COLOR_DOWN = 0xFFFF8091;
    /** Taille (dp) à partir de laquelle la mise en page complète tient : deux rangées du lanceur. */
    private static final float FULL_W = 100f;
    private static final float FULL_H = 120f;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id);
    }

    /** Redessine tous les widgets posés (après un envoi du site). */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ValueWidget.class));
        for (int id : ids) update(context, manager, id);
    }

    static void update(Context context, AppWidgetManager manager, int id) {
        Snap s = Snap.read(context);
        RemoteViews views;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12 et plus : le lanceur choisit lui-même la plus grande mise en page qui tient, à chaque taille et orientation
            Map<SizeF, RemoteViews> sizes = new HashMap<>();
            sizes.put(new SizeF(40f, 40f), build(context, s, false));
            sizes.put(new SizeF(FULL_W, FULL_H), build(context, s, true));
            views = new RemoteViews(sizes);
        } else {
            // avant : d'après la hauteur annoncée en portrait (0 tant que le lanceur ne l'a pas donnée : taille par défaut, 2 × 2)
            Bundle o = manager.getAppWidgetOptions(id);
            int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            views = build(context, s, h == 0 || h >= FULL_H);
        }
        manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context context, Snap s, boolean full) {
        Resources res = localized(context, s.lang);
        RemoteViews v = new RemoteViews(context.getPackageName(), full ? R.layout.widget_value : R.layout.widget_value_small);
        v.setOnClickPendingIntent(R.id.widget_root, openApp(context));
        if (full) v.setTextViewText(R.id.widget_title, res.getString(R.string.widget_title));
        if (s.n <= 0) {
            String empty = res.getString(R.string.widget_empty);
            v.setViewVisibility(R.id.widget_value, View.GONE);
            v.setViewVisibility(R.id.widget_delta, View.GONE);
            if (full) v.setViewVisibility(R.id.widget_count, View.GONE);
            v.setTextViewText(R.id.widget_empty, empty);
            v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            v.setContentDescription(R.id.widget_root, empty);
            return v;
        }
        boolean fr = "fr".equals(s.lang);
        Locale loc = fr ? Locale.FRENCH : Locale.ENGLISH;
        String value = eur(s.v, loc, fr);
        v.setViewVisibility(R.id.widget_empty, View.GONE);
        v.setTextViewText(R.id.widget_value, value);
        v.setViewVisibility(R.id.widget_value, View.VISIBLE);
        // variation : comme sur l'orbe de l'appli, cachée sous 1 € ; ▲ +12 € / ▼ −8 € (U+2212)
        if (s.d != null && Math.abs(s.d) >= 100) {
            String d = (s.d < 0 ? "\u25BC \u2212" : "\u25B2 +") + eur(Math.abs(s.d), loc, fr);
            v.setTextViewText(R.id.widget_delta, res.getString(R.string.widget_delta, d));
            v.setTextColor(R.id.widget_delta, s.d < 0 ? COLOR_DOWN : COLOR_UP);
            v.setViewVisibility(R.id.widget_delta, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.widget_delta, View.GONE);
        }
        String cards = res.getQuantityString(R.plurals.widget_cards, s.n, NumberFormat.getIntegerInstance(loc).format(s.n));
        if (full) {
            v.setTextViewText(R.id.widget_count, cards);
            v.setViewVisibility(R.id.widget_count, View.VISIBLE);
        }
        v.setContentDescription(R.id.widget_root, res.getString(R.string.widget_a11y, value, cards));
        return v;
    }

    /** Euros entiers comme l'appli : « 1 234 € » en français, « €1,234 » en anglais. */
    private static String eur(long cents, Locale loc, boolean fr) {
        String n = NumberFormat.getIntegerInstance(loc).format(Math.round(cents / 100.0));
        return fr ? n + "\u00A0\u20AC" : "\u20AC" + n;
    }

    /** Textes dans la langue de l'appli (values/ : anglais, values-fr/ : français) ; null : langue du téléphone. */
    private static Resources localized(Context context, String lang) {
        if (lang == null) return context.getResources();
        Configuration conf = new Configuration(context.getResources().getConfiguration());
        conf.setLocale("fr".equals(lang) ? Locale.FRENCH : Locale.ENGLISH);
        return context.createConfigurationContext(conf).getResources();
    }

    /** Ouvre l'appli (ou la ramène devant) sur la collection. Même action et catégorie que l'icône du lanceur : l'intent correspond au filtre de MainActivity. */
    private static PendingIntent openApp(Context context) {
        Intent i = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_OPEN, "collection");
        return PendingIntent.getActivity(context, 0x4D4F, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Chiffres laissés par le site : { v: centimes, d: variation 7 j en centimes | null, n: cartes, at, lang, cur }. Illisibles ou absents : n = 0. */
    private static final class Snap {

        long v;
        Long d;
        int n;
        String lang;

        static Snap read(Context context) {
            Snap s = new Snap();
            String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
            if (raw == null) return s;
            try {
                JSONObject o = new JSONObject(raw);
                s.lang = "fr".equals(o.optString("lang")) ? "fr" : "en";
                s.v = o.optLong("v", 0);
                s.d = o.isNull("d") ? null : o.optLong("d", 0);
                s.n = o.optInt("n", 0);
            } catch (Exception e) {
                s.n = 0;
            }
            return s;
        }
    }
}
