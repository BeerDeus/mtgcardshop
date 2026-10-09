package app.manaorbit;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Arrays;
import org.json.JSONObject;

/**
 * Deuxième widget « QR code d'échange » : en grand, le QR code du lien public de la liste d'échange du compte, à faire scanner depuis l'écran
 * d'accueil sans ouvrir l'appli ; pseudo et « Liste d'échange » dessous. Fond blanc (un lecteur attend du foncé sur clair), marge de 4 modules.
 * Le site calcule le QR (src/qr.js) et l'envoie avec setTradeWidget du plugin ManaOrbit (src/widget.js) ; gardé dans SharedPreferences, rien à lire ici.
 * Sans lien (pas encore créé, arrêté, compte déconnecté) : « Crée ton lien d'échange » ; rien reçu (appli pas encore ouverte) : « Ouvre Mana Orbit… ».
 * Toucher le widget ouvre l'onglet Échange de la collection (événement « open » { view: 'trade' }). Redessiné à chaque envoi et à chaque redimensionnement.
 */
public class TradeWidget extends AppWidgetProvider {

    /** Dans ValueWidget.PREFS : { u: lien | '', n: côté en modules, m: '0'/'1' ligne par ligne (n × n), by: pseudo, lang }. */
    static final String KEY = "trade";

    private static final int RC_TRADE = 0x4D52;
    /** Marge de silence autour du code, en modules (norme ISO/IEC 18004 : 4). */
    private static final int QUIET = 4;
    private static final int INK = 0xFF000000;
    private static final int PAPER = 0xFFFFFFFF;
    /** Côté du bitmap au plus (px) : net à toutes les tailles, loin de la limite de mémoire des RemoteViews. */
    private static final int MAX_PX = 720;
    /** Mise en page (dp, widget_trade.xml) : marge du fond, place d'une ou deux lignes de texte ; en dessous de TWO_LINES de haut, une seule ligne. */
    private static final float PAD = 6f;
    private static final float TEXT_ONE = 22f;
    private static final float TEXT_TWO = 38f;
    private static final float TWO_LINES = 150f;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id);
    }

    /** Nombre de widgets « QR code d'échange » posés. */
    static int count(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager == null ? null : manager.getAppWidgetIds(new ComponentName(context, TradeWidget.class));
            return ids == null ? 0 : ids.length;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** Redessine tous les widgets posés (après un envoi du site). */
    static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) return;
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, TradeWidget.class));
            if (ids != null) for (int id : ids) update(context, manager, id);
        } catch (Throwable t) {
            // jamais d'arrêt de l'appli pour un widget
        }
    }

    static void update(Context context, AppWidgetManager manager, int id) {
        try {
            Qr q = Qr.parse(context.getSharedPreferences(ValueWidget.PREFS, Context.MODE_PRIVATE).getString(KEY, null));
            // la plus grande taille (portrait : hauteur maxi, paysage : largeur maxi) : le bitmap est réduit à l'affichage, jamais agrandi ; 0 → 2 × 2
            Bundle o = manager.getAppWidgetOptions(id);
            int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
            int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            manager.updateAppWidget(id, build(context, q, w > 0 ? w : 160, h > 0 ? h : 160));
        } catch (Throwable t) {
            try {
                manager.updateAppWidget(id, build(context, new Qr(), 160, 160));
            } catch (Throwable ignored) {
                // le lanceur garde l'affichage précédent
            }
        }
    }

    private static RemoteViews build(Context context, Qr q, int wDp, int hDp) {
        Resources res = ValueWidget.localized(context, q.lang);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_trade);
        v.setOnClickPendingIntent(android.R.id.background, ValueWidget.open(context, "trade", RC_TRADE));
        boolean two = hDp >= TWO_LINES;
        Bitmap bm = null;
        if (q.m != null) {
            float side = Math.min(wDp - 2 * PAD, hDp - 2 * PAD - (two ? TEXT_TWO : TEXT_ONE));
            bm = draw(q.m, q.n, module(q.n, Math.round(Math.max(48f, side) * context.getResources().getDisplayMetrics().density)));
        }
        if (bm == null) {
            // pas de code : invitation (créer le lien, ou ouvrir l'appli une première fois) ; toucher ouvre l'onglet Échange dans les deux cas
            String msg = res.getString(q.known ? R.string.widget_trade_none : R.string.widget_trade_wait);
            v.setViewVisibility(R.id.widget_trade_code, View.GONE);
            v.setViewVisibility(R.id.widget_trade_invite, View.VISIBLE);
            v.setTextViewText(R.id.widget_trade_empty, msg);
            v.setTextViewText(R.id.widget_trade_hint, res.getString(R.string.widget_trade_hint));
            v.setViewVisibility(R.id.widget_trade_hint, q.known && two ? View.VISIBLE : View.GONE);
            v.setContentDescription(android.R.id.background, msg);
            return v;
        }
        String label = res.getString(R.string.widget_trade_sub);
        v.setViewVisibility(R.id.widget_trade_invite, View.GONE);
        v.setViewVisibility(R.id.widget_trade_code, View.VISIBLE);
        v.setImageViewBitmap(R.id.widget_qr, bm);
        // pseudo en gras, « Liste d'échange » dessous ; sans pseudo, ou widget bas (une ligne) : la ligne en gras seule
        boolean anon = q.by.isEmpty();
        v.setTextViewText(R.id.widget_trade_by, anon ? label : q.by);
        v.setTextViewText(R.id.widget_trade_sub, label);
        v.setViewVisibility(R.id.widget_trade_sub, anon || !two ? View.GONE : View.VISIBLE);
        v.setContentDescription(android.R.id.background, anon ? res.getString(R.string.widget_trade_a11y_me) : res.getString(R.string.widget_trade_a11y, q.by));
        return v;
    }

    /** Pixels par module : le code (marge comprise) remplit au moins sidePx, MAX_PX au plus, 2 au moins. */
    static int module(int n, int sidePx) {
        int s = n + 2 * QUIET;
        return Math.max(2, Math.min(MAX_PX / s, (sidePx + s - 1) / s));
    }

    /** QR code en bitmap : modules carrés de k pixels, noirs sur blanc, marge de QUIET modules. */
    static Bitmap draw(boolean[] m, int n, int k) {
        int[] px = pixels(m, n, k);
        int s = (n + 2 * QUIET) * k;
        return Bitmap.createBitmap(px, s, s, Bitmap.Config.ARGB_8888);
    }

    /** Pixels du bitmap (ligne par ligne). Sans Android : testable. */
    static int[] pixels(boolean[] m, int n, int k) {
        int s = (n + 2 * QUIET) * k;
        int[] px = new int[s * s];
        Arrays.fill(px, PAPER);
        for (int y = 0; y < n; y++) {
            for (int x = 0; x < n; x++) {
                if (!m[y * n + x]) continue;
                int x0 = (x + QUIET) * k;
                for (int r = (y + QUIET) * k, end = r + k; r < end; r++) Arrays.fill(px, r * s + x0, r * s + x0 + k, INK);
            }
        }
        return px;
    }

    /** Ce que le site a laissé : known (un envoi reçu), lang, by (pseudo), n et m (null : pas de lien). Sans Android : testable. */
    static final class Qr {

        boolean known;
        String lang;
        String by = "";
        int n;
        boolean[] m;

        static Qr parse(String raw) {
            Qr q = new Qr();
            if (raw == null) return q;
            try {
                JSONObject o = new JSONObject(raw);
                q.known = true;
                q.lang = ValueWidget.langOf(o.optString("lang"));
                String by = o.isNull("by") ? "" : o.optString("by", "").trim();
                q.by = by.length() > 60 ? by.substring(0, 60) : by;
                String u = o.isNull("u") ? "" : o.optString("u", ""), m = o.optString("m", "");
                int n = o.optInt("n", 0);
                // versions 1 à 40 (21 à 177 modules de côté) ; une matrice incomplète ou un caractère inattendu : pas de code plutôt qu'un code faux
                if (u.isEmpty() || n < 21 || n > 177 || (n - 17) % 4 != 0 || m.length() != n * n) return q;
                boolean[] b = new boolean[n * n];
                for (int i = 0; i < b.length; i++) {
                    char c = m.charAt(i);
                    if (c != '0' && c != '1') return q;
                    b[i] = c == '1';
                }
                q.n = n;
                q.m = b;
            } catch (Exception e) {
                return new Qr();
            }
            return q;
        }
    }
}
