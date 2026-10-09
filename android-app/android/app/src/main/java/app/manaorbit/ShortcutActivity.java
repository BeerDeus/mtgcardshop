package app.manaorbit;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import java.util.Arrays;
import java.util.List;

/**
 * Raccourcis de l'icône (appui long : Scanner, Prix rapide, Échange, Nouveau panier ; res/xml/shortcuts.xml) : relais invisible vers MainActivity.
 * Android lance un raccourci statique avec FLAG_ACTIVITY_CLEAR_TASK : visant MainActivity, il détruirait l'appli ouverte (page rechargée, scan ou
 * recherche en cours perdus). Ce relais vit dans sa propre tâche (taskAffinity vide, AndroidManifest.xml) et relance MainActivity comme le fait le
 * widget : ramenée devant avec onNewIntent, ou démarrée à froid ; ManaOrbitPlugin en fait l'événement « open » ({ view }).
 */
public class ShortcutActivity extends Activity {

    /** Seules cibles transmises (src/widget.js, WGT_OPEN) : rien d'autre ne passe par ce relais. */
    private static final List<String> VIEWS = Arrays.asList("scan", "quick", "trade", "paste");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String view = null;
        try {
            Intent in = getIntent();
            if (savedInstanceState == null && in != null && (in.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) view = in.getStringExtra(ValueWidget.EXTRA_OPEN);
        } catch (RuntimeException e) {
            // extras illisibles : l'appli s'ouvre sans cible
        }
        Intent i = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (view != null && VIEWS.contains(view)) i.putExtra(ValueWidget.EXTRA_OPEN, view);
        try {
            startActivity(i);
        } catch (RuntimeException e) {
            // MainActivity est dans le même APK : n'arrive pas ; le relais se ferme quand même
        }
        finish();
    }
}
