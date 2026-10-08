/* ── native.js : appli Android (Capacitor) ─────────────────────────────────────────────────────────
   Dans l'APK, le site tourne dans une coque native : window.Capacitor donne accès aux plugins natifs (caméra, pub, notifications, connexion Google,
   widget). Dans un navigateur ou la PWA, rien de tout ça n'existe et chaque fonction garde son comportement web. */
/** Plugin natif n, seulement dans l'appli Android et s'il y est installé ; null sinon. */
function natPlugin(n) {
  try { const C = typeof window !== 'undefined' && window.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable(n) && C.Plugins && C.Plugins[n] || null; } catch (e) { return null; }
}
const isNativeApp = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } };
/** Plugins natifs attendus dans l'APK (diagnostic affiché sous la version, dans les réglages) : une APK ancienne en a moins, il faut la refaire. */
const NAT_PLUGINS = [['CameraPreview', 'caméra'], ['CapacitorPluginMlKitTextRecognition', 'ML Kit'], ['FirebaseAuthentication', 'Google'], ['AdMob', 'pub'], ['PushNotifications', 'notif'], ['ManaOrbit', 'widget'], ['App', 'retour']];
