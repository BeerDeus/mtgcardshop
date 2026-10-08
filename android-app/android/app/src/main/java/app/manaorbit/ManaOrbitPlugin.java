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
 * - info() → { firebase, version, build } : Firebase initialisé (google-services.json présent), versionName et versionCode de l'APK.
 * - setWidget({ data }) : chiffres du widget d'écran d'accueil (JSON, voir src/widget.js), gardés pour quand l'appli est fermée.
 * - événement « open » ({ view: 'collection' }) : le widget a été touché ; gardé jusqu'à ce que la page l'écoute (lancement à froid).
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
        call.resolve(ret);
    }

    @PluginMethod
    public void setWidget(PluginCall call) {
        String data = call.getString("data");
        Context ctx = getContext();
        if (data == null || data.isEmpty()) {
            // rien à afficher : le widget revient à « Ouvre Mana Orbit… »
            ctx.getSharedPreferences(ValueWidget.PREFS, Context.MODE_PRIVATE).edit().remove(ValueWidget.KEY).apply();
        } else {
            try {
                new JSONObject(data);
            } catch (JSONException e) {
                call.reject("data : JSON illisible");
                return;
            }
            ctx.getSharedPreferences(ValueWidget.PREFS, Context.MODE_PRIVATE).edit().putString(ValueWidget.KEY, data).apply();
        }
        ValueWidget.refreshAll(ctx);
        call.resolve();
    }

    /** Widget touché : l'activité est lancée (ou ramenée devant) avec l'extra du widget ; à froid, Capacitor passe ici l'intent de lancement. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String view = intent == null ? null : intent.getStringExtra(ValueWidget.EXTRA_OPEN);
        if (view == null) return;
        // Rouverte depuis les applis récentes (ou recréée) : Android rejoue l'ancienne intention ; ce n'est pas un nouveau toucher du widget.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        intent.removeExtra(ValueWidget.EXTRA_OPEN);
        JSObject ev = new JSObject();
        ev.put("view", view);
        notifyListeners("open", ev, true);
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
