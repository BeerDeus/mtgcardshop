package app.manaorbit;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins locaux (pas de paquet npm) : à déclarer avant super.onCreate, qui crée le pont avec la liste des plugins.
        registerPlugin(ManaOrbitPlugin.class);
        // Activité recréée (processus tué en arrière-plan) : getIntent() est encore celle du lancement (widget, raccourci, partage), que super.onCreate
        // rejouerait (collection rouverte, liste partagée recollée par-dessus la saisie en cours).
        if (savedInstanceState != null) ManaOrbitPlugin.forget(getIntent());
        super.onCreate(savedInstanceState);
    }
}
