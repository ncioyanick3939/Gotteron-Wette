// Firebase-Konfiguration für Gotteron-Wette
export const firebaseConfig = {
  apiKey: "AIzaSyAPZ8RYp5pBvWnZ1e7-FfPY5-nUjoLDcQg",
  authDomain: "gotteron-wette.firebaseapp.com",
  projectId: "gotteron-wette",
  storageBucket: "gotteron-wette.firebasestorage.app",
  messagingSenderId: "533433020688",
  appId: "1:533433020688:web:831aa6c069811c8ef53595",
  measurementId: "G-61Y6NVPH3E"
};

// D'Email vom CEO (nur die Person cha Spiel eröffne/abschliesse)
export const ADMIN_EMAIL = "nicoruettimann@gmx.ch";

// Wieviel Franke choschtet eini Wett
export const BET_COST = 2;

// ===== MITTEILIGE =====
// Dr öffentlich Schlüssel für d'Push-Mitteilige.
// Firebase-Konsole → Projekt-Iistellige → Cloud Messaging →
// «Web Push certificates» → «Schlüsselpaar generieren» → dä Schlüssel do ineklebe.
// So lang das leer isch, isch d'Zile «Mitteilige» im Profil nid sichtbar.
export const VAPID_KEY = "BNP-1ayBCtB3sYZw_WXw9Rk1275r57tuPYRXqoDmD_UaJvebYKbDO1tgwRuUCx05B0S2KS48vbGc3SbdT1WECqA";

// ===== GRUPPE =====
// Jedi Gruppe het ihri eigene Spiel, Tipps, Jackpot, Rangliste und Bierkässeli.
// Si gseh enand nie. Zuegang über dr Link:
//   Gruppe 1: .../Gotteron-Wette/
//   Gruppe 2: .../Gotteron-Wette/?g=flotten4
// lang: 'ch' = Mundart, 'de' = Hochdütsch
export const GROUPS = {
  gotteron: {
    id: 'gotteron',
    name: 'Gottéron Spielwette',
    lang: 'ch',
    stake: 2,
    ceo: 'nicoruettimann@gmx.ch',
    guide: 'aleitig.html',
    manifest: 'manifest.json',
    appName: 'Spielwette'
  },
  flotten4: {
    id: 'flotten4',
    name: 'Die flotten 4',
    lang: 'de',
    stake: 2,
    ceo: 'nicoruettimann@gmx.ch',
    guide: 'anleitung.html',
    manifest: 'manifest-flotten4.json',
    appName: 'Flotten 4'
  }
};

// Wenn im Link kei Gruppe staht, gilt die do. Alti Date ohni Gruppe ghöre au dere.
export const DEFAULT_GROUP = 'gotteron';
