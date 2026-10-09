package app.manaorbit;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Plugin local « ManaOrbit » : ce que le site demande à la coque Android et qu'aucun plugin npm ne fait.
 * Côté site : natPlugin('ManaOrbit') (src/native.js), null dans un navigateur ou dans une APK plus ancienne sans ce plugin.
 * - info() → { firebase, version, build, widgets, widgetRefresh } : Firebase initialisé (google-services.json présent), versionName et versionCode
 *   de l'APK, nombre de widgets posés, estimation appli fermée possible (ValueRefreshJob.ENABLED).
 * - setWidget({ data, coll? }) : chiffres du widget d'écran d'accueil (JSON, voir src/widget.js), gardés pour quand l'appli est fermée ;
 *   coll : cartes et prix de référence pour l'estimation appli fermée (absent : plus d'estimation jusqu'au prochain envoi).
 * - événement « open », gardé jusqu'à ce que la page l'écoute (lancement à froid) : { view: 'collection' | 'scan' | 'quick' } le widget ou son bouton a été
 *   touché ; { view: 'scan' | 'quick' | 'trade' | 'paste' } un raccourci de l'icône (ShortcutActivity) ; { view: 'share', text, title } du texte partagé
 *   par une autre appli (menu « Partager » : decklist, lien EDHREC, Archidekt, Moxfield…).
 */
@CapacitorPlugin(name = "ManaOrbit")
public class ManaOrbitPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("firebase", hasFirebase(ctx));
        String version = "";
        long build = 0;
        try {
            PackageInfo pi = packageInfo(ctx);
            if (pi.versionName != null) version = pi.versionName;
            build = versionCode(pi);
        } catch (PackageManager.NameNotFoundException e) {
            // notre propre paquet : n'arrive pas
        }
        ret.put("version", version);
        ret.put("build", build);
        ret.put("widgets", ValueWidget.count(ctx));
        ret.put("widgetRefresh", ValueRefreshJob.ENABLED);
        call.resolve(ret);
    }

    @PluginMethod
    public void setWidget(PluginCall call) {
        String data = call.getString("data");
        Context ctx = getContext();
        if (data == null || data.isEmpty()) {
            // rien à afficher : le widget revient à « Ouvre Mana Orbit… »
            ctx.getSharedPreferences(ValueWidget.PREFS, Context.MODE_PRIVATE).edit().remove(ValueWidget.KEY).remove(ValueWidget.KEY_EST).apply();
        } else {
            try {
                new JSONObject(data);
            } catch (JSONException e) {
                call.reject("data : JSON illisible");
                return;
            }
            // chiffres frais de l'appli : l'estimation appli fermée n'a plus lieu d'être
            ctx.getSharedPreferences(ValueWidget.PREFS, Context.MODE_PRIVATE).edit().putString(ValueWidget.KEY, data).remove(ValueWidget.KEY_EST).apply();
        }
        ValueRefreshJob.store(ctx, data == null || data.isEmpty() ? null : call.getString("coll"));
        ValueWidget.refreshAll(ctx);
        ValueRefreshJob.sync(ctx);
        call.resolve();
    }

    /** Texte partagé gardé au plus : une decklist de 250 lignes fait moins de 10 000 caractères ; au-delà, ce n'est pas une liste et le pont n'a pas à le porter. */
    static final int SHARE_MAX = 100000;

    /** Widget ou raccourci touché, texte partagé : l'activité est lancée (ou ramenée devant) avec cette intention ; à froid, Capacitor passe ici l'intention de lancement. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String[] t = target(intent);
        if (t == null) return;
        JSObject ev = new JSObject();
        ev.put("view", t[0]);
        if (t.length > 2) {
            ev.put("text", t[1]);
            ev.put("title", t[2]);
        }
        notifyListeners("open", ev, true);
    }

    /**
     * Ce que l'intention demande d'ouvrir : [vue] (widget, raccourci : extra EXTRA_OPEN) ou ['share', texte, titre] (ACTION_SEND text/plain) ; null sinon.
     * Lue une seule fois : l'intention est ensuite vidée (forget), un nouvel appel avec la même intention ne rouvre rien.
     */
    static String[] target(Intent intent) {
        if (intent == null) return null;
        String[] t = null;
        try {
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                t = new String[] {"share", clip(intent.getCharSequenceExtra(Intent.EXTRA_TEXT), SHARE_MAX), clip(intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT), 300)};
            } else {
                String view = intent.getStringExtra(ValueWidget.EXTRA_OPEN);
                if (view != null) t = new String[] {view};
            }
        } catch (RuntimeException e) {
            return null; // extras illisibles (objet inconnu glissé par une autre appli) : intention ignorée plutôt que l'appli arrêtée
        }
        // Rouverte depuis les applis récentes : Android rejoue l'ancienne intention ; ce n'est ni un nouveau toucher ni un nouveau partage.
        if (t == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null;
        forget(intent);
        return t;
    }

    /** Intention lue, ou à ne pas rejouer (activité recréée, voir MainActivity) : plus de cible ni de texte partagé. */
    static void forget(Intent intent) {
        if (intent == null) return;
        try {
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                intent.setAction(Intent.ACTION_MAIN); // d'abord : même si les extras sont illisibles, plus de partage à rejouer
                intent.removeExtra(Intent.EXTRA_TEXT);
                intent.removeExtra(Intent.EXTRA_SUBJECT);
            }
            intent.removeExtra(ValueWidget.EXTRA_OPEN);
        } catch (RuntimeException e) {
            // extras illisibles : target() les ignore déjà
        }
    }

    private static String clip(CharSequence s, int max) {
        if (s == null) return "";
        String v = s.toString();
        return v.length() > max ? v.substring(0, max) : v;
    }

    /** FirebaseApp.getApps(context) non vide. Firebase n'est visible des plugins qu'à l'exécution (dépendance « implementation ») : appel par réflexion,
     *  et à défaut la ressource google_app_id que le plugin google-services génère depuis google-services.json. */
    private static boolean hasFirebase(Context ctx) {
        try {
            Class<?> app = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = app.getMethod("getApps", Context.class).invoke(null, ctx);
            return apps instanceof List && !((List<?>) apps).isEmpty();
        } catch (Throwable t) {
            return ctx.getResources().getIdentifier("google_app_id", "string", ctx.getPackageName()) != 0;
        }
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo packageInfo(Context ctx) throws PackageManager.NameNotFoundException {
        return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo pi) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
    }
}
