// --- IMPORTS FIREBASE & CLOUD FIRESTORE ---
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteField } from "firebase/firestore";
import { getMessaging, getToken } from "firebase/messaging";
import { callPabloChat } from "./src/services/pabloChatClient.mjs";
import { callPabloAvatar } from "./src/services/pabloAvatarClient.mjs";
import { formatHeyPabloMessage, normalizeHeyPabloText } from "./src/utils/heyPabloFormatting.mjs";

// CONFIGURATION GLOBALE
// ==========================================
const GLOBAL_CONFIG_ID = "pablo_global_config";
const DEMO_MODE_KEY = "pablo_demo_mode";
const CLOUD_PENDING_KEY = "pablo_pending_cloud_writes";
const CLOUD_SYNC_META_KEY = "pablo_cloud_sync_meta";
const CLOUD_SYNC_DEBOUNCE_MS = 650;
const OPENAI_MODEL = "gpt-5.4-mini";
const APP_CHECK_SITE_KEY = import.meta.env?.VITE_FIREBASE_APPCHECK_SITE_KEY || "";
const IS_FILE_PREVIEW = window.location.protocol === 'file:';
const IS_LOCAL_PREVIEW = !IS_FILE_PREVIEW && (
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
    || /^517\d$/.test(window.location.port)
);
const PABLO_CHAT_API_URL = IS_LOCAL_PREVIEW
    ? "https://www.pablocanin.fr/api/pablo-chat"
    : "/api/pablo-chat";
const PABLO_AVATAR_API_URL = IS_LOCAL_PREVIEW
    ? "https://www.pablocanin.fr/api/pablo-avatar"
    : "/api/pablo-avatar";
let deferredPwaInstallPrompt = null;
let chartJsPromise = null;

function trackEvent(name) {
    if (typeof window.clarity === 'function') window.clarity('event', name);
}

window.addEventListener('error', () => trackEvent('client_error'));
window.addEventListener('unhandledrejection', () => trackEvent('client_promise_error'));

function ensureChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!chartJsPromise) {
        chartJsPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            script.async = true;
            script.onload = () => resolve(window.Chart);
            script.onerror = () => reject(new Error('Chart.js indisponible'));
            document.head.appendChild(script);
        });
    }
    return chartJsPromise;
}

async function pabloChat(messages) {
    if (IS_FILE_PREVIEW) {
        throw new Error("Ouvrez Pablo via le site en ligne ou le serveur local pour utiliser Hey Pablo.");
    }
    return callPabloChat({ auth, apiUrl: PABLO_CHAT_API_URL, model: OPENAI_MODEL, messages });
}

async function pabloAvatar(imageDataUrl, style) {
    if (IS_FILE_PREVIEW) {
        throw new Error("Ouvrez Pablo via le site en ligne pour générer un avatar IA.");
    }
    if (!auth.currentUser) {
        throw new Error("Connectez-vous pour générer un avatar IA.");
    }
    return callPabloAvatar({
        auth,
        apiUrl: PABLO_AVATAR_API_URL,
        imageDataUrl,
        petName: petProfile.name || '',
        species: petProfile.species || '',
        breed: petProfile.breed || '',
        style
    });
}

const groqChat = pabloChat;

const firebaseConfig = {
    apiKey: "AIzaSyBuz7iwOzeEFsFDU1G5aAe69JCczaduI44",
    authDomain: "pablo-app-f6057.firebaseapp.com",
    projectId: "pablo-app-f6057",
    storageBucket: "pablo-app-f6057.firebasestorage.app",
    messagingSenderId: "764832752787",
    appId: "1:764832752787:web:21948ed789665c531b9966",
    measurementId: "G-RE0F1KKEK3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function runWhenIdle(callback) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 3000 });
    else window.setTimeout(callback, 1200);
}

runWhenIdle(async () => {
    try {
        const { getAnalytics, isSupported } = await import("firebase/analytics");
        if (await isSupported()) getAnalytics(app);
    } catch {
        console.warn("Firebase Analytics bloqué ou non supporté.");
    }
});

if (APP_CHECK_SITE_KEY && !IS_FILE_PREVIEW) {
    runWhenIdle(async () => {
        try {
            const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
            initializeAppCheck(app, {
                provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
                isTokenAutoRefreshEnabled: true
            });
        } catch (error) {
            console.warn("Firebase App Check non initialisé.", error);
        }
    });
}

// Capture immédiate d'un lien de cession (?cession=...) AVANT que l'auth ne réagisse
try {
    const _cp = new URLSearchParams(window.location.search).get('cession');
    if (_cp) localStorage.setItem('_pendingCession', _cp);
} catch (e) { /* no-op */ }

// EXPOSITION INDISPENSABLE POUR LA PAGE INDEX.HTML :
window._fbAuth = auth;

// Variables globales
let petsList = [];
let currentPetId = null;
let petProfile = {};
let weightHistory = [];
let medicalEvents = [];
let dailyTrackers = {};
let chatHistory = [];
let isChatSending = false;
let budgetExpenses = [];
let educationData = {};
let proData = {};
let proEvents = [];
let proLitters = [];
let healthExtras = {};
let proHistory = { heats: [], matings: [] };
let memoriesList = [];
let gamification = { streak: 0, lastLogin: null, badges: [] };

let weightChartInstance = null;

const DEFAULT_EDU_EXERCISES = [
    { id: 'assis',          name: "S'asseoir (Assis)",             icon: 'fa-arrow-down' },
    { id: 'coucher',        name: 'Se coucher (Couché)',             icon: 'fa-bed' },
    { id: 'rappel',         name: 'Le Rappel au pied',               icon: 'fa-dog' },
    { id: 'pas-bouger',     name: 'Pas bouger (Statique)',           icon: 'fa-hand' },
    { id: 'proprete',       name: 'La Propreté',                     icon: 'fa-droplet-slash' },
    { id: 'marche-laisse',  name: 'Marche en laisse détendue',       icon: 'fa-bezier-curve' },
    { id: 'solitude',       name: 'Gestion de la solitude',          icon: 'fa-house-chimney-user' }
];

// ==========================================
// AUTHENTIFICATION (FIREBASE)
// ==========================================

function clearAppLocalData() {
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('firebase')) return;
        if (k.startsWith('clarity') || k.startsWith('_clarity')) return;
        localStorage.removeItem(k);
    });
}

async function migrateLocalToCloud(uid) {
    const payload = {};
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('firebase') || k.startsWith('clarity') || k.startsWith('_clarity') || k === '_pablo_owner_uid' || k === '_pendingCession') return;
        try { payload[k] = JSON.parse(localStorage.getItem(k)); }
        catch (e) { payload[k] = localStorage.getItem(k); }
    });
    if (Object.keys(payload).length === 0) return;
    try { await setDoc(doc(db, "users", uid), payload, { merge: true }); }
    catch (e) { console.error("Migration cloud échouée :", e); }
}

function setCloudStatus(state = 'idle', label = '') {
    const pill = document.getElementById('cloud-sync-pill');
    const text = document.getElementById('cloud-sync-text');
    if (!pill || !text) return;

    pill.dataset.state = state;
    text.textContent = label || {
        idle: 'Local',
        saving: 'Sync...',
        saved: 'Cloud OK',
        offline: 'Hors ligne',
        error: 'Sync attente'
    }[state] || 'Cloud';
}

function writeCloudValueToLocal(key, value) {
    if (key === CLOUD_PENDING_KEY || key === CLOUD_SYNC_META_KEY) return;
    if (key.startsWith('firebase') || key.startsWith('clarity') || key.startsWith('_clarity')) return;
    if (value === undefined || value === null) return;
    if (typeof value === 'string') localStorage.setItem(key, value);
    else localStorage.setItem(key, JSON.stringify(value));
}

function loadCloudDataIntoLocalStorage(cloudData) {
    if (!cloudData) return;
    Object.keys(cloudData).forEach(key => writeCloudValueToLocal(key, cloudData[key]));
}

function readPendingCloudWrites() {
    try { return JSON.parse(localStorage.getItem(CLOUD_PENDING_KEY) || '{}'); }
    catch { return {}; }
}

function queueCloudWrite(fields) {
    const pending = readPendingCloudWrites();
    Object.assign(pending, fields);
    localStorage.setItem(CLOUD_PENDING_KEY, JSON.stringify(pending));
    localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify({ state: 'pending', updatedAt: Date.now() }));
}

function getSafeCloudFields(fields) {
    const safe = {};
    Object.entries(fields || {}).forEach(([key, value]) => {
        if (!key || value === undefined) return;
        if (key === CLOUD_PENDING_KEY || key === CLOUD_SYNC_META_KEY) return;
        if (key.startsWith('firebase') || key.startsWith('clarity') || key.startsWith('_clarity')) return;
        if (key === '_pablo_owner_uid' || key === '_pendingCession') return;
        safe[key] = value;
    });
    return safe;
}

async function saveCloudFields(fields, { queueOnFail = true } = {}) {
    if (!auth.currentUser || hasDemoAccess()) return false;

    const safeFields = getSafeCloudFields(fields);
    if (Object.keys(safeFields).length === 0) return true;

    if (!navigator.onLine) {
        if (queueOnFail) queueCloudWrite(safeFields);
        setCloudStatus('offline', 'Hors ligne');
        return false;
    }

    try {
        setCloudStatus('saving', 'Sync...');
        await setDoc(doc(db, "users", auth.currentUser.uid), {
            ...safeFields,
            updatedAt: Date.now()
        }, { merge: true });
        localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify({ state: 'saved', updatedAt: Date.now() }));
        setCloudStatus('saved', 'Cloud OK');
        return true;
    } catch (e) {
        if (queueOnFail) queueCloudWrite(safeFields);
        setCloudStatus('error', 'Sync attente');
        console.error("Erreur sync Cloud :", e);
        return false;
    }
}

async function flushPendingCloudWrites() {
    if (!auth.currentUser || hasDemoAccess()) return;
    const pending = getSafeCloudFields(readPendingCloudWrites());
    if (Object.keys(pending).length === 0) {
        setCloudStatus(navigator.onLine ? 'saved' : 'offline', navigator.onLine ? 'Cloud OK' : 'Hors ligne');
        return;
    }

    const ok = await saveCloudFields(pending, { queueOnFail: false });
    if (ok) {
        localStorage.removeItem(CLOUD_PENDING_KEY);
        localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify({ state: 'saved', updatedAt: Date.now() }));
        setCloudStatus('saved', 'Cloud OK');
    } else {
        queueCloudWrite(pending);
    }
}

async function deleteCloudFields(keys) {
    if (!auth.currentUser || hasDemoAccess() || !navigator.onLine) return;
    const payload = {};
    keys.forEach(key => { payload[key] = deleteField(); });
    try {
        setCloudStatus('saving', 'Sync...');
        await setDoc(doc(db, "users", auth.currentUser.uid), payload, { merge: true });
        setCloudStatus('saved', 'Cloud OK');
    } catch (e) {
        setCloudStatus('error', 'Sync attente');
        console.error("Erreur suppression Cloud :", e);
    }
}

onAuthStateChanged(auth, async (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp  = document.getElementById('main-app-layout');
    const landing  = document.getElementById('landing-page');

    if (user) {
        console.log("🟢 Connecté :", user.email);
        try {
            const prevUid    = localStorage.getItem('_pablo_owner_uid');
            const userDocRef = doc(db, "users", user.uid);
            const userDoc    = await getDoc(userDocRef);
            const cloudData  = userDoc.exists() ? userDoc.data() : null;
            const loadCloud  = () => loadCloudDataIntoLocalStorage(cloudData);

            if (prevUid === user.uid) {
                loadCloud();
            } else {
                clearAppLocalData();
                const _recp = getCessionParam();
                if (_recp) localStorage.setItem('_pendingCession', _recp);
                loadCloud();
            }
            localStorage.setItem('_pablo_owner_uid', user.uid);
            await flushPendingCloudWrites();
        } catch (e) { console.error("Erreur de restauration Cloud :", e); }

        if (landing)  landing.style.display  = 'none';
        if (authPage) authPage.style.display  = 'none';

        if (typeof window.clarity === 'function')
            window.clarity('identify', user.uid, undefined, undefined, user.displayName || user.email || '');

        initApp();

        if (mainApp) {
            mainApp.style.display = 'flex';
            setTimeout(() => renderWeightChart(), 150);
        }

        const _pending = localStorage.getItem('_pendingCession');
        if (_pending) claimCession(_pending);
    } else {
        if (hasDemoAccess()) {
            showMainApp();
        } else {
            if (mainApp) mainApp.style.display = 'none';
            if (landing) landing.style.display = 'block';
            updateDemoModeUI();
        }
    }
});

window.openLocalApp = function() {
    const authPage = document.getElementById('auth-page');
    const landing = document.getElementById('landing-page');
    if (auth.currentUser || hasDemoAccess()) {
        showMainApp();
        return;
    }
    if (landing) landing.style.display = 'none';
    if (authPage) authPage.style.display = 'flex';
};

window.enterApp = window.openLocalApp;

window.toggleAuthMode = () => {
    const btn        = document.getElementById('auth-action-btn');
    const subtitle   = document.getElementById('auth-subtitle');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.getElementById('auth-switch-link');
    const pwInput    = document.getElementById('auth-password');

    if (!btn) return;
    const isLoginMode = btn.textContent === 'Se connecter';

    btn.textContent        = isLoginMode ? 'Créer mon compte' : 'Se connecter';
    subtitle.textContent   = isLoginMode ? 'Rejoignez la meute et gérez la santé de votre chien.' : 'Connectez-vous pour retrouver votre compagnon.';
    switchText.textContent = isLoginMode ? 'Déjà un compte ?' : 'Pas encore de compte ?';
    switchLink.textContent = isLoginMode ? 'Se connecter' : 'Créer un compte';
    if (pwInput) pwInput.autocomplete = isLoginMode ? 'new-password' : 'current-password';
};

window.processAuth = async () => {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!email || !password) { window.showAuthMsg("Veuillez remplir tous les champs. 🐾", "error"); return; }
    if (password.length < 6)  { window.showAuthMsg("Le mot de passe doit faire au moins 6 caractères.", "error"); return; }

    const btn          = document.getElementById('auth-action-btn');
    const originalText = btn.textContent;
    const isLoginMode  = originalText === 'Se connecter';

    btn.textContent = "Chargement...";
    btn.disabled = true;
    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
            window.showAuthMsg("Compte créé avec succès ! Bienvenue ! 🎉", "success");
        }
    } catch (error) {
        let friendlyMessage = error.message;
        if (error.code === 'auth/email-already-in-use') friendlyMessage = "Cet email est déjà utilisé.";
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') friendlyMessage = "Identifiants incorrects.";
        if (error.code === 'auth/user-not-found') friendlyMessage = "Aucun utilisateur trouvé avec cet email.";
        if (error.code === 'auth/invalid-email') friendlyMessage = "Adresse email invalide.";
        window.showAuthMsg(`Erreur : ${friendlyMessage}`, "error");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

window.processGoogleAuth = async () => {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        window.showAuthMsg(`Erreur Google : ${error.message}`, "error");
    }
};

window.processResetPassword = async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email) { window.showAuthMsg("⚠️ Veuillez entrer une adresse email.", "error"); return; }
    try {
        await sendPasswordResetEmail(auth, email);
        window.showAuthMsg("🐾 Lien envoyé ! Vérifiez votre boîte mail.", "success");
    } catch (error) {
        window.showAuthMsg("❌ Erreur : " + error.message, "error");
    }
};

window.logoutApp = async () => {
    try { 
        await signOut(auth); 
        clearAppLocalData();
        localStorage.removeItem('_pablo_owner_uid');
        location.reload(); 
    } catch (error) { 
        console.error("Erreur déconnexion:", error); 
    }
};

// ==========================================
// INITIALISATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initGlobalConfig();

    const _pendingCession = localStorage.getItem('_pendingCession') || getCessionParam();
    if (_pendingCession) showPendingCessionBanner(_pendingCession);

    const chatInput = document.getElementById('chat-input-field');
    if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    const weightDate = document.getElementById('weight-date');
    if (weightDate) weightDate.value = new Date().toISOString().split('T')[0];

    const selector = document.getElementById('pet-selector');
    if (selector) selector.addEventListener('change', (e) => switchPet(e.target.value));

    const mobileSelector = document.getElementById('mobile-pet-selector');
    if (mobileSelector) mobileSelector.addEventListener('change', (e) => switchPet(e.target.value));

    initPwaInstallButton();
    setCloudStatus(navigator.onLine ? 'idle' : 'offline', navigator.onLine ? 'Local' : 'Hors ligne');
});

function initPwaInstallButton() {
    const btn = document.getElementById('pwa-install-btn');
    if (!btn) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    btn.hidden = isStandalone || !deferredPwaInstallPrompt;
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    initPwaInstallButton();
});

window.addEventListener('appinstalled', () => {
    deferredPwaInstallPrompt = null;
    initPwaInstallButton();
    showToast('Pablo est installe sur cet appareil.', '✅');
});

window.installPabloApp = async function() {
    if (!deferredPwaInstallPrompt) {
        showToast("Installation non disponible sur ce navigateur.", 'ℹ️');
        return;
    }

    deferredPwaInstallPrompt.prompt();
    await deferredPwaInstallPrompt.userChoice.catch(() => null);
    deferredPwaInstallPrompt = null;
    initPwaInstallButton();
};

function initGlobalConfig() {
    const saved = localStorage.getItem(GLOBAL_CONFIG_ID);
    if (saved) {
        const config = JSON.parse(saved);
        if (config.lightMode) document.body.classList.add('light-mode');
    }
}

window.toggleTheme = () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ lightMode: isLight }));
    renderWeightChart();
};

const _cloudSaveTimers = {};
async function saveLocalData(petId, key, data) {
    const storageKey = `${key}_${petId}`;
    localStorage.setItem(storageKey, JSON.stringify(data));
    if (!auth.currentUser || hasDemoAccess()) return;
    clearTimeout(_cloudSaveTimers[storageKey]);
    _cloudSaveTimers[storageKey] = setTimeout(() => {
        saveCloudFields({ [storageKey]: data });
    }, CLOUD_SYNC_DEBOUNCE_MS);
}

function getLocalData(petId, key, defaultValue) {
    const data = localStorage.getItem(`${key}_${petId}`);
    return data ? JSON.parse(data) : defaultValue;
}

function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getDefaultHealthExtras() {
    return {
        allergies: '',
        vetName: '',
        vetPhone: '',
        kibbleBag: 0,
        kibbleRemaining: 0,
        insurance: '',
        foodName: '',
        chronicConditions: '',
        recurringTreatment: '',
        emergencyNotes: ''
    };
}

function readHealthExtras(petId = currentPetId) {
    return { ...getDefaultHealthExtras(), ...getLocalData(petId, 'healthExtras', {}) };
}

function getProfileHealthScore(profile = petProfile, extras = healthExtras) {
    const checks = [
        { key: 'name', label: 'nom', done: Boolean(profile?.name) },
        { key: 'species', label: 'espece', done: Boolean(profile?.species) },
        { key: 'breed', label: 'race', done: Boolean(profile?.breed) },
        { key: 'age', label: 'age', done: Number(profile?.age) > 0 || Boolean(profile?.birthDate) },
        { key: 'weight', label: 'poids', done: Number(profile?.weight) > 0 },
        { key: 'vet', label: 'veterinaire', done: Boolean(extras?.vetName || extras?.vetPhone) },
        { key: 'alerts', label: 'allergies/traitements', done: Boolean(extras?.allergies || extras?.chronicConditions || extras?.recurringTreatment) },
        { key: 'food', label: 'alimentation', done: Boolean(extras?.foodName || extras?.kibbleBag) },
        { key: 'status', label: 'sterilisation', done: Boolean(profile?.sterilized) }
    ];
    const completed = checks.filter(item => item.done).length;
    return {
        completed,
        total: checks.length,
        score: Math.round((completed / checks.length) * 100),
        missing: checks.filter(item => !item.done).map(item => item.label)
    };
}

function getTodayIsoDate() {
    return new Date().toISOString().split('T')[0];
}

function getAgeMonthsFromBirthDate(value) {
    if (!value) return 0;
    const birthDate = new Date(value);
    if (Number.isNaN(birthDate.getTime())) return 0;
    const now = new Date();
    let months = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());
    if (now.getDate() < birthDate.getDate()) months -= 1;
    return Math.max(0, months);
}

function getPhoneHref(phone) {
    return String(phone || '').replace(/[^\d+]/g, '');
}

function getPetsListFromStorage() {
    try {
        return JSON.parse(localStorage.getItem('app_pets_list') || '[]');
    } catch (e) {
        return [];
    }
}

function hasLocalAppData() {
    return getPetsListFromStorage().length > 0 && localStorage.getItem('pablo_onboarded') === '1';
}

function hasDemoAccess() {
    return localStorage.getItem(DEMO_MODE_KEY) === '1'
        && getPetsListFromStorage().some(p => String(p.id).startsWith('demo_'));
}

function setLocalDataOnly(petId, key, data) {
    localStorage.setItem(`${key}_${petId}`, JSON.stringify(data));
}

function updateDemoModeUI() {
    const isDemo = localStorage.getItem(DEMO_MODE_KEY) === '1';
    document.body.classList.toggle('demo-mode', isDemo);
    const banner = document.getElementById('demo-mode-banner');
    if (banner) banner.style.display = isDemo ? 'flex' : 'none';
}

function showMainApp() {
    const landing = document.getElementById('landing-page');
    const authPage = document.getElementById('auth-page');
    const mainApp = document.getElementById('main-app-layout');

    if (!auth.currentUser && !hasDemoAccess()) {
        if (mainApp) mainApp.style.display = 'none';
        if (landing) landing.style.display = 'none';
        if (authPage) authPage.style.display = 'flex';
        updateDemoModeUI();
        return;
    }

    document.getElementById('onboarding-overlay')?.classList.remove('open');
    if (landing) landing.style.display = 'none';
    if (authPage) authPage.style.display = 'none';
    initApp();
    if (mainApp) {
        mainApp.style.display = 'flex';
        setTimeout(() => renderWeightChart(), 150);
    }
    updateDemoModeUI();
}

// ==========================================
// GESTION MULTI-ANIMAUX
// ==========================================
function initApp() {
    petsList = getPetsListFromStorage();

    if (petsList.length === 0) {
        currentPetId = null;
        localStorage.removeItem('current_pet_id');
        renderPetSelector();
        if (!localStorage.getItem('_pendingCession') && typeof window.createNewPet === 'function') {
            setTimeout(() => window.createNewPet(), 350);
        }
        updateDemoModeUI();
        return;
    }

    currentPetId = localStorage.getItem('current_pet_id') || petsList[0].id;
    renderPetSelector();
    loadCurrentPetData();
    updateDemoModeUI();
}

function renderPetSelector() {
    const label    = document.getElementById('pet-selector-label');
    const list     = document.getElementById('pet-selector-list');
    const current  = petsList.find(p => p.id === currentPetId);
    if (label) label.textContent = current ? current.name : '—';
    if (list) {
        list.innerHTML = '';
        petsList.forEach(pet => {
            const div = document.createElement('div');
            div.className = 'custom-pet-select__option' + (pet.id === currentPetId ? ' selected' : '');
            div.textContent = pet.name;
            div.onclick = () => { closePetDropdowns(); switchPet(pet.id); };
            list.appendChild(div);
        });
    }

    const mLabel   = document.getElementById('mobile-pet-selector-label');
    const mList    = document.getElementById('mobile-pet-selector-list');
    const mWrap    = document.getElementById('mobile-pet-selector-wrap');
    if (mLabel) mLabel.textContent = current ? current.name : '—';
    if (mWrap)  mWrap.style.display = petsList.length > 0 ? '' : 'none';
    if (mList) {
        mList.innerHTML = '';
        petsList.forEach(pet => {
            const div = document.createElement('div');
            div.className = 'custom-pet-select__option' + (pet.id === currentPetId ? ' selected' : '');
            div.textContent = pet.name;
            div.onclick = () => { closePetDropdowns(); switchPet(pet.id); };
            mList.appendChild(div);
        });
    }
}

window.togglePetDropdown = function(wrapId) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const isOpen = wrap.classList.contains('open');
    closePetDropdowns();
    if (!isOpen) wrap.classList.add('open');
};

function closePetDropdowns() {
    document.querySelectorAll('.custom-pet-select.open').forEach(el => el.classList.remove('open'));
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-pet-select')) closePetDropdowns();
});

window.switchPet = function(petId) {
    currentPetId = petId;
    localStorage.setItem('current_pet_id', currentPetId);
    saveCloudFields({ current_pet_id: currentPetId });
    loadCurrentPetData();
    navigateTo('screen-home');
};

window.createNewPet = function() {
    const modal = document.getElementById('add-pet-modal');
    if (modal) {
        modal.classList.add('open');
        const nameInput = document.getElementById('new-pet-name-input');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        const breedInput = document.getElementById('new-pet-breed-input');
        if (breedInput) breedInput.value = '';
    }
};

window.closePetModal = function() {
    const modal = document.getElementById('add-pet-modal');
    if (modal) modal.classList.remove('open');
};

window.confirmCreateNewPet = function() {
    const name    = document.getElementById('new-pet-name-input').value.trim();
    const species = document.getElementById('new-pet-species-input').value;
    const breed   = document.getElementById('new-pet-breed-input').value.trim();
    if (!name) { showToast("Le nom ne peut pas être vide ! 🐾", "⚠️", "error"); return; }

    const newId = 'pet_' + Date.now();
    petsList.push({ id: newId, name });
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    saveCloudFields({ app_pets_list: petsList, current_pet_id: newId });

    saveLocalData(newId, 'profile',      { name, species, breed, age: 0, size: 0, weight: 0, avatar: "", birthDate: "", sterilized: "", breedAdvice: "" });
    saveLocalData(newId, 'weight',      []);
    saveLocalData(newId, 'medical',     []);
    saveLocalData(newId, 'education',   {});
    saveLocalData(newId, 'daily',       { water: 0, walk: 0, date: new Date().toISOString().split('T')[0] });
    saveLocalData(newId, 'chat',        [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${name}. Comment puis-je aider ?` }]);
    saveLocalData(newId, 'budget',      []);
    saveLocalData(newId, 'proData',     { gender: 'Non spécifié' });
    saveLocalData(newId, 'proEvents',   []);
    saveLocalData(newId, 'proLitters',  []);
    saveLocalData(newId, 'healthExtras', getDefaultHealthExtras());
    saveLocalData(newId, 'proHistory',  { heats: [], matings: [] });
    saveLocalData(newId, 'memories',    []);
    saveLocalData(newId, 'gamification', { streak: 0, lastLogin: null, badges: [] });

    trackEvent('pet_created');
    closePetModal();
    switchPet(newId);
}

function loadCurrentPetData() {
    if (!currentPetId) return; 
    initPetProfile();
    initWeightHistory();
    initMedicalRecords();
    initEducation();
    initDailyTrackers();
    initChat();
    initBudgetTracker();
    initProData();
    initHealthExtras();
    initProHistory();
    initMemories();
    initGamification();
    initRegistre();
}

window.deleteCurrentPet = function() {
    showConfirm(`Supprimer ${escHtml(petProfile.name)} ?`, () => { _doDeleteCurrentPet(); });
};

function _doDeleteCurrentPet() {
    const keys = ['profile','weight','medical','education','daily','chat','budget','proData','proEvents','proLitters','healthExtras','proHistory','memories','gamification','custom_exercises'];
    const removedPetId = currentPetId;
    keys.forEach(key => localStorage.removeItem(`${key}_${currentPetId}`));
    petsList = petsList.filter(p => p.id !== currentPetId);
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    deleteCloudFields(keys.map(key => `${key}_${removedPetId}`));
    saveCloudFields({ app_pets_list: petsList });

    if (petsList.length === 0) {
        currentPetId = null;
        localStorage.removeItem('current_pet_id');
        initApp();
    } else {
        switchPet(petsList[0].id);
    }
}

// ==========================================
// PROFIL & ENCYCLOPEDIE (OPENAI SECURE ROUTER)
// ==========================================
async function updateBreedAdviceUI() {
    const adviceCard      = document.getElementById('breed-advice-card');
    const adviceBreedName = document.getElementById('advice-breed-name');
    const adviceContent   = document.getElementById('breed-advice-content');
    if (!adviceCard) return;

    if (!petProfile.breed || petProfile.breed.trim() === '') { adviceCard.style.display = 'none'; return; }
    adviceCard.style.display = 'block';
    if (adviceBreedName) adviceBreedName.innerText = petProfile.breed;

    if (petProfile.breedAdvice) { if (adviceContent) adviceContent.innerHTML = petProfile.breedAdvice; return; }
    if (adviceContent) adviceContent.innerHTML = "<div style='text-align:center; padding:20px;'><i class='fa-solid fa-spinner fa-spin' style='font-size:24px; color:var(--gold);'></i><br><br><span style='color:var(--text-muted); font-size:13px;'>Génération de l'encyclopédie via OpenAI…</span></div>";

    try {
        const prompt = `Tu es un expert canin. Rédige une documentation complète pour un ${petProfile.species || 'animal'} de race ${petProfile.breed}.
Structure ta réponse en HTML propre avec ces sections en balises <h4> (avec emojis pertinents) :
<h4>Comportement & Caractère</h4>
<h4>Besoins en exercice</h4>
<h4>Santé & Toilettage</h4>
<h4>Conseil d'éducation</h4>
Utilise des paragraphes <p> et des listes <ul><li>. Pas d'introduction ni de conclusion, envoie uniquement le HTML propre.`;

        const text  = await groqChat([{ role: "user", content: prompt }]);
        const clean = text.replace(/```html|```/g, '').trim();

        petProfile.breedAdvice = clean;
        saveLocalData(currentPetId, 'profile', petProfile);
        if (adviceContent) adviceContent.innerHTML = clean;
    } catch (error) {
        console.error("Erreur encyclopédie OpenAI:", error);
        if (adviceContent) adviceContent.innerText = `Documentation indisponible (${error.message}).`;
    }
}

// ==========================================
// NUTRITION EXPERTE (ÂGE + RACE)
// ==========================================
window.updateNutritionUI = async function() {
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const activitySelector    = document.getElementById('activity-level-selector');

    if (!petProfile.weight || !nutritionRationText || !activitySelector) return;

    const weight = parseFloat(petProfile.weight);
    const ageMonths = parseInt(petProfile.age) || 24; // Par défaut adulte si non renseigné
    const breed = petProfile.breed || 'Inconnue';
    const species = (petProfile.species || 'chien').toLowerCase();
    const activity = activitySelector.value;

    nutritionRationText.style.fontSize = '16px';
    nutritionRationText.innerText      = 'Calcul…';

    try {
        const prompt = `Tu es un vétérinaire nutritionniste expert. Calcule la ration QUOTIDIENNE (en grammes) de croquettes pour ce profil strict :
        - Espèce : ${species}
        - Race : ${breed}
        - Âge : ${ageMonths} mois
        - Poids actuel : ${weight} kg
        - Niveau d'activité : ${activity}
        
        Calcule le besoin énergétique (RER/MER) en fonction de sa RACE et de son ÂGE. On estime que des croquettes standard font environ 380 kcal/100g.
        NE FAIS AUCUNE PHRASE. Réponds UNIQUEMENT par le chiffre suivi de la lettre g (ex: 420g).`;

        const aiText = await groqChat([{ role: "user", content: prompt }]);
        nutritionRationText.style.fontSize = '';

        const match = aiText.match(/\d+\s*g/i);
        if (match) {
            nutritionRationText.innerText = match[0].toLowerCase().replace(' ', '');
        } else {
            const nums = aiText.match(/\d+/);
            if (nums) nutritionRationText.innerText = nums[0] + 'g';
            else throw new Error("Format IA non reconnu");
        }
    } catch (e) {
        console.warn("Calcul IA échoué, utilisation de la formule locale (Poids + Âge).");
        
        const RER = 70 * Math.pow(weight, 0.75);
        let factor = 1.6;
        
        if (species === 'chien') {
            if (ageMonths < 4) factor = 3.0;
            else if (ageMonths < 12) factor = 2.0;
            else if (activity === 'calm') factor = 1.2;
            else if (activity === 'active') factor = 2.0;
        } else {
            if (ageMonths < 6) factor = 2.5;
            else if (ageMonths < 12) factor = 2.0;
            else if (activity === 'calm') factor = 1.0;
            else if (activity === 'active') factor = 1.4;
        }
        
        const MER = RER * factor;
        const baseRation = Math.round(MER / 3.8);
        
        nutritionRationText.style.fontSize = '';
        nutritionRationText.innerText = baseRation + 'g';
    }
};

// ==========================================
// CHAT ASSISTANT
function formatDateFr(value) {
    if (!value) return 'date inconnue';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function summarizeWeightForAI() {
    const sorted = [...(weightHistory || [])]
        .filter(w => w?.date && Number(w.weight) > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sorted.length === 0) return 'Aucune pesee renseignee.';

    const latest = sorted[sorted.length - 1];
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    const trend = previous ? `, evolution recente: ${(Number(latest.weight) - Number(previous.weight)).toFixed(1)} kg` : '';
    return `${latest.weight} kg le ${formatDateFr(latest.date)}${trend}.`;
}

function summarizeMedicalForAI() {
    const sorted = [...(medicalEvents || [])]
        .filter(e => e?.date || e?.type || e?.name)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 5);
    if (sorted.length === 0) return 'Aucun acte medical renseigne.';
    return sorted.map(e => `${e.type || e.name || 'Acte'} (${formatDateFr(e.date)}${e.notes ? `, ${e.notes}` : ''})`).join(' ; ');
}

function summarizeBudgetForAI() {
    const month = new Date().toISOString().slice(0, 7);
    const total = (budgetExpenses || [])
        .filter(e => String(e.date || '').startsWith(month))
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return total > 0 ? `${total.toFixed(2)} EUR ce mois-ci.` : 'Aucune depense ce mois-ci.';
}

function summarizeReproForAI() {
    const litters = Array.isArray(proLitters) ? proLitters : [];
    const lastLitter = litters.length ? litters[litters.length - 1] : null;
    if (!lastLitter) return 'Aucune portee renseignee.';
    const puppies = Array.isArray(lastLitter.puppies) ? lastLitter.puppies.length : (lastLitter.count || 0);
    return `Derniere portee: ${lastLitter.id || lastLitter.name || 'portee'} (${puppies} chiot(s), naissance ${formatDateFr(lastLitter.birthDate || lastLitter.date)}).`;
}

function buildPabloSystemPrompt() {
    const allergies = healthExtras?.allergies?.trim() || 'aucune allergie renseignee';
    const chronic = healthExtras?.chronicConditions?.trim() || 'aucune pathologie renseignee';
    const treatment = healthExtras?.recurringTreatment?.trim() || 'aucun traitement recurrent renseigne';
    const food = healthExtras?.foodName?.trim() || 'alimentation non renseignee';
    const daily = dailyTrackers || {};
    const memories = (memoriesList || []).slice(-3).map(m => m.text || m.title || m).filter(Boolean).join(' ; ') || 'aucun souvenir recent';

    return [
        "Tu es Hey Pablo, assistant specialise en bien-etre animal pour l'application Pablo.",
        "Tu reponds uniquement aux sujets lies aux animaux: sante preventive, alimentation, education, comportement, elevage, organisation du carnet.",
        "Tu ne poses jamais de diagnostic medical ferme, tu ne prescris pas de medicament, et tu recommandes un veterinaire en cas de symptome grave, douleur, urgence, doute important ou aggravation.",
        "Tu es clair, concis, chaleureux, avec des etapes actionnables. Tu finis par un wouf ou un miaou quand c'est naturel.",
        "N'utilise pas de Markdown brut: pas d'asterisques, pas de gras **texte**, pas de tableaux. Fais des reponses aerées avec des lignes courtes.",
        `Profil: ${petProfile.name || "l'animal"} | espece: ${petProfile.species || 'Chien'} | race: ${petProfile.breed || 'inconnue'} | age: ${petProfile.age || '?'} mois | poids profil: ${petProfile.weight || '?'} kg | taille: ${petProfile.size || '?'} cm | sterilisation: ${petProfile.sterilized || 'non renseignee'}.`,
        `Sante: allergies/alertes: ${allergies}. Surveillance: ${chronic}. Traitement recurrent: ${treatment}. Derniers actes: ${summarizeMedicalForAI()}`,
        `Nutrition: ${food}. Stock croquettes: ${healthExtras?.kibbleRemaining || 0} kg restants sur sac ${healthExtras?.kibbleBag || 0} kg.`,
        `Poids: ${summarizeWeightForAI()}`,
        `Aujourd'hui: eau ${daily.water || 0} ml, promenade ${daily.walk || 0} min.`,
        `Budget: ${summarizeBudgetForAI()}`,
        `Elevage/officiel: sexe ${proData?.gender || 'non renseigne'}, puce ${proData?.chip || 'non renseignee'}, LOF ${proData?.lof || 'non renseigne'}. ${summarizeReproForAI()}`,
        `Notes memoire: ${memories}.`
    ].join("\n");
}

function getDemoAssistantReply(userText) {
    const normalized = String(userText || '').toLowerCase();
    if (normalized.includes('poids') || normalized.includes('croissance')) {
        return "Dans la demo, Naya a deja une courbe de poids remplie. Sur un vrai compte, Hey Pablo analysera les pesees avec le reste du carnet. Pour l'instant, l'IA live est reservee aux utilisateurs connectes. Wouf !";
    }
    if (normalized.includes('vaccin') || normalized.includes('vermifuge') || normalized.includes('malade')) {
        return "La demo montre les rappels et le carnet medical, mais n'appelle pas l'IA live sans connexion. Pour un vrai conseil personnalise et securise, connectez-vous puis ouvrez votre carnet. En cas de symptome inquietant, veterinaire. Wouf !";
    }
    return "Mode demo : je peux te montrer le fonctionnement, mais l'IA live est volontairement bloquee sans compte. Connecte-toi pour que Hey Pablo utilise le vrai profil de ton animal. Wouf !";
}

function setChatSendingState(isSending) {
    const btn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input-field');
    if (btn) btn.disabled = isSending;
    if (input) input.disabled = isSending;
}

window.sendMessage = async function() {
    const input = document.getElementById('chat-input-field');
    const text  = input?.value.trim();
    if (!text || isChatSending) return;
    isChatSending = true;
    setChatSendingState(true);

    chatHistory.push({ sender: 'user', text });
    input.value = '';
    trackEvent('chat_sent');

    const loadingId  = Date.now();
    const loadingTxt = `<span class="running-dog">🐶</span> <em style="font-size:13px; color:var(--text-muted); margin-left:8px;">Pablo renifle une piste…</em>`;
    chatHistory.push({ sender: 'bot', text: loadingTxt, _id: loadingId, html: true });
    renderChat();

    const systemPrompt = buildPabloSystemPrompt();

    const apiMessages = chatHistory
        .filter(m => !m._id)
        .slice(-10)
        .map(m => ({ role: m.sender === 'bot' ? 'assistant' : 'user', content: m.text }));

    if (!auth.currentUser && hasDemoAccess()) {
        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        chatHistory.push({ sender: 'bot', text: getDemoAssistantReply(text) });
        renderChat();
        await saveLocalData(currentPetId, 'chat', chatHistory);
        isChatSending = false;
        setChatSendingState(false);
        input?.focus();
        return;
    }

    try {
        const replyTx = await groqChat([
            { role: "system", content: systemPrompt },
            ...apiMessages
        ]);

        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        chatHistory.push({ sender: 'bot', text: replyTx });
        renderChat();
        await saveLocalData(currentPetId, 'chat', chatHistory);
    } catch (e) {
        chatHistory = chatHistory.filter(m => m._id !== loadingId);
        const errMsg = e.name === 'AbortError'
            ? '⏱️ Pablo met trop de temps à répondre. Réessaie dans un instant !'
            : '❌ Impossible de contacter Pablo. Vérifie ta connexion internet.';
        chatHistory.push({ sender: 'bot', text: errMsg });
        renderChat();
    }
    isChatSending = false;
    setChatSendingState(false);
    input?.focus();
};

// ==========================================
// POIDS & NUTRITION
// ==========================================
function initPetProfile() {
    petProfile = getLocalData(currentPetId, 'profile', {});
    const profileHealthExtras = readHealthExtras();

    const breedEl = document.getElementById('header-pet-breed');
    if (breedEl) breedEl.innerText = petProfile.breed || 'Compagnon santé';

    const topNameEl = document.getElementById('current-pet-display-top');
    if (topNameEl) topNameEl.innerText = petProfile.name || 'Pablo';

    const profileImg         = document.getElementById('profile-pet-image');
    const profilePlaceholder = document.getElementById('profile-avatar-placeholder');
    if (petProfile.avatar) {
        if (profileImg)         { profileImg.src = petProfile.avatar; profileImg.style.display = 'block'; }
        if (profilePlaceholder) profilePlaceholder.style.display = 'none';
    } else {
        if (profileImg)         profileImg.style.display = 'none';
        if (profilePlaceholder) {
            profilePlaceholder.style.display = 'flex';
            profilePlaceholder.innerText     = (petProfile.name || 'P').charAt(0).toUpperCase();
        }
    }

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    setVal('profile-name',    petProfile.name);
    setVal('profile-breed',   petProfile.breed);
    setVal('profile-age',     petProfile.age);
    setVal('profile-size',    petProfile.size);
    setVal('profile-weight',  petProfile.weight);
    setVal('profile-birthdate', petProfile.birthDate);
    setVal('profile-sterilized', petProfile.sterilized);
    setVal('profile-vet-name', profileHealthExtras.vetName);
    setVal('profile-vet-phone', profileHealthExtras.vetPhone);
    setVal('profile-insurance', profileHealthExtras.insurance);
    setVal('profile-food-name', profileHealthExtras.foodName);
    setVal('profile-allergies', profileHealthExtras.allergies);
    setVal('profile-chronic', profileHealthExtras.chronicConditions);
    setVal('profile-treatment', profileHealthExtras.recurringTreatment);
    setVal('profile-emergency-notes', profileHealthExtras.emergencyNotes);

    document.querySelectorAll('.dynamic-pet-name').forEach(el => el.innerText = petProfile.name || 'Pablo');

    updateBreedAdviceUI();
    updateProfileQualityScore(petProfile, profileHealthExtras);
}

function updateProfileQualityScore(profile = petProfile, extras = healthExtras) {
    const textEl = document.getElementById('profile-quality-text');
    const fillEl = document.getElementById('profile-quality-fill');
    const hintEl = document.getElementById('profile-quality-hint');
    if (!textEl || !fillEl || !hintEl) return;

    const result = getProfileHealthScore(profile, extras);
    textEl.innerText = `${result.score}%`;
    fillEl.style.width = `${result.score}%`;
    fillEl.style.background = result.score >= 80
        ? 'linear-gradient(90deg, var(--success), #8ee6aa)'
        : result.score >= 55
            ? 'linear-gradient(90deg, var(--warning), var(--gold))'
            : 'linear-gradient(90deg, var(--danger), var(--warning))';
    hintEl.innerText = result.score >= 80
        ? 'Dossier solide : les rappels et Hey Pablo ont le bon contexte.'
        : `A compléter : ${result.missing.slice(0, 3).join(', ')}.`;
}

window.savePetProfile = function() {
    const name      = document.getElementById('profile-name').value.trim();
    if (!name) { showToast("Le nom est obligatoire.", "⚠️", "error"); return; }
    const weight    = parseFloat(document.getElementById('profile-weight').value);
    const newBreed  = document.getElementById('profile-breed').value.trim();
    const birthDate = document.getElementById('profile-birthdate')?.value || '';
    const ageInput  = parseInt(document.getElementById('profile-age').value) || 0;

    if (petProfile.breed !== newBreed) petProfile.breedAdvice = '';
    petProfile.name  = name;
    petProfile.breed = newBreed;
    petProfile.age   = ageInput || getAgeMonthsFromBirthDate(birthDate);
    petProfile.size  = parseInt(document.getElementById('profile-size').value) || 0;
    petProfile.birthDate = birthDate;
    petProfile.sterilized = document.getElementById('profile-sterilized')?.value || '';

    if (weight && weight !== petProfile.weight) {
        weightHistory.push({ date: getTodayIsoDate(), weight });
        saveLocalData(currentPetId, 'weight', weightHistory);
    }
    petProfile.weight = weight || petProfile.weight;
    saveLocalData(currentPetId, 'profile', petProfile);

    healthExtras = {
        ...readHealthExtras(),
        vetName: document.getElementById('profile-vet-name')?.value.trim() || '',
        vetPhone: document.getElementById('profile-vet-phone')?.value.trim() || '',
        insurance: document.getElementById('profile-insurance')?.value.trim() || '',
        foodName: document.getElementById('profile-food-name')?.value.trim() || '',
        allergies: document.getElementById('profile-allergies')?.value.trim() || '',
        chronicConditions: document.getElementById('profile-chronic')?.value.trim() || '',
        recurringTreatment: document.getElementById('profile-treatment')?.value.trim() || '',
        emergencyNotes: document.getElementById('profile-emergency-notes')?.value.trim() || ''
    };
    saveLocalData(currentPetId, 'healthExtras', healthExtras);
    updateProfileQualityScore(petProfile, healthExtras);

    const petObj = petsList.find(p => p.id === currentPetId);
    if (petObj) {
        petObj.name = name;
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        saveCloudFields({ app_pets_list: petsList });
        renderPetSelector();
    }

    loadCurrentPetData();
    showToast(`Profil de ${name} enregistré ! 🐾`);
    navigateTo('screen-home');
};

window.uploadPetPhoto = function() {
    const file = document.getElementById('file-upload-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
        petProfile.avatar = reader.result;
        const img         = document.getElementById('profile-pet-image');
        const placeholder = document.getElementById('profile-avatar-placeholder');
        if (img)         { img.src = reader.result; img.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        saveLocalData(currentPetId, 'profile', petProfile);
    };
    reader.readAsDataURL(file);
};

function initWeightHistory() {
    weightHistory = getLocalData(currentPetId, 'weight', []);
    updateWeightUI();
    renderWeightChart();
}

function updateWeightUI() {
    const nutritionWeightText = document.getElementById('nutrition-weight-text');
    const nutritionRationText = document.getElementById('nutrition-ration-text');
    const waterTargetText     = document.getElementById('water-target-text');

    if (weightHistory.length === 0) {
        if (nutritionWeightText) nutritionWeightText.innerText = '-- kg';
        if (nutritionRationText) nutritionRationText.innerText = '-- g';
        if (waterTargetText)     waterTargetText.innerText     = 'Objectif eau : -- ml';
        return;
    }

    weightHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = weightHistory[weightHistory.length - 1].weight;
    petProfile.weight = latest;
    saveLocalData(currentPetId, 'profile', petProfile);

    if (nutritionWeightText) nutritionWeightText.innerText = latest.toFixed(1) + ' kg';
    if (waterTargetText)     waterTargetText.innerText     = `Objectif eau : ${Math.round(latest * 55)} ml`;

    updateNutritionUI();
    generateTransitionPlan();
}

window.addNewWeight = function() {
    const weightVal = parseFloat(document.getElementById('weight-input').value);
    const dateVal   = document.getElementById('weight-date').value;
    if (!weightVal || !dateVal || weightVal <= 0) { showToast("Valeurs invalides.", "⚠️", "error"); return; }
    weightHistory.push({ date: dateVal, weight: weightVal });
    trackEvent('weight_added');
    saveLocalData(currentPetId, 'weight', weightHistory);
    updateWeightUI();
    renderWeightChart();
    document.getElementById('weight-input').value = '';
};

function renderWeightChart() {
    const canvas = document.getElementById('weightChart');
    if (!canvas) return;
    if (!window.Chart) {
        ensureChartJs()
            .then(() => renderWeightChart())
            .catch(() => console.warn('Chart.js indisponible pour la courbe de poids.'));
        return;
    }
    weightHistory.sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels    = weightHistory.map(i => new Date(i.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }));
    const values    = weightHistory.map(i => i.weight);
    const isLight   = document.body.classList.contains('light-mode');
    const lineColor = isLight ? '#a87020' : '#c8922a';
    const bgColor   = isLight ? 'rgba(168,112,32,0.08)' : 'rgba(200,146,42,0.1)';
    const gridColor = isLight ? '#e8dfc8' : '#2a2215';
    const tickColor = isLight ? '#6b5038' : '#b8a88a';

    if (weightChartInstance) weightChartInstance.destroy();
    weightChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Poids (kg)',
                data: values,
                borderColor: lineColor,
                backgroundColor: bgColor,
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: lineColor,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: gridColor }, ticks: { color: tickColor } },
                x: { grid: { display: false },   ticks: { color: tickColor } }
            }
        }
    });
}

// ==========================================
// TRACKERS QUOTIDIENS
// ==========================================
function initDailyTrackers() {
    const today = new Date().toISOString().split('T')[0];
    dailyTrackers = getLocalData(currentPetId, 'daily', { water: 0, walk: 0, date: today });
    if (dailyTrackers.date !== today) {
        dailyTrackers = { water: 0, walk: 0, date: today };
        saveLocalData(currentPetId, 'daily', dailyTrackers);
    }
    updateTrackersUI();
}

function updateTrackersUI() {
    const waterEl = document.getElementById('water-current-text');
    const walkEl  = document.getElementById('walk-current-text');
    if (waterEl) waterEl.innerText = `${dailyTrackers.water} ml`;
    if (walkEl)  walkEl.innerText  = `${dailyTrackers.walk} min`;
}

window.addWater = function(delta = 250) { dailyTrackers.water = Math.max(0, dailyTrackers.water + delta); saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); showToast(delta > 0 ? `+${delta} ml 💧` : `${delta} ml 💧`); };
window.addWalk  = function(delta = 15)  { dailyTrackers.walk  = Math.max(0, dailyTrackers.walk  + delta); saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); showToast(delta > 0 ? `+${delta} min 🐾` : `${delta} min 🐾`); };
window.resetDailyTrackers = function() {
    dailyTrackers.water = 0;
    dailyTrackers.walk  = 0;
    saveLocalData(currentPetId, 'daily', dailyTrackers);
    updateTrackersUI();
    showToast('Trackers remis à zéro', '🔄');
};

// ==========================================
// CARNET MÉDICAL & RAPPELS
// ==========================================
function initMedicalRecords() {
    medicalEvents = getLocalData(currentPetId, 'medical', []);
    renderMedicalHistory();
    renderReminders();
}

window.addMedicalEvent = function() {
    const type = document.getElementById('event-type').value;
    const date = document.getElementById('event-date').value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    medicalEvents.push({ type, date });
    trackEvent('medical_event_added');
    saveLocalData(currentPetId, 'medical', medicalEvents);
    renderMedicalHistory();
    renderReminders();
    document.getElementById('event-date').value = '';
    showToast(`${type} enregistré !`, '✅');
};

function renderMedicalHistory() {
    const list = document.getElementById('medical-history-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...medicalEvents].sort((a, b) => new Date(b.date) - new Date(a.date));
    sorted.forEach(ev => {
        const item      = document.createElement('div');
        item.className  = 'log-item';
        const note = ev.notes ? `<small style="display:block; color:var(--text-muted); margin-top:3px; line-height:1.35;">${escHtml(String(ev.notes).slice(0, 180))}${String(ev.notes).length > 180 ? '...' : ''}</small>` : '';
        item.innerHTML  = `<span style="color:var(--text-sub);">${escHtml(ev.type)}${note}</span><strong style="color:var(--text-muted); font-size:12.5px;">${new Date(ev.date).toLocaleDateString('fr-FR')}</strong>`;
        list.appendChild(item);
    });
    if (sorted.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucun acte enregistré.</p>';
}

window.clearMedicalHistory = function() {
    showConfirm(`Vider l'historique de ${escHtml(petProfile.name)} ?`, () => {
        medicalEvents = [];
        saveLocalData(currentPetId, 'medical', medicalEvents);
        renderMedicalHistory();
        renderReminders();
    });
};

const CARE_RULES = {
    'Vaccin': { days: 365, warn: 30, icon: 'fa-syringe' },
    'Vermifuge': { days: 90, warn: 14, icon: 'fa-pills' },
    'Anti-puces': { days: 30, warn: 7, icon: 'fa-shield-dog' },
    'Toilettage': { days: 90, warn: 14, icon: 'fa-scissors' },
    'Dents': { days: 7, warn: 2, icon: 'fa-tooth' },
    'Oreilles': { days: 30, warn: 7, icon: 'fa-ear-listen' },
    'Griffes': { days: 60, warn: 10, icon: 'fa-paw' }
};

function getLastCareDate(type) {
    const sorted = medicalEvents
        .filter(event => event.type === type)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    return sorted.length > 0 ? new Date(sorted[0].date) : null;
}

function getDaysBetween(a, b) {
    const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.floor((dayA - dayB) / 86400000);
}

function buildReminderItemHtml(item) {
    return `
        <div class="reminder-item reminder-item--${item.level}">
            <div class="reminder-icon"><i class="fa-solid ${item.icon || 'fa-calendar-check'}"></i></div>
            <div class="reminder-copy">
                <h4>${escHtml(item.title)}</h4>
                <span>${escHtml(item.detail)}</span>
            </div>
            <span class="badge ${item.badgeClass}">${escHtml(item.badge)}</span>
        </div>`;
}

function renderReminders() {
    const container = document.getElementById('dynamic-reminders-list');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date();
    const items = [];

    Object.entries(CARE_RULES).forEach(([type, rule]) => {
        const lastDate = getLastCareDate(type);
        const daysSince = lastDate ? getDaysBetween(today, lastDate) : null;
        const daysLeft = lastDate ? rule.days - daysSince : -1;
        if (!lastDate || daysLeft < 0) {
            items.push({
                level: 'danger',
                icon: rule.icon,
                title: `${type} requis`,
                detail: `Dernier acte : ${lastDate ? lastDate.toLocaleDateString('fr-FR') : 'jamais'}`,
                badge: 'A faire',
                badgeClass: 'badge-danger',
                priority: 1
            });
        } else if (daysLeft <= rule.warn) {
            items.push({
                level: 'warning',
                icon: rule.icon,
                title: `${type} bientôt`,
                detail: `A prévoir dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`,
                badge: `J-${daysLeft}`,
                badgeClass: 'badge-warning',
                priority: 2
            });
        }
    });

    const profileScore = getProfileHealthScore(petProfile, healthExtras);
    if (profileScore.score < 70) {
        items.push({
            level: 'warning',
            icon: 'fa-id-card-clip',
            title: 'Dossier santé à compléter',
            detail: `Manque : ${profileScore.missing.slice(0, 3).join(', ')}`,
            badge: `${profileScore.score}%`,
            badgeClass: 'badge-warning',
            priority: 2
        });
    }

    if (healthExtras.recurringTreatment) {
        items.push({
            level: 'gold',
            icon: 'fa-prescription-bottle-medical',
            title: 'Traitement récurrent',
            detail: healthExtras.recurringTreatment,
            badge: 'Suivi',
            badgeClass: 'badge-gold',
            priority: 3
        });
    }

    const remaining = Number(healthExtras.kibbleRemaining) || 0;
    if (remaining > 0 && petProfile.weight > 0) {
        const dailyRation = (petProfile.weight * 13.5) / 1000;
        const daysLeft = Math.floor(remaining / dailyRation);
        if (daysLeft <= 7) {
            items.push({
                level: daysLeft <= 3 ? 'danger' : 'warning',
                icon: 'fa-bowl-food',
                title: 'Stock croquettes',
                detail: `${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}`,
                badge: daysLeft <= 3 ? 'Urgent' : 'Bientôt',
                badgeClass: daysLeft <= 3 ? 'badge-danger' : 'badge-warning',
                priority: daysLeft <= 3 ? 1 : 2
            });
        }
    }

    if (proData.gender !== 'Mâle' && proData.expectedBirth && !proData.actualBirth) {
        const birthDate   = new Date(proData.expectedBirth);
        const daysToBirth = Math.ceil((birthDate - today) / 86400000);
        if (daysToBirth >= -5 && daysToBirth <= 30) {
            items.push({
                level: 'warning',
                icon: 'fa-baby-carriage',
                title: 'Mise à bas prévue',
                detail: birthDate.toLocaleDateString('fr-FR'),
                badge: `J-${daysToBirth}`,
                badgeClass: 'badge-warning',
                priority: 2
            });
        }
    }

    if (proData.gender !== 'Mâle' && proData.heatReminder && proHistory.heats.length > 0) {
        const sorted   = [...proHistory.heats].sort((a, b) => new Date(b.date) - new Date(a.date));
        const lastHeat = new Date(sorted[0].date);
        const nextHeat = new Date(lastHeat);
        nextHeat.setMonth(nextHeat.getMonth() + 6);
        const daysToHeat = Math.ceil((nextHeat - today) / 86400000);
        if (daysToHeat >= 0 && daysToHeat <= 30) {
            items.push({
                level: 'danger',
                icon: 'fa-venus',
                title: 'Prochaines chaleurs',
                detail: `Estimées le ${nextHeat.toLocaleDateString('fr-FR')}`,
                badge: 'Attention',
                badgeClass: 'badge-danger',
                priority: 1
            });
        }
    }

    const upcoming = proEvents.filter(e => new Date(e.date) > today).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (upcoming.length > 0) {
        const next    = upcoming[0];
        const daysTo  = Math.ceil((new Date(next.date) - today) / 86400000);
        items.push({
            level: 'gold',
            icon: 'fa-award',
            title: `Concours : ${next.type}`,
            detail: new Date(next.date).toLocaleDateString('fr-FR'),
            badge: `J-${daysTo}`,
            badgeClass: 'badge-gold',
            priority: 3
        });
    }

    items
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 7)
        .forEach(item => { container.innerHTML += buildReminderItemHtml(item); });

    if (items.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:16px 0;">Tout est à jour.</p>';
    }
}

// ==========================================
// ÉDUCATION
// ==========================================
function initEducation() {
    educationData = getLocalData(currentPetId, 'education', {});
    renderEducation();
}

function renderEducation() {
    const container = document.getElementById('edu-container');
    if (!container) return;
    container.innerHTML = '';
    const customExercises = getLocalData(currentPetId, 'custom_exercises', []);
    const allExercises    = [...DEFAULT_EDU_EXERCISES, ...customExercises];

    if (allExercises.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucun exercice disponible.</p>';
        return;
    }

    allExercises.forEach(ex => {
        const currentLevel = educationData[ex.id] || 0;
        const card         = document.createElement('div');
        card.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px 15px; border-radius:var(--radius-sm); background:var(--bg-elevated); border:1px solid var(--card-border);';
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <div style="width:34px; height:34px; border-radius:50%; background:var(--gold-dim); border:1px solid var(--gold-border); display:flex; align-items:center; justify-content:center; color:var(--gold); flex-shrink:0;">
                    <i class="fa-solid ${ex.icon || 'fa-star'}"></i>
                </div>
                <span style="font-size:13.5px; color:var(--text); font-weight:500;">${ex.name}</span>
            </div>
            <select onchange="updateEduLevel('${ex.id}', this.value)"
                style="padding:6px 10px; border-radius:var(--radius-xs); border:1px solid var(--card-border); font-size:12.5px; background:var(--bg-elevated); color:var(--text); font-weight:500; cursor:pointer;">
                <option value="0" ${currentLevel === 0 ? 'selected' : ''}>⚪ À commencer</option>
                <option value="1" ${currentLevel === 1 ? 'selected' : ''}>🟡 En cours</option>
                <option value="2" ${currentLevel === 2 ? 'selected' : ''}>🟢 Acquis</option>
                <option value="3" ${currentLevel === 3 ? 'selected' : ''}>🏆 Maîtrisé</option>
            </select>`;
        container.appendChild(card);
    });
}

window.updateEduLevel = async function(exerciseId, levelValue) {
    educationData[exerciseId] = parseInt(levelValue);
    await saveLocalData(currentPetId, 'education', educationData);
};

window.addCustomExercise = async function() {
    const input = document.getElementById('new-custom-exercise-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) { showToast("Entrez le nom d'un exercice. 🐾", "⚠️", "error"); return; }
    const id              = 'custom_' + Date.now();
    const customExercises = getLocalData(currentPetId, 'custom_exercises', []);
    customExercises.push({ id, name, icon: 'fa-star' });
    await saveLocalData(currentPetId, 'custom_exercises', customExercises);
    input.value = '';
    renderEducation();
    showToast(`Exercice « ${name} » ajouté !`, '✅');
};

// ==========================================
// BUDGET
// ==========================================
function initBudgetTracker() {
    budgetExpenses = getLocalData(currentPetId, 'budget', []);
    updateBudgetUI();
}

function updateBudgetUI() {
    const now          = new Date();
    const monthExp     = budgetExpenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const total        = monthExp.reduce((sum, e) => sum + e.amount, 0);
    const formatted    = total.toFixed(2).replace('.', ',') + ' €';

    const totalEl      = document.getElementById('budget-screen-total');
    if (totalEl) totalEl.innerText = formatted;

    renderBudgetHistory(monthExp);
}

function renderBudgetHistory(expenses) {
    const list = document.getElementById('budget-history-list');
    if (!list) return;
    list.innerHTML = '';
    [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(expense => {
        const item       = document.createElement('div');
        item.className   = 'log-item';
        item.innerHTML   = `
            <span style="color:var(--text-sub);">${escHtml(expense.title)}</span>
            <div style="display:flex; align-items:center; gap:10px;">
                <strong style="color:var(--gold);">${expense.amount.toFixed(2)} €</strong>
                <span style="color:var(--text-muted); font-size:12px;">${new Date(expense.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short' })}</span>
            </div>`;
        list.appendChild(item);
    });
    if (expenses.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucune dépense ce mois.</p>';
}

window.addBudgetExpense = function() {
    const title  = document.getElementById('budget-title').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    if (!title || !amount || amount <= 0) { showToast("Valeurs invalides.", "⚠️", "error"); return; }
    budgetExpenses.push({ id: Date.now(), title, amount, date: new Date().toISOString().split('T')[0] });
    trackEvent('expense_added');
    saveLocalData(currentPetId, 'budget', budgetExpenses);
    updateBudgetUI();
    document.getElementById('budget-title').value  = '';
    document.getElementById('budget-amount').value = '';
    showToast(`${title} — ${amount.toFixed(2)} € enregistré !`, '💰');
};

window.exportToPDF = () => window.print();

const PABLO_DATA_KEYS = [
    'profile', 'weight', 'medical', 'education', 'daily', 'chat', 'budget',
    'proData', 'proEvents', 'proLitters', 'healthExtras', 'proHistory',
    'memories', 'gamification', 'custom_exercises', 'registre'
];

function collectPabloExportData() {
    const pets = getPetsListFromStorage().map(pet => {
        const data = {};
        PABLO_DATA_KEYS.forEach(key => {
            data[key] = getLocalData(pet.id, key, null);
        });
        return { ...pet, data };
    });

    return {
        app: 'Pablo',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        ownerUid: auth.currentUser?.uid || null,
        currentPetId,
        pets
    };
}

window.exportPabloData = function() {
    const payload = collectPabloExportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `pablo-donnees-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    trackEvent('data_exported');
    showToast('Export des données généré.', '📦');
};

window.clearLocalCacheFromSettings = function() {
    showConfirm("Vider le cache local de Pablo ? Vos données cloud seront rechargées à la prochaine connexion.", () => {
        clearAppLocalData();
        showToast('Cache local vidé.', '✅');
        setTimeout(() => location.reload(), 700);
    });
};

function initChat() {
    chatHistory = getLocalData(currentPetId, 'chat', [getWelcomeChatMessage()]);
    renderChat();
}

function getWelcomeChatMessage() {
    return {
        sender: 'bot',
        text: `Wouf ! Je suis l'assistant de ${petProfile.name || 'votre compagnon'}. Comment puis-je aider ?`
    };
}

window.clearChatHistory = function() {
    showConfirm('Vider le fil Hey Pablo pour ce profil ?', async () => {
        chatHistory = [getWelcomeChatMessage()];
        await saveLocalData(currentPetId, 'chat', chatHistory);
        renderChat();
        trackEvent('chat_cleared');
        showToast('Nouveau fil prêt.', '✨');
    });
};

function renderChat() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    container.innerHTML = '';
    const lastBotIndex = getLastActionableBotIndex();

    chatHistory.forEach((msg, index) => {
        const msgDiv       = document.createElement('div');
        const initial      = (petProfile.name || 'P').charAt(0).toUpperCase();

        if (msg.sender === 'bot') {
            const canAct = !msg._id && !msg.html;
            msgDiv.className = 'msg msg-bot';
            msgDiv.innerHTML = `
                <div class="msg-avatar">${initial}</div>
                <div class="msg-content">
                    <div class="msg-bubble">${msg.html ? msg.text : formatHeyPabloMessage(msg.text)}</div>
                    ${canAct ? renderChatActions(index, msg) : ''}
                    ${canAct && index === lastBotIndex ? renderChatFollowups(index) : ''}
                </div>`;
        } else {
            msgDiv.className = 'msg msg-user';
            msgDiv.innerHTML = `<div class="msg-bubble">${escHtml(msg.text)}</div>`;
        }
        container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
}

function getLastActionableBotIndex() {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        const msg = chatHistory[i];
        if (msg?.sender === 'bot' && !msg._id && !msg.html) return i;
    }
    return -1;
}

function renderChatActions(index, msg) {
    const upActive = msg.feedback === 'up' ? ' active' : '';
    const downActive = msg.feedback === 'down' ? ' active' : '';
    return `
        <div class="msg-actions" aria-label="Actions Hey Pablo">
            <button class="msg-action-btn" type="button" onclick="copyChatMessage(${index})" title="Copier la réponse" aria-label="Copier la réponse">
                <i class="fa-solid fa-copy" aria-hidden="true"></i>
            </button>
            <button class="msg-action-btn" type="button" onclick="saveChatMessage(${index})" title="Sauvegarder dans les souvenirs" aria-label="Sauvegarder dans les souvenirs">
                <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
            </button>
            <button class="msg-action-btn" type="button" onclick="saveChatMessageToHealth(${index})" title="Ajouter au carnet santé" aria-label="Ajouter au carnet santé">
                <i class="fa-solid fa-notes-medical" aria-hidden="true"></i>
            </button>
            <button class="msg-action-btn${upActive}" type="button" onclick="rateChatMessage(${index}, 'up')" title="Réponse utile" aria-label="Réponse utile">
                <i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>
            </button>
            <button class="msg-action-btn${downActive}" type="button" onclick="rateChatMessage(${index}, 'down')" title="Réponse à améliorer" aria-label="Réponse à améliorer">
                <i class="fa-solid fa-thumbs-down" aria-hidden="true"></i>
            </button>
        </div>`;
}

function renderChatFollowups(index) {
    return `
        <div class="msg-followups" aria-label="Relances rapides Hey Pablo">
            <button class="msg-followup-btn" type="button" onclick="askChatFollowUp(${index}, 'checklist')">
                <i class="fa-solid fa-list-check" aria-hidden="true"></i> Checklist
            </button>
            <button class="msg-followup-btn" type="button" onclick="askChatFollowUp(${index}, 'plan7')">
                <i class="fa-solid fa-calendar-days" aria-hidden="true"></i> 7 jours
            </button>
            <button class="msg-followup-btn" type="button" onclick="askChatFollowUp(${index}, 'watch')">
                <i class="fa-solid fa-eye" aria-hidden="true"></i> À surveiller
            </button>
        </div>`;
}

function getPreviousUserQuestion(index) {
    for (let i = index - 1; i >= 0; i--) {
        if (chatHistory[i]?.sender === 'user') return chatHistory[i].text;
    }
    return 'la situation de mon animal';
}

window.copyChatMessage = async function(index) {
    const msg = chatHistory[index];
    if (!msg) return;
    const text = normalizeHeyPabloText(msg.text);
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
    trackEvent('chat_reply_copied');
    showToast('Réponse copiée.', '📋');
};

window.saveChatMessage = async function(index) {
    const msg = chatHistory[index];
    if (!msg || !currentPetId) return;
    const text = normalizeHeyPabloText(msg.text);
    const title = (text.split('\n').find(Boolean) || 'Conseil Hey Pablo').slice(0, 90);
    memoriesList.push({
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        title: `Hey Pablo : ${title}`,
        text
    });
    await saveLocalData(currentPetId, 'memories', memoriesList);
    renderMemories();
    trackEvent('chat_reply_saved');
    showToast('Conseil sauvegardé dans les souvenirs.', '🔖');
};

window.saveChatMessageToHealth = async function(index) {
    const msg = chatHistory[index];
    if (!msg || !currentPetId) return;
    const text = normalizeHeyPabloText(msg.text).slice(0, 900);
    medicalEvents.push({
        type: 'Note Hey Pablo',
        date: getTodayIsoDate(),
        notes: text,
        source: 'hey_pablo'
    });
    await saveLocalData(currentPetId, 'medical', medicalEvents);
    renderMedicalHistory();
    renderReminders();
    trackEvent('chat_reply_saved_to_health');
    showToast('Note ajoutée au carnet santé.', '🩺');
};

window.rateChatMessage = async function(index, value) {
    const msg = chatHistory[index];
    if (!msg) return;
    msg.feedback = value;
    msg.feedbackAt = Date.now();
    await saveLocalData(currentPetId, 'chat', chatHistory);
    trackEvent(value === 'up' ? 'chat_reply_helpful' : 'chat_reply_unhelpful');
    renderChat();
    showToast(value === 'up' ? 'Merci, réponse marquée utile.' : 'Merci, je note à améliorer.', value === 'up' ? '👍' : '📝');
};

window.askChatFollowUp = function(index, type) {
    const base = getPreviousUserQuestion(index);
    const prompts = {
        checklist: `Fais-moi une checklist simple pour: ${base}`,
        plan7: `Fais-moi un planning des 7 prochains jours pour: ${base}`,
        watch: `Dis-moi les points à surveiller et quand appeler un vétérinaire pour: ${base}`
    };
    askPreset(prompts[type] || prompts.checklist);
};

window.askPreset = function(questionText) {
    const input = document.getElementById('chat-input-field');
    if (input) input.value = questionText;
    sendMessage();
};

// ==========================================
// NAVIGATION
// ==========================================
window.navigateTo = function(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    trackEvent('screen_' + screenId.replace('screen-', ''));

    document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll(`.sidebar-nav li[onclick="navigateTo('${screenId}')"]`).forEach(li => li.classList.add('active'));

    document.querySelectorAll('.nav-item').forEach(ni => ni.classList.remove('active'));
    document.querySelectorAll(`.nav-item[onclick="navigateTo('${screenId}')"]`).forEach(ni => ni.classList.add('active'));

    const titles = {
        'screen-home':   "Vue d'ensemble",
        'screen-carnet':  "Carnet de Santé & Suivi",
        'screen-chat':   "Hey Pablo",
        'screen-pro':     "Officiel & Élevage",
        'screen-tools':   "Outils & Souvenirs",
        'screen-profile': "Configuration du Profil"
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl && titles[screenId]) titleEl.innerText = titles[screenId];

    if (screenId === 'screen-carnet') setTimeout(() => renderWeightChart(), 60);
};

// ==========================================
// SANTÉ, URGENCES & CROQUETTES
// ==========================================
const EMERGENCY_GUIDES = {
    breathing: {
        title: 'Respiration difficile ou malaise',
        body: 'Difficulté à respirer, gencives pâles/bleues, effondrement ou grande faiblesse = appel vétérinaire immédiat.',
        steps: [
            'Gardez votre animal au calme et limitez les manipulations.',
            'Appelez votre vétérinaire ou une clinique d’urgence avant le trajet.',
            'Transportez-le doucement, sans forcer l’exercice ni donner de médicament.'
        ]
    },
    poison: {
        title: 'Ingestion suspecte ou toxique',
        body: 'Produit ménager, médicament, plante, aliment toxique ou quantité inconnue : il faut appeler vite.',
        steps: [
            'Gardez l’emballage, le nom du produit, l’heure et la quantité estimée.',
            'Notez le poids de l’animal et les symptômes observés.',
            'Ne faites pas vomir sans avis vétérinaire.'
        ]
    },
    trauma: {
        title: 'Choc, blessure ou saignement',
        body: 'Accident, chute, morsure, plaie profonde, saignement important ou douleur intense nécessitent une prise en charge rapide.',
        steps: [
            'Mettez l’animal en sécurité, sans manipuler une zone douloureuse.',
            'Compressez doucement un saignement avec un linge propre.',
            'Appelez avant de partir pour que la clinique prépare l’accueil.'
        ]
    },
    seizure: {
        title: 'Crise, ventre gonflé ou blocage urinaire',
        body: 'Crises répétées, ventre très gonflé, vomissements importants, douleur forte ou difficulté à uriner sont des signaux d’urgence.',
        steps: [
            'Éloignez les objets dangereux et chronométrez la crise si possible.',
            'Ne mettez rien dans la bouche de l’animal.',
            'Appelez immédiatement si la crise dure, revient, ou si l’état se dégrade.'
        ]
    }
};

function refreshEmergencySummary() {
    const summary = document.getElementById('emergency-vet-summary');
    if (!summary) return;
    const vet = healthExtras.vetName || 'Vétérinaire non renseigné';
    const phone = healthExtras.vetPhone ? ` · ${healthExtras.vetPhone}` : '';
    summary.innerText = `${vet}${phone}`;
}

window.openEmergencyGuide = function(type) {
    const guide = EMERGENCY_GUIDES[type] || EMERGENCY_GUIDES.breathing;
    const panel = document.getElementById('emergency-guide-panel');
    if (!panel) return;
    const phone = getPhoneHref(healthExtras.vetPhone);
    const notes = String(healthExtras.emergencyNotes || '').trim();
    panel.innerHTML = `
        <h4>${escHtml(guide.title)}</h4>
        <div>${escHtml(guide.body)}</div>
        <ul>${guide.steps.map(step => `<li>${escHtml(step)}</li>`).join('')}</ul>
        ${notes ? `<div style="margin-top:8px;"><strong>Note dossier :</strong> ${escHtml(notes)}</div>` : ''}
        <div class="emergency-call-row">
            ${phone ? `<a href="tel:${phone}"><i class="fa-solid fa-phone"></i> Appeler le vétérinaire</a>` : ''}
            <button type="button" onclick="askPreset('Quels signes imposent une urgence vétérinaire pour mon animal ?')">
                <i class="fa-solid fa-comment-medical"></i> Demander à Hey Pablo
            </button>
        </div>`;
    trackEvent(`emergency_guide_${type}`);
};

window.saveEmergencyContacts = function() {
    const vetPhoneEl = document.getElementById('vet-phone');
    const vetNameEl  = document.getElementById('vet-name');
    healthExtras = {
        ...readHealthExtras(),
        vetPhone: vetPhoneEl?.value.trim() || '',
        vetName: vetNameEl?.value.trim() || ''
    };
    saveLocalData(currentPetId, 'healthExtras', healthExtras);
    refreshEmergencySummary();
};

window.updateKibbleDaysAlert = function updateKibbleDaysAlert() {
    const alertEl = document.getElementById('kibble-days-alert');
    if (!alertEl) return;

    const remaining = healthExtras.kibbleRemaining || 0;
    const weight    = petProfile.weight || 0;
    if (remaining <= 0 || weight <= 0) { alertEl.style.display = 'none'; return; }

    const dailyRation = (weight * 13.5) / 1000; // en kg
    const daysLeft    = Math.floor(remaining / dailyRation);

    if (daysLeft <= 3) {
        alertEl.style.display = 'block';
        alertEl.innerHTML = `⚠️ Seulement <strong>${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong> de croquettes restant${daysLeft > 1 ? 's' : ''} — Pensez à en racheter !`;
    } else if (daysLeft <= 7) {
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(232,168,60,0.1)';
        alertEl.style.borderColor = 'rgba(232,168,60,0.3)';
        alertEl.style.color = '#e8a83c';
        alertEl.innerHTML = `🛒 Il reste environ <strong>${daysLeft} jours</strong> de croquettes.`;
    } else {
        alertEl.style.display = 'none';
    }
}

function initHealthExtras() {
    healthExtras = readHealthExtras();

    const vetNameEl  = document.getElementById('vet-name');
    const vetPhoneEl = document.getElementById('vet-phone');
    if (vetNameEl)  vetNameEl.value  = healthExtras.vetName  || '';
    if (vetPhoneEl) vetPhoneEl.value = healthExtras.vetPhone || '';

    const alertsBanner = document.getElementById('health-alerts-banner');
    const alertsText   = document.getElementById('health-alerts-text');
    if (alertsBanner && alertsText) {
        const alerts = [
            healthExtras.allergies,
            healthExtras.chronicConditions,
            healthExtras.recurringTreatment
        ].map(value => String(value || '').trim()).filter(Boolean);
        if (alerts.length > 0) {
            alertsBanner.style.display = 'block';
            alertsText.innerText       = alerts.join(' · ');
        } else {
            alertsBanner.style.display = 'none';
        }
    }

    updateKibbleUI();
    generateTransitionPlan();
    updateKibbleDaysAlert();
    refreshEmergencySummary();
    renderReminders();
}

window.callVet = function() {
    const vetPhoneEl = document.getElementById('vet-phone');
    if (vetPhoneEl?.value) {
        saveEmergencyContacts();
        window.open(`tel:${getPhoneHref(vetPhoneEl.value)}`);
    } else {
        showToast("Entrez un numéro de téléphone.", "⚠️", "error");
    }
};

window.callPoisonControl = () => window.open('tel:0468315555');

window.refillKibbleBag = function() {
    const size = parseFloat(document.getElementById('kibble-bag-size').value);
    if (size > 0) {
        healthExtras.kibbleBag       = size;
        healthExtras.kibbleRemaining = size;
        saveLocalData(currentPetId, 'healthExtras', healthExtras);
        updateKibbleUI();
        showToast("Nouveau sac entamé ! 🍖");
        document.getElementById('kibble-bag-size').value = '';
    }
};

function updateKibbleUI() {
    const textEl    = document.getElementById('kibble-remaining-text');
    if (!textEl) return;
    const remaining = healthExtras.kibbleRemaining || 0;
    if (remaining <= 0) {
        textEl.innerText   = '-- kg';
        textEl.style.color = 'var(--text-muted)';
        return;
    }
    textEl.innerText = `${remaining.toFixed(2)} kg / ${healthExtras.kibbleBag} kg`;
    if (remaining < 3) {
        textEl.style.color = 'var(--danger)';
        showToast(`⚠️ Seulement ${remaining.toFixed(1)} kg de croquettes restantes !`, '🍖', 'error');
    } else {
        textEl.style.color = 'var(--success)';
    }
}

function generateTransitionPlan() {
    const planEl = document.getElementById('transition-plan');
    if (!planEl || !petProfile.weight) return;
    const ration = Math.round(petProfile.weight * 13.5);
    planEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--card-border);"><span style="color:var(--text-muted);">Jours 1 & 2</span><strong>75% ancien (${Math.round(ration*0.75)}g) / 25% nouveau (${Math.round(ration*0.25)}g)</strong></div>
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--card-border);"><span style="color:var(--text-muted);">Jours 3 & 4</span><strong>50% / 50% (${Math.round(ration*0.5)}g chacun)</strong></div>
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--card-border);"><span style="color:var(--text-muted);">Jours 5 & 6</span><strong>25% ancien (${Math.round(ration*0.25)}g) / 75% nouveau (${Math.round(ration*0.75)}g)</strong></div>
        <div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="color:var(--text-muted);">Jour 7</span><strong style="color:var(--success);">100% nouvelles croquettes !</strong></div>`;
}

// ==========================================
// GAMIFICATION
// ==========================================
function initGamification() {
    gamification = getLocalData(currentPetId, 'gamification', { streak: 0, lastLogin: null, badges: [] });
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];

    if (gamification.lastLogin !== today) {
        if (gamification.lastLogin === yStr) { gamification.streak += 1; }
        else if (gamification.lastLogin !== null) { gamification.streak = 0; }
        gamification.lastLogin = today;
        saveLocalData(currentPetId, 'gamification', gamification);
    }

    const streakEl = document.getElementById('streak-counter');
    if (streakEl) streakEl.innerText = `${gamification.streak} Jours`;
    updateBadges();
}

function updateBadges() {
    const container = document.getElementById('badges-container');
    if (!container) return;
    container.innerHTML = '';
    const earned = [];
    if (gamification.streak  >= 7)  earned.push({ icon: '🔥', title: 'On Fire (7j)' });
    if (weightHistory.length >= 5)  earned.push({ icon: '⚖️', title: 'Suivi Parfait' });
    if (medicalEvents.length >= 3)  earned.push({ icon: '🩺', title: 'Santé de fer' });
    if (memoriesList.length  >= 5)  earned.push({ icon: '📸', title: 'Photographe' });
    earned.forEach(b => { container.innerHTML += `<span title="${b.title}" style="font-size:22px; cursor:default;">${b.icon}</span>`; });
}

// ==========================================
// MODULE OFFICIEL & ÉLEVAGE
// ==========================================
function initProData() {
    proData    = getLocalData(currentPetId, 'proData',    { gender: 'Non spécifié' });
    proEvents  = getLocalData(currentPetId, 'proEvents',  []);
    proLitters = getLocalData(currentPetId, 'proLitters', []);

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('pro-gender',    proData.gender);
    setVal('pro-chip',      proData.chip);
    setVal('pro-lof',       proData.lof);
    setVal('pro-pedigree',  proData.pedigree);
    setVal('pro-dna',       proData.dna || 'Non fait');
    setVal('pro-xrays',     proData.xrays);
    setVal('pro-club-name', proData.clubName);
    setVal('pro-club-date', proData.clubDate);

    setVal('pro-optimal-date',  proData.optimalDate);
    setVal('pro-expected-birth', proData.expectedBirth);
    setVal('pro-actual-birth',   proData.actualBirth);
    // Nom d'élevage
    setVal('pro-kennel-name', proData.kennelName);
    setVal('pro-siren',       proData.siren);
    setVal('pro-dept',        proData.dept);
    setVal('pro-website',     proData.website);
    // Afficher le nom d'élevage dans la sidebar
    const sideTagline = document.getElementById('header-pet-breed');
    if (sideTagline && proData.kennelName) sideTagline.innerText = proData.kennelName;

    const heatCb = document.getElementById('pro-heat-reminder');
    if (heatCb) heatCb.checked = proData.heatReminder || false;

    toggleBreederFields();
    renderProEvents();
    renderLitters();
    updateElevageStats();
    initFicheFields();
}

window.toggleBreederFields = function() {
    const gender = document.getElementById('pro-gender')?.value;
    const femaleFields = ['field-chaleurs-history', 'field-fec-opti', 'field-naissance-prevue', 'field-mise-a-bas', 'field-rappel-chaleurs'];
    femaleFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (gender === 'Mâle') ? 'none' : 'block';
    });
};

window.saveProData = function() {
    proData = {
        gender:         document.getElementById('pro-gender')?.value,
        chip:           document.getElementById('pro-chip')?.value,
        lof:            document.getElementById('pro-lof')?.value,
        pedigree:       document.getElementById('pro-pedigree')?.value,
        dna:            document.getElementById('pro-dna')?.value,
        xrays:          document.getElementById('pro-xrays')?.value,
        clubName:       document.getElementById('pro-club-name')?.value,
        clubDate:       document.getElementById('pro-club-date')?.value,
        optimalDate:    document.getElementById('pro-optimal-date')?.value,
        expectedBirth:  document.getElementById('pro-expected-birth')?.value,
        actualBirth:    document.getElementById('pro-actual-birth')?.value,
        heatReminder:   document.getElementById('pro-heat-reminder')?.checked || false,
        // Nom d'élevage
        kennelName:     document.getElementById('pro-kennel-name')?.value || '',
        siren:          document.getElementById('pro-siren')?.value        || '',
        dept:           document.getElementById('pro-dept')?.value         || '',
        website:        document.getElementById('pro-website')?.value      || ''
    };
    // Mettre à jour le nom d'élevage dans la sidebar
    const sideTagline = document.getElementById('header-pet-breed');
    if (sideTagline && proData.kennelName) sideTagline.innerText = proData.kennelName;
    saveLocalData(currentPetId, 'proData', proData);
    renderReminders();
    showToast('Profil Officiel & Élevage mis à jour ! 🐾');
};

window.addLitter = function() {
    const date    = document.getElementById('litter-date')?.value;
    const partner = document.getElementById('litter-partner')?.value;
    const count   = document.getElementById('litter-count')?.value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    const damName = (getLocalData(currentPetId, 'profile', {})?.name) || 'Mère inconnue';
    proLitters.push({ id: Date.now(), date, partner, count, dam: damName, sire: partner || '', puppies: [] });
    saveLocalData(currentPetId, 'proLitters', proLitters);
    if (document.getElementById('litter-date'))    document.getElementById('litter-date').value    = '';
    if (document.getElementById('litter-partner')) document.getElementById('litter-partner').value = '';
    if (document.getElementById('litter-count'))   document.getElementById('litter-count').value   = '';
    renderLitters();
    showToast('Portée enregistrée ! 🐶', '✅');
};

// Ajoute un chiot (fiche individuelle) à une portée donnée.
window.addPuppy = function(litterId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    if (!Array.isArray(litter.puppies)) litter.puppies = [];

    const name  = document.getElementById(`pup-name-${litterId}`)?.value?.trim();
    const sex   = document.getElementById(`pup-sex-${litterId}`)?.value || 'Femelle';
    const color = document.getElementById(`pup-color-${litterId}`)?.value?.trim();
    const chip  = document.getElementById(`pup-chip-${litterId}`)?.value?.trim();
    if (!name) { showToast("Donnez un nom (ou un identifiant) au chiot.", "⚠️", "error"); return; }

    litter.puppies.push({
        id: 'pup_' + Date.now(),
        name, sex, color: color || '', chip: chip || '',
        birthDate: litter.date,
        dam: litter.dam || '',
        sire: litter.sire || litter.partner || '',
        status: 'En élevage',
        createdAt: Date.now()
    });
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderLitters();
    showToast(`${name} ajouté à la portée ! 🐶`, '✅');
};

// Retire un chiot d'une portée.
window.removePuppy = function(litterId, puppyId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter || !Array.isArray(litter.puppies)) return;
    litter.puppies = litter.puppies.filter(p => String(p.id) !== String(puppyId));
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderLitters();
    showToast('Chiot retiré.', '🗑️');
};

// --- Passeport de cession (brique 2a) ---------------------------------------
let _QRCodeLib = undefined;
async function ensureQRCode() {
    if (_QRCodeLib !== undefined) return _QRCodeLib;
    try { _QRCodeLib = (await import(/* @vite-ignore */ 'https://esm.sh/qrcode@1.5.4')).default; }
    catch (e) { console.warn('Lib QR indisponible :', e); _QRCodeLib = null; }
    return _QRCodeLib;
}

function cessionLink(cessionId) {
    return `${window.location.origin}/?cession=${cessionId}`;
}

// Génère le passeport partageable d'un chiot et bascule son statut en "Cédé".
window.cederChiot = async function(litterId, puppyId) {
    if (!auth.currentUser) { showToast("Connecte-toi pour générer un passeport.", "⚠️", "error"); return; }
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    const puppy = (litter.puppies || []).find(p => String(p.id) === String(puppyId));
    if (!puppy) return;

    if (puppy.status === 'Cédé' && puppy.cessionId) { renderLitters(); return; }

    const profile = getLocalData(currentPetId, 'profile', {}) || {};
    const affixe  = (proData && proData.clubName) ? proData.clubName
                  : (auth.currentUser.displayName || 'Élevage');

    const cessionId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'cess_' + Date.now() + '_' + Math.random().toString(36).slice(2);

    const passport = {
        v: 1,
        species: 'Chien',
        breed: profile.breed || '',
        puppy: {
            name: puppy.name || '',
            sex: puppy.sex || '',
            color: puppy.color || '',
            chip: puppy.chip || '',
            birthDate: puppy.birthDate || litter.date || '',
            dam: puppy.dam || litter.dam || '',
            sire: puppy.sire || litter.sire || litter.partner || '',
            weights: puppy.weights || [], 
            acts: puppy.acts || []
        },
        breeder: { affixe: affixe, uid: auth.currentUser.uid },
        createdAt: Date.now(),
        claimed: false,
        claimedBy: null,
        claimedAt: null
    };

    try {
        await setDoc(doc(db, 'cessions', cessionId), passport);
    } catch (e) {
        console.error('Erreur création cession :', e);
        showToast("Échec de la génération (règles Firestore ?).", "⚠️", "error");
        return;
    }

    puppy.status = 'Cédé';
    puppy.cessionId = cessionId;
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderLitters();
    showToast(`Passeport de ${puppy.name} généré ! 🎫`, '✅');
};

window.copierLienCession = function(cessionId) {
    const url = cessionLink(cessionId);
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
            () => showToast('Lien copié ! 📋', '✅'),
            () => showToast('Copie impossible, copie le lien à la main.', '⚠️', 'error')
        );
    } else {
        showToast('Copie le lien manuellement : ' + url, '📋');
    }
};

// Après le rendu, dessine les QR codes pour chaque chiot cédé.
async function populateCessionQRs() {
    const Q = await ensureQRCode();
    if (!Q) return;
    proLitters.forEach(l => (l.puppies || []).forEach(async p => {
        if (p.status === 'Cédé' && p.cessionId) {
            const img = document.getElementById(`qrimg-${p.id}`);
            if (!img) return;
            try { img.src = await Q.toDataURL(cessionLink(p.cessionId), { width: 150, margin: 1 }); }
            catch (e) { /* QR non bloquant */ }
        }
    }));
}

// --- Récupération d'un passeport côté acheteur (brique 2b) -------------------
function getCessionParam() {
    try { return new URLSearchParams(window.location.search).get('cession'); }
    catch (e) { return null; }
}

function cleanCessionUrl() {
    try { history.replaceState({}, '', window.location.origin + window.location.pathname); }
    catch (e) { /* no-op */ }
}

// Affiche une bannière d'invitation tant que l'acheteur n'est pas connecté.
async function showPendingCessionBanner(cessionId) {
    if (!cessionId || document.getElementById('cession-banner')) return;
    try {
        const snap = await getDoc(doc(db, 'cessions', cessionId));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        const name   = escHtml(d.puppy?.name || 'un chiot');
        const affixe = escHtml(d.breeder?.affixe || 'Un éleveur');

        const host = document.getElementById('landing-page') || document.body;
        const div = document.createElement('div');
        div.id = 'cession-banner';
        div.style.cssText = 'position:relative;z-index:50;padding:14px 18px;background:#1f6f54;color:#fff;text-align:center;font-size:14px;line-height:1.45;';
        div.innerHTML = d.claimed
            ? `<i class="fa-solid fa-ticket"></i> Le carnet de <strong>${name}</strong> (${affixe}) a déjà été récupéré.`
            : `<i class="fa-solid fa-ticket"></i> <strong>${affixe}</strong> vous transmet le carnet de <strong>${name}</strong>.<br>Connectez-vous ou créez un compte pour le récupérer dans votre espace.`;
        host.prepend(div);
    } catch (e) { console.warn('Bannière cession :', e); }
}

// Importe le chiot comme animal de l'acheteur et marque la cession récupérée.
async function claimCession(cessionId) {
    if (!cessionId || !auth.currentUser) return;
    try {
        const ref  = doc(db, 'cessions', cessionId);
        const snap = await getDoc(ref);
        if (!snap.exists()) { localStorage.removeItem('_pendingCession'); cleanCessionUrl(); return; }
        const d = snap.data() || {};

        if (d.claimed) {
            showToast("Ce carnet a déjà été récupéré.", "⚠️", "error");
            localStorage.removeItem('_pendingCession'); cleanCessionUrl();
            return;
        }

        const p = d.puppy || {};
        const petName = p.name || 'Mon chien';

        const newId = 'pet_' + Date.now();
        petsList.push({ id: newId, name: petName });
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        saveCloudFields({ app_pets_list: petsList, current_pet_id: newId });

        let age = 0;
        if (p.birthDate) {
            const diff = Date.now() - new Date(p.birthDate).getTime();
            if (diff > 0) age = +(diff / (365.25 * 86400000)).toFixed(1);
        }

        let latestWeight = 0;
        if (p.weights && p.weights.length > 0) {
            const sortedWeights = [...p.weights].sort((a, b) => new Date(a.date) - new Date(b.date));
            latestWeight = sortedWeights[sortedWeights.length - 1].weight;
        }

        // --- IMPORTATION DES DONNÉES RÉCUPÉRÉES ---
        saveLocalData(newId, 'profile',      { name: petName, species: d.species || 'Chien', breed: d.breed || '', age, size: 0, weight: latestWeight, avatar: '', birthDate: p.birthDate || '', sterilized: '', breedAdvice: '' });
        saveLocalData(newId, 'weight',       p.weights || []);
        
        const importedActs = (p.acts || []).map(act => ({ type: act.type, date: act.date }));
        saveLocalData(newId, 'medical',      importedActs);

        saveLocalData(newId, 'education',    {});
        saveLocalData(newId, 'daily',        { water: 0, walk: 0, date: new Date().toISOString().split('T')[0] });
        saveLocalData(newId, 'chat',         [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${petName}. Comment puis-je aider ?` }]);
        saveLocalData(newId, 'budget',       []);
        saveLocalData(newId, 'proData',      { gender: p.sex || 'Non spécifié', chip: p.chip || '', lof: '', pedigree: '', breederAffixe: d.breeder?.affixe || '', sire: p.sire || '', dam: p.dam || '' });
        saveLocalData(newId, 'proEvents',    []);
        saveLocalData(newId, 'proLitters',   []);
        saveLocalData(newId, 'healthExtras', getDefaultHealthExtras());
        saveLocalData(newId, 'proHistory',   { heats: [], matings: [] });
        saveLocalData(newId, 'memories',     []);
        saveLocalData(newId, 'gamification', { streak: 0, lastLogin: null, badges: [] });

        try {
            await updateDoc(ref, { claimed: true, claimedBy: auth.currentUser.uid, claimedAt: Date.now() });
        } catch (e) { console.warn('Maj claim (non bloquant) :', e); }

        localStorage.removeItem('_pendingCession');
        cleanCessionUrl();
        if (typeof trackEvent === 'function') trackEvent('cession_claimed');

        const banner = document.getElementById('cession-banner');
        if (banner) banner.remove();

        switchPet(newId);
        showToast(`Carnet de ${petName} récupéré ! 🐶`, '✅');
    } catch (e) {
        console.error('Erreur récupération cession :', e);
        showToast("Impossible de récupérer ce carnet.", "⚠️", "error");
    }
}

function renderLitters() {
    const list = document.getElementById('litters-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proLitters].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucune portée enregistrée.</p>'; return; }

    sorted.forEach(l => {
        const puppies = Array.isArray(l.puppies) ? l.puppies : [];
        const nbDisplay = puppies.length > 0 ? puppies.length : (escHtml(l.count) || '?');

        let puppiesHtml = '';
        if (puppies.length === 0) {
            puppiesHtml = '<p style="color:var(--text-muted); font-size:12.5px; margin:8px 0;">Aucun chiot enregistré dans cette portée.</p>';
        } else {
            puppies.forEach(p => {
                const sexIcon = (p.sex === 'Mâle') ? '♂' : '♀';
                const isCeded = p.status === 'Cédé';
                const cederBtn = isCeded ? '' : `
                            <div style="display:flex; gap:6px; margin-top:4px;">
                                <button class="btn-secondary btn-sm" title="Générer le passeport de cession" onclick="cederChiot('${l.id}','${p.id}')">
                                    <i class="fa-solid fa-share-nodes"></i> Céder
                                </button>
                                <button class="btn-outline btn-sm" style="color:var(--text); border-color:var(--card-border);" title="Imprimer le contrat de vente PDF" onclick="exportContratVentePDF('${l.id}','${p.id}')">
                                    <i class="fa-solid fa-file-contract"></i> Contrat
                                </button>
                            </div>`;
                const cessionPanel = (isCeded && p.cessionId) ? `
                        <div style="margin:4px 0 10px; padding:10px; border:1px dashed var(--gold, #c8a24a); border-radius:10px;">
                            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:6px;">
                                <i class="fa-solid fa-ticket"></i> Passeport à transmettre au nouveau propriétaire :
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <img id="qrimg-${p.id}" alt="QR du passeport" width="110" height="110" style="border-radius:8px; background:#fff;">
                                <div style="flex:1; min-width:160px;">
                                    <input type="text" readonly value="${cessionLink(p.cessionId)}" onclick="this.select()" style="width:100%; font-size:12px;">
                                    <button class="btn-gold btn-sm btn-full" style="margin-top:6px;" onclick="copierLienCession('${p.cessionId}')">
                                        <i class="fa-solid fa-copy"></i> Copier le lien
                                    </button>
                                </div>
                            </div>
                        </div>` : '';
                puppiesHtml += `
                    <div class="log-item" style="justify-content:space-between;">
                        <div>
                            <strong>${sexIcon} ${escHtml(p.name)}</strong>
                            <span style="color:var(--text-muted); font-size:12.5px;">
                                ${escHtml(p.color) || 'Robe n.c.'}${p.chip ? ' · Puce : ' + escHtml(p.chip) : ''}
                            </span>
                            <span style="color:var(--text-muted); font-size:11px; display:block;">⚖️ ${Array.isArray(p.weights) ? p.weights.length : 0} pesée(s) · 💉 ${Array.isArray(p.acts) ? p.acts.length : 0} soin(s)</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span class="badge ${isCeded ? 'badge-success' : 'badge-gold'}">${escHtml(p.status || 'En élevage')}</span>
                            <button class="btn btn-outline btn-sm" onclick="openPuppyTracking('${l.id}','${p.id}')" title="Suivi poids & soins"><i class="fa-solid fa-chart-line"></i> Suivi</button>
                            <button class="btn btn-outline btn-sm" onclick="openPdfExportModal('${l.id}','${p.id}')" title="Carnet santé PDF"><i class="fa-solid fa-file-pdf" style="color:#e05252;"></i> PDF</button>
                            ${cederBtn}
                            <button class="btn-danger-outline btn-sm" title="Retirer" onclick="removePuppy('${l.id}','${p.id}')">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>
                    ${cessionPanel}`;
            });
        }

        const addFormHtml = `
            <div class="g2" style="margin-top:10px; gap:8px;">
                <input type="text"   id="pup-name-${l.id}"  placeholder="Nom / identifiant">
                <select id="pup-sex-${l.id}">
                    <option value="Femelle">Femelle ♀</option>
                    <option value="Mâle">Mâle ♂</option>
                </select>
                <input type="text" id="pup-color-${l.id}" placeholder="Robe / couleur">
                <input type="text" id="pup-chip-${l.id}"  placeholder="N° puce (optionnel)">
            </div>
            <button class="btn-secondary btn-sm btn-full" style="margin-top:8px;" onclick="addPuppy('${l.id}')">
                <i class="fa-solid fa-plus"></i> Ajouter un chiot
            </button>`;

        list.innerHTML += `
            <div class="card" style="margin-bottom:12px; padding:14px;">
                <div class="reminder-item" style="margin:0;">
                    <div>
                        <h4>Portée du ${new Date(l.date).toLocaleDateString('fr-FR')}</h4>
                        <span>Mère : ${escHtml(l.dam) || 'n.c.'} · Père : ${escHtml(l.sire || l.partner) || 'Non précisé'}</span>
                    </div>
                    <span class="badge badge-gold">${nbDisplay} chiot(s)</span>
                </div>
                <div style="margin-top:10px;">${puppiesHtml}</div>
                ${addFormHtml}
                <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--card-border); display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <span style="font-size:12px; color:var(--text-muted); flex:1;">Adoptants en attente : <strong style="color:var(--gold);">${Array.isArray(l.waitlist) ? l.waitlist.length : 0}</strong></span>
                    <button class="btn btn-outline btn-sm" onclick="openWaitlistModal('${l.id}')">
                        <i class="fa-solid fa-list-ul"></i> Liste d'attente
                    </button>
                </div>
            </div>`;
    });
    populateCessionQRs();
}

window.addProEvent = function() {
    const type    = document.getElementById('pro-event-type')?.value;
    const date    = document.getElementById('pro-event-date')?.value;
    const details = document.getElementById('pro-event-details')?.value;
    if (!date) { showToast("Sélectionnez une date.", "⚠️", "error"); return; }
    proEvents.push({ id: Date.now(), type, date, details });
    saveLocalData(currentPetId, 'proEvents', proEvents);
    if (document.getElementById('pro-event-date'))    document.getElementById('pro-event-date').value    = '';
    if (document.getElementById('pro-event-details')) document.getElementById('pro-event-details').value = '';
    renderProEvents();
    renderReminders();
    showToast('Événement ajouté !', '🏆');
};

function renderProEvents() {
    const list = document.getElementById('pro-events-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proEvents].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Aucun événement.</p>'; return; }
    const today = new Date();
    sorted.forEach(ev => {
        const isFuture = new Date(ev.date) > today;
        list.innerHTML += `
            <div class="reminder-item">
                <div>
                    <h4>${escHtml(ev.type)}</h4>
                    <span>${new Date(ev.date).toLocaleDateString('fr-FR')}${ev.details ? ' — ' + escHtml(ev.details) : ''}</span>
                </div>
                ${isFuture ? '<span class="badge badge-gold">À VENIR</span>' : '<span class="badge badge-success">Passé</span>'}
            </div>`;
    });
}

// ==========================================
// HISTORIQUE PRO — Chaleurs & Saillies
// ==========================================
function initProHistory() {
    proHistory = getLocalData(currentPetId, 'proHistory', { heats: [], matings: [] });
    renderHeatHistory();
    renderMatingHistory();
    renderReminders();
}

window.addHeatRecord = function() {
    const date = document.getElementById('new-heat-date')?.value;
    if (!date) return;
    proHistory.heats.push({ id: Date.now(), date });
    saveLocalData(currentPetId, 'proHistory', proHistory);
    document.getElementById('new-heat-date').value = '';
    renderHeatHistory();
    renderReminders();
    showToast('Chaleurs enregistrées !', '🩸');
};

function renderHeatHistory() {
    const list  = document.getElementById('heat-history-list');
    const avgEl = document.getElementById('heat-average');
    if (!list) return;
    list.innerHTML = '';

    const sorted = [...proHistory.heats].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sorted.length >= 2 && avgEl) {
        let totalDays = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
            totalDays += (new Date(sorted[i].date) - new Date(sorted[i + 1].date)) / 86400000;
        }
        avgEl.innerText = `${((totalDays / (sorted.length - 1)) / 30.44).toFixed(1)} mois`;
    } else if (avgEl) {
        avgEl.innerText = '-- mois';
    }

    sorted.forEach(h => {
        list.innerHTML += `<div class="log-item"><span>🩸 Chaleurs</span><strong style="color:var(--text-muted); font-size:12.5px;">${new Date(h.date).toLocaleDateString('fr-FR')}</strong></div>`;
    });
    if (sorted.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Aucune chaleur enregistrée.</p>';
}

window.addMatingRecord = function() {
    const date    = document.getElementById('mating-date')?.value;
    const partner = document.getElementById('mating-partner')?.value;
    if (!date) return;
    proHistory.matings.push({ id: Date.now(), date, partner });
    saveLocalData(currentPetId, 'proHistory', proHistory);
    if (document.getElementById('mating-date'))    document.getElementById('mating-date').value    = '';
    if (document.getElementById('mating-partner')) document.getElementById('mating-partner').value = '';
    renderMatingHistory();
    showToast('Saillie enregistrée !', '❤️');
};

function renderMatingHistory() {
    const list = document.getElementById('mating-history-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...proHistory.matings].sort((a, b) => new Date(b.date) - new Date(a.date));
    sorted.forEach(m => {
        list.innerHTML += `
            <div class="log-item" style="flex-direction:column; align-items:flex-start; gap:2px;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <strong>Saillie du ${new Date(m.date).toLocaleDateString('fr-FR')}</strong>
                </div>
                <span style="color:var(--text-muted); font-size:12.5px;">Partenaire : ${escHtml(m.partner) || 'Inconnu'}</span>
            </div>`;
    });
    if (sorted.length === 0) list.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Aucune saillie enregistrée.</p>';
}

// ==========================================
// JOURNAL DES PREMIÈRES FOIS
// ==========================================
function initMemories() {
    memoriesList = getLocalData(currentPetId, 'memories', []);
    renderMemories();
    renderMagicAvatarPreview();
    document.querySelectorAll('.dynamic-pet-name').forEach(el => el.innerText = petProfile.name || 'Pablo');
}

window.addMemory = function() {
    const date  = document.getElementById('memory-date')?.value;
    const title = document.getElementById('memory-title')?.value.trim();
    if (!date || !title) { showToast("Remplissez la date et le souvenir.", "⚠️", "error"); return; }
    memoriesList.push({ id: Date.now(), date, title });
    saveLocalData(currentPetId, 'memories', memoriesList);
    if (document.getElementById('memory-title')) document.getElementById('memory-title').value = '';
    renderMemories();
    showToast(`Souvenir « ${title} » ajouté !`, '📸');
};

function renderMemories() {
    const timeline = document.getElementById('memories-timeline');
    if (!timeline) return;
    timeline.innerHTML = '';
    const sorted = [...memoriesList].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) { timeline.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Aucun souvenir encore. Ajoutez la première ! ✨</p>'; return; }
    sorted.forEach(m => {
        const image = m.image ? `<img src="${escHtml(m.image)}" alt="" style="width:72px; height:72px; object-fit:cover; border-radius:14px; border:1px solid var(--gold-border); margin-top:8px;">` : '';
        timeline.innerHTML += `
            <div style="position:relative; margin-bottom:16px;">
                <div style="position:absolute; left:-22px; top:4px; width:10px; height:10px; border-radius:50%; background:var(--gold); border:2px solid var(--bg);"></div>
                <div style="font-size:11.5px; color:var(--text-muted);">${new Date(m.date).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })}</div>
                <div style="font-weight:600; color:var(--text); font-size:13.5px;">${escHtml(m.title)}</div>
                ${image}
            </div>`;
    });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Photo illisible."));
        img.src = dataUrl;
    });
}

async function prepareAvatarSourceDataUrl(sourceDataUrl) {
    const img = await loadImageFromDataUrl(sourceDataUrl);
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f6f0e8';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.9);
}

function renderMagicAvatarPreview() {
    const wrap = document.getElementById('magic-avatar-result');
    const img = document.getElementById('magic-avatar-img');
    if (!wrap || !img) return;
    if (petProfile.magicAvatar) {
        img.src = petProfile.magicAvatar;
        wrap.style.display = 'block';
    } else {
        wrap.style.display = 'none';
    }
}

window.generateAvatar = async function() {
    const source = petProfile.avatar;
    if (!source) {
        showToast("Ajoutez d'abord une photo dans le profil.", "⚠️", "error");
        navigateTo('screen-profile');
        return;
    }
    if (!auth.currentUser || hasDemoAccess()) {
        showToast("Connectez-vous pour utiliser l'avatar IA premium.", "🔒", "error");
        return;
    }

    const button = document.getElementById('btn-generate-avatar');
    const previousHtml = button?.innerHTML;
    const style = document.getElementById('magic-avatar-style')?.value || 'portrait premium';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération IA...';
    }

    try {
        const preparedSource = await prepareAvatarSourceDataUrl(source);
        petProfile.magicAvatar = await pabloAvatar(preparedSource, style);
        await saveLocalData(currentPetId, 'profile', petProfile);
        renderMagicAvatarPreview();
        trackEvent('magic_avatar_ai_generated');
        showToast('Avatar IA premium généré !', '🎨');
    } catch (error) {
        console.error('Avatar IA échoué :', error);
        const message = error.name === 'AbortError'
            ? "La génération IA a pris trop de temps. Réessayez."
            : error.message || "Impossible de générer l'avatar IA.";
        showToast(message, "⚠️", "error");
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousHtml;
        }
    }
};

window.useMagicAvatarAsProfile = async function() {
    if (!petProfile.magicAvatar) return;
    petProfile.avatar = petProfile.magicAvatar;
    await saveLocalData(currentPetId, 'profile', petProfile);
    initPetProfile();
    showToast('Avatar appliqué au profil.', '✅');
};

window.downloadMagicAvatar = function() {
    if (!petProfile.magicAvatar) return;
    const link = document.createElement('a');
    link.href = petProfile.magicAvatar;
    link.download = `avatar-${(petProfile.name || 'pablo').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    link.click();
};

window.saveMagicAvatarMemory = async function() {
    if (!petProfile.magicAvatar) return;
    memoriesList.push({
        id: Date.now(),
        date: getTodayIsoDate(),
        title: `Avatar magique de ${petProfile.name || 'mon compagnon'}`,
        image: petProfile.magicAvatar
    });
    await saveLocalData(currentPetId, 'memories', memoriesList);
    renderMemories();
    showToast('Avatar ajouté aux souvenirs.', '🔖');
};

// ==========================================
// MODALE DE CONFIRMATION
// ==========================================
window.showConfirm = function(message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-message');
    if (!modal || !msgEl) { if (confirm(message)) onConfirm(); return; }
    msgEl.textContent = message;
    modal.classList.add('open');
    window._confirmCallback = onConfirm;
};

window.closeConfirmModal = function() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('open');
    window._confirmCallback = null;
};

window.acceptConfirmModal = function() {
    closeConfirmModal();
    if (typeof window._confirmCallback === 'function') window._confirmCallback();
};

// ==========================================
// ==========================================
// NOTIFICATIONS FCM
// ==========================================

const VAPID_KEY = 'BEz6BhtY1kDVqbgEaRTIJKMzqSS7c-Zvva7XnxTqPml5OXEhWYAgPlkFH8ZBsd3EqUruAbS57IxFICYoMUwR_WY';

async function getFCMToken() {
    try {
        let swReg;
        try {
            swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 5000))
            ]);
        } catch (e) {
            console.warn('SW non prêt, tentative sans SW explicite :', e);
            swReg = undefined;
        }

        const messaging = getMessaging(app);
        const tokenOptions = { vapidKey: VAPID_KEY };
        if (swReg) tokenOptions.serviceWorkerRegistration = swReg;

        const token = await getToken(messaging, tokenOptions);
        return token;
    } catch (e) {
        console.warn('Erreur récupération token FCM :', e);
        return null;
    }
}

window.requestNotificationPermission = async function() {
    if (!('Notification' in window)) {
        showToast("Votre navigateur ne supporte pas les notifications.", "⚠️", "error");
        return;
    }
    const btn = document.getElementById('btn-enable-notifications');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Activation…'; }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        showToast("Notifications refusées.", "⚠️", "error");
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell"></i> Activer les rappels'; }
        return;
    }

    const token = await getFCMToken();
    if (!token) {
        showToast("Impossible d'activer les notifications (token FCM manquant).", "⚠️", "error");
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell"></i> Activer les rappels'; }
        return;
    }

    if (auth.currentUser) {
        try {
            await setDoc(doc(db, 'users', auth.currentUser.uid), { fcmToken: token }, { merge: true });
        } catch (e) { console.warn('Erreur sauvegarde token FCM :', e); }
    }

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Notifications activées !';
        btn.style.color = 'var(--success)';
        btn.style.borderColor = 'rgba(82,201,122,0.4)';
        btn.disabled = true;
    }
    showToast('Rappels Pablo activés ! 🔔', '✅');
    trackEvent('notifications_enabled');
};

// ==========================================
// SUIVI INDIVIDUEL CHIOTS
// ==========================================
let _currentPuppyRef = null;
let _puppyWeightChart = null;

window.openPuppyTracking = function(litterId, puppyId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    const puppy = (litter.puppies || []).find(p => String(p.id) === String(puppyId));
    if (!puppy) return;
    _currentPuppyRef = { litterId, puppyId };

    const nameEl = document.getElementById('puppy-modal-name');
    if (nameEl) nameEl.textContent = puppy.name;

    const infosEl = document.getElementById('puppy-modal-infos');
    if (infosEl) {
        const sexIcon = puppy.sex === 'Mâle' ? '♂' : '♀';
        infosEl.innerHTML = `
            <span class="badge badge-gold">${sexIcon} ${escHtml(puppy.sex || '')}</span>
            ${puppy.color ? `<span class="badge badge-warning">${escHtml(puppy.color)}</span>` : ''}
            ${puppy.chip  ? `<span class="badge badge-success">Puce : ${escHtml(puppy.chip)}</span>` : ''}
            ${puppy.birthDate ? `<span class="badge" style="background:var(--bg-elevated); color:var(--text-muted); border:1px solid var(--card-border);">Né le ${new Date(puppy.birthDate).toLocaleDateString('fr-FR')}</span>` : ''}
        `;
    }

    const dateInput = document.getElementById('puppy-weight-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const actDate = document.getElementById('puppy-act-date');
    if (actDate) actDate.value = new Date().toISOString().split('T')[0];
    const statusSel = document.getElementById('puppy-status-select');
    if (statusSel) statusSel.value = puppy.status || 'En élevage';

    renderPuppyWeights(puppy);
    renderPuppyActs(puppy);

    const modal = document.getElementById('puppy-tracking-modal');
    if (modal) modal.classList.add('open');
};

window.closePuppyModal = function() {
    const modal = document.getElementById('puppy-tracking-modal');
    if (modal) modal.classList.remove('open');
    _currentPuppyRef = null;
    if (_puppyWeightChart) { _puppyWeightChart.destroy(); _puppyWeightChart = null; }
};

function getCurrentPuppy() {
    if (!_currentPuppyRef) return null;
    const litter = proLitters.find(l => String(l.id) === String(_currentPuppyRef.litterId));
    if (!litter) return null;
    return (litter.puppies || []).find(p => String(p.id) === String(_currentPuppyRef.puppyId));
}

function savePuppyData() {
    saveLocalData(currentPetId, 'proLitters', proLitters);
}

window.addPuppyWeight = function() {
    const puppy = getCurrentPuppy();
    if (!puppy) return;
    const w = parseFloat(document.getElementById('puppy-weight-input')?.value);
    const d = document.getElementById('puppy-weight-date')?.value;
    if (!w || w <= 0 || !d) { showToast('Poids ou date invalide.', '⚠️', 'error'); return; }
    if (!Array.isArray(puppy.weights)) puppy.weights = [];
    puppy.weights.push({ date: d, weight: w });
    savePuppyData();
    document.getElementById('puppy-weight-input').value = '';
    renderPuppyWeights(puppy);
    showToast(`${w} kg enregistré pour ${puppy.name} !`, '⚖️');
};

function renderPuppyWeights(puppy) {
    const list   = document.getElementById('puppy-weight-list');
    const canvas = document.getElementById('puppyWeightChart');
    const weights = Array.isArray(puppy.weights) ? [...puppy.weights].sort((a, b) => new Date(a.date) - new Date(b.date)) : [];

    if (list) {
        list.innerHTML = '';
        if (weights.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted); font-size:12.5px;">Aucune pesée enregistrée.</p>';
        } else {
            [...weights].reverse().slice(0, 5).forEach(w => {
                list.innerHTML += `<div class="log-item"><span style="color:var(--text-sub);">${new Date(w.date).toLocaleDateString('fr-FR')}</span><strong style="color:var(--gold);">${w.weight} kg</strong></div>`;
            });
        }
    }

    if (!canvas) return;
    if (_puppyWeightChart) { _puppyWeightChart.destroy(); _puppyWeightChart = null; }
    if (weights.length < 2) return;
    if (!window.Chart) {
        ensureChartJs()
            .then(() => renderPuppyWeights(puppy))
            .catch(() => console.warn('Chart.js indisponible pour la courbe chiot.'));
        return;
    }

    const isLight = document.body.classList.contains('light-mode');
    const lc = isLight ? '#a87020' : '#c8922a';
    const bc = isLight ? 'rgba(168,112,32,0.08)' : 'rgba(200,146,42,0.1)';
    const gc = isLight ? '#e8dfc8' : '#2a2215';
    const tc = isLight ? '#6b5038' : '#b8a88a';

    _puppyWeightChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: weights.map(w => new Date(w.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
            datasets: [{ label: 'Poids (kg)', data: weights.map(w => w.weight), borderColor: lc, backgroundColor: bc, borderWidth: 2, tension: 0.3, fill: true, pointBackgroundColor: lc, pointRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: gc }, ticks: { color: tc } },
                x: { grid: { display: false }, ticks: { color: tc } }
            }
        }
    });
}

window.addPuppyAct = function() {
    const puppy = getCurrentPuppy();
    if (!puppy) return;
    const type = document.getElementById('puppy-act-type')?.value;
    const date = document.getElementById('puppy-act-date')?.value;
    if (!date) { showToast('Sélectionnez une date.', '⚠️', 'error'); return; }
    if (!Array.isArray(puppy.acts)) puppy.acts = [];
    puppy.acts.push({ id: Date.now(), type, date });
    savePuppyData();
    renderPuppyActs(puppy);
    showToast(`${type} enregistré !`, '✅');
};

function renderPuppyActs(puppy) {
    const list = document.getElementById('puppy-acts-list');
    if (!list) return;
    const acts = Array.isArray(puppy.acts) ? [...puppy.acts].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
    list.innerHTML = acts.length === 0
        ? '<p style="color:var(--text-muted); font-size:12.5px;">Aucun soin enregistré.</p>'
        : acts.map(a => `<div class="log-item"><span style="color:var(--text-sub);">${escHtml(a.type)}</span><strong style="color:var(--text-muted); font-size:12px;">${new Date(a.date).toLocaleDateString('fr-FR')}</strong></div>`).join('');
}

window.updatePuppyStatus = function() {
    const puppy = getCurrentPuppy();
    if (!puppy) return;
    puppy.status = document.getElementById('puppy-status-select')?.value || 'En élevage';
    savePuppyData();
    renderLitters();
    showToast(`Statut : ${puppy.status}`, '✅');
};

// ==========================================
// REGISTRE ENTRÉES / SORTIES
// ==========================================
let registreEntries = [];

function initRegistre() {
    registreEntries = getLocalData(currentPetId, 'registre', []);
    renderRegistre();
    const dateEl = document.getElementById('reg-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
}

window.addRegistreEntry = function() {
    const type   = document.getElementById('reg-type')?.value;
    const date   = document.getElementById('reg-date')?.value;
    const animal = document.getElementById('reg-animal')?.value.trim();
    const chip   = document.getElementById('reg-chip')?.value.trim();
    const person = document.getElementById('reg-person')?.value.trim();

    if (!date)   { showToast('Sélectionnez une date.', '⚠️', 'error'); return; }
    if (!animal) { showToast("Renseignez le nom de l'animal.", '⚠️', 'error'); return; }

    registreEntries.push({
        id: Date.now(),
        type, date, animal,
        chip: chip || '—',
        person: person || '—',
        createdAt: Date.now()
    });

    saveLocalData(currentPetId, 'registre', registreEntries);
    renderRegistre();

    ['reg-animal', 'reg-chip', 'reg-person'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('reg-date').value = new Date().toISOString().split('T')[0];

    showToast('Entrée ajoutée au registre !', '📋');
    trackEvent('registre_entry_added');
};

function renderRegistre() {
    const list = document.getElementById('registre-list');
    if (!list) return;

    if (registreEntries.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucune entrée dans le registre.</p>';
        return;
    }

    const sorted = [...registreEntries].sort((a, b) => new Date(b.date) - new Date(a.date));

    list.innerHTML = `
        <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
                <thead>
                    <tr style="background:var(--bg-elevated);">
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Date</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Mouvement</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Animal</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Identification</th>
                        <th style="padding:8px 10px; text-align:left; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Personne</th>
                        <th style="padding:8px 10px; text-align:center; border:1px solid var(--card-border); color:var(--text-muted); font-weight:600; font-size:11px;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map((e, i) => {
                        const isEntree = e.type.startsWith('Entrée');
                        const badgeColor = isEntree ? 'var(--success)' : 'var(--danger)';
                        const badgeBg   = isEntree ? 'var(--success-dim)' : 'var(--danger-dim)';
                        return `<tr style="background:${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'}">
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text-sub); white-space:nowrap;">${new Date(e.date).toLocaleDateString('fr-FR')}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border);">
                                <span style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeColor}33; padding:2px 8px; border-radius:100px; font-size:11px; font-weight:700; white-space:nowrap;">${escHtml(e.type)}</span>
                            </td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text); font-weight:600;">${escHtml(e.animal)}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text-muted); font-family:monospace; font-size:11.5px;">${escHtml(e.chip)}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); color:var(--text-sub);">${escHtml(e.person)}</td>
                            <td style="padding:9px 10px; border:1px solid var(--card-border); text-align:center;">
                                <button onclick="deleteRegistreEntry(${e.id})" style="background:var(--danger-dim); border:1px solid rgba(224,82,82,0.2); color:var(--danger); border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <p style="font-size:11px; color:var(--text-muted); margin-top:8px; text-align:right;">
            ${registreEntries.length} entrée${registreEntries.length > 1 ? 's' : ''} au total
        </p>`;
}

window.deleteRegistreEntry = function(id) {
    showConfirm('Supprimer cette entrée du registre ?', () => {
        registreEntries = registreEntries.filter(e => e.id !== id);
        saveLocalData(currentPetId, 'registre', registreEntries);
        renderRegistre();
        showToast('Entrée supprimée.', '🗑️');
    });
};

window.clearRegistre = function() {
    showConfirm('Vider tout le registre ? Cette action est irréversible.', () => {
        registreEntries = [];
        saveLocalData(currentPetId, 'registre', registreEntries);
        renderRegistre();
        showToast('Registre vidé.', '🗑️');
    });
};

window.exportRegistrePDF = function() {
    const animal = petProfile.name || 'Animal';
    const rows = [...registreEntries].sort((a, b) => new Date(a.date) - new Date(b.date));

    const printWin = window.open('', '_blank');
    printWin.document.write(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <title>Registre Entrées/Sorties — ${animal}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; margin: 30px; }
                h1 { font-size: 18px; margin-bottom: 4px; }
                .meta { color: #888; font-size: 11px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th { background: #2d2d2d; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
                td { padding: 8px 10px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
                tr:nth-child(even) td { background: #f8f8f8; }
                .entree { color: #2d7a4f; font-weight: 700; }
                .sortie { color: #c0392b; font-weight: 700; }
                .footer { margin-top: 30px; font-size: 10px; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
            </style>
        </head>
        <body>
            <h1>Registre Entrées / Sorties</h1>
            <div class="meta">
                Animal : <strong>${animal}</strong> &nbsp;|&nbsp;
                Race : <strong>${petProfile.breed || 'Non renseignée'}</strong> &nbsp;|&nbsp;
                Édité le : <strong>${new Date().toLocaleDateString('fr-FR')}</strong>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Mouvement</th>
                        <th>Animal</th>
                        <th>Identification</th>
                        <th>Vendeur / Acheteur / Éleveur</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.length === 0
                        ? '<tr><td colspan="5" style="text-align:center; color:#aaa; padding:20px;">Aucune entrée.</td></tr>'
                        : rows.map(e => {
                            const isEntree = e.type.startsWith('Entrée');
                            return `<tr>
                                <td>${new Date(e.date).toLocaleDateString('fr-FR')}</td>
                                <td class="${isEntree ? 'entree' : 'sortie'}">${e.type}</td>
                                <td><strong>${e.animal}</strong></td>
                                <td style="font-family:monospace;">${e.chip}</td>
                                <td>${e.person}</td>
                            </tr>`;
                        }).join('')}
                </tbody>
            </table>
            <div class="footer">Pablo — pablocanin.fr &nbsp;|&nbsp; Registre généré automatiquement &nbsp;|&nbsp; ${rows.length} mouvement(s)</div>
        </body>
        </html>
    `);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); }, 400);
};

// ==========================================
// EXPORT PDF DIRECT : CONTRAT DE VENTE CHIOT
// ==========================================
window.exportContratVentePDF = function(litterId, puppyId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;
    const puppy = (litter.puppies || []).find(p => String(p.id) === String(puppyId));
    if (!puppy) return;

    // Récupération des données globales
    const race = petProfile.breed || 'Non renseignée';
    const eleveurEmail = auth.currentUser ? auth.currentUser.email : '_________________';
    const affixe = proData.clubName || '_________________';
    
    // Formatage des dates
    const birthDateStr = puppy.birthDate ? new Date(puppy.birthDate).toLocaleDateString('fr-FR') : '_________________';
    const todayStr = new Date().toLocaleDateString('fr-FR');

    // La fonction qui génère réellement le PDF une fois la librairie chargée
    const generatePDF = () => {
        showToast("Génération du contrat en cours...", "⏳");

        // Création d'un conteneur invisible pour stocker le design du PDF
        const container = document.createElement('div');
        container.style.padding = "40px";
        container.style.fontFamily = "Helvetica, Arial, sans-serif";
        container.style.fontSize = "13px";
        container.style.color = "#000";
        container.style.lineHeight = "1.5";
        
        container.innerHTML = `
            <h1 style="text-align: center; font-size: 20px; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 30px;">
                Attestation de Cession d'un Animal
            </h1>
            
            <div style="margin-bottom: 20px;">
                <h2 style="font-size: 15px; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; text-transform: uppercase;">1. Le Cédant (Éleveur)</h2>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Nom / Affixe :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(affixe)}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Email de contact :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(eleveurEmail)}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">N° SIRET / Déclaration :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">______________________________________</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Adresse :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">______________________________________</span></div>
            </div>

            <div style="margin-bottom: 20px;">
                <h2 style="font-size: 15px; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; text-transform: uppercase;">2. L'Acquéreur</h2>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Nom et Prénom :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">______________________________________</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Adresse complète :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">______________________________________</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Téléphone :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">______________________________________</span></div>
            </div>

            <div style="margin-bottom: 20px;">
                <h2 style="font-size: 15px; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; text-transform: uppercase;">3. L'Animal</h2>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Nom de l'animal :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(puppy.name)}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Espèce / Race :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">Chien / ${escHtml(race)}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Sexe :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(puppy.sex)}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Robe / Couleur :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(puppy.color || '_________________')}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Date de naissance :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${birthDateStr}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">N° d'identification (Puce) :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(puppy.chip || '_________________')}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Père :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(litter.sire || litter.partner || 'Inconnu')}</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Mère :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">${escHtml(litter.dam || 'Inconnue')}</span></div>
            </div>

            <div style="margin-bottom: 20px;">
                <h2 style="font-size: 15px; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; text-transform: uppercase;">4. Conditions de Vente</h2>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Prix de vente (TTC) :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">___________________________________ €</span></div>
                <div style="display: flex; margin-bottom: 8px;"><strong style="width: 40%;">Modalités de paiement :</strong> <span style="width: 60%; border-bottom: 1px dotted #999;">______________________________________</span></div>
                <p style="margin-top: 15px;"><strong>Documents remis ce jour à l'acquéreur :</strong></p>
                <ul style="padding-left: 20px;">
                    <li style="margin-bottom: 5px;">Le carnet de santé (ou passeport) dûment rempli.</li>
                    <li style="margin-bottom: 5px;">Le certificat d'identification (I-CAD).</li>
                    <li style="margin-bottom: 5px;">Un document d'information sur les besoins de l'animal.</li>
                    <li style="margin-bottom: 5px;">Le certificat vétérinaire avant cession.</li>
                </ul>
            </div>

            <div style="display: flex; justify-content: space-between; margin-top: 40px;">
                <div style="width: 45%; text-align: center;">
                    <strong>Signature du Cédant</strong><br>
                    <span style="font-size: 11px;">(Précédé de "Lu et approuvé")</span>
                    <div style="height: 80px; border: 1px dashed #ccc; margin-top: 10px;"></div>
                </div>
                <div style="width: 45%; text-align: center;">
                    <strong>Signature de l'Acquéreur</strong><br>
                    <span style="font-size: 11px;">(Précédé de "Lu et approuvé")</span>
                    <div style="height: 80px; border: 1px dashed #ccc; margin-top: 10px;"></div>
                </div>
            </div>
            
            <p style="text-align: center; margin-top: 30px; font-size: 11px; color: #666;">
                Fait en deux exemplaires originaux, à ___________________________, le ${todayStr}.
            </p>
        `;

        // Configuration du PDF
        const opt = {
            margin:       0,
            filename:     `Contrat_Vente_${puppy.name.replace(/\s+/g, '_')}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        // Génération et téléchargement
        window.html2pdf().set(opt).from(container).save().then(() => {
            showToast("Contrat PDF téléchargé ! 📄", "✅");
        });
    };

    // Injection dynamique de la librairie html2pdf si elle n'est pas encore chargée
    if (typeof window.html2pdf === 'undefined') {
        showToast("Préparation de l'outil PDF...", "⚙️");
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
        script.onload = () => {
            generatePDF();
        };
        document.head.appendChild(script);
    } else {
        generatePDF();
    }
};
// ==========================================
// LISTE D'ATTENTE ADOPTANTS
// ==========================================
let _currentWaitlistLitterId = null;

window.openWaitlistModal = function(litterId) {
    _currentWaitlistLitterId = litterId;
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter) return;

    const nameEl = document.getElementById('waitlist-litter-name');
    if (nameEl) nameEl.textContent = 'Portée du ' + new Date(litter.date).toLocaleDateString('fr-FR');

    // Reset form
    ['wl-name','wl-phone','wl-email','wl-puppy','wl-notes'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const depEl = document.getElementById('wl-deposit');
    if (depEl) depEl.value = '';
    const stEl = document.getElementById('wl-status');
    if (stEl) stEl.value = 'En attente';

    renderWaitlistEntries(litter);
    document.getElementById('waitlist-modal')?.classList.add('open');
};

window.closeWaitlistModal = function() {
    document.getElementById('waitlist-modal')?.classList.remove('open');
    _currentWaitlistLitterId = null;
};

window.addWaitlistEntry = function() {
    const litter = proLitters.find(l => String(l.id) === String(_currentWaitlistLitterId));
    if (!litter) return;
    if (!Array.isArray(litter.waitlist)) litter.waitlist = [];

    const name = document.getElementById('wl-name')?.value.trim();
    if (!name) { showToast("Renseignez le nom de l'adoptant.", '⚠️', 'error'); return; }

    litter.waitlist.push({
        id: Date.now(),
        name,
        phone:   document.getElementById('wl-phone')?.value.trim() || '—',
        email:   document.getElementById('wl-email')?.value.trim() || '—',
        puppy:   document.getElementById('wl-puppy')?.value.trim() || '—',
        deposit: parseFloat(document.getElementById('wl-deposit')?.value) || 0,
        status:  document.getElementById('wl-status')?.value || 'En attente',
        notes:   document.getElementById('wl-notes')?.value.trim() || '',
        createdAt: Date.now()
    });

    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderWaitlistEntries(litter);
    renderLitters();

    ['wl-name','wl-phone','wl-email','wl-puppy','wl-notes'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('wl-deposit').value = '';
    document.getElementById('wl-status').value  = 'En attente';

    showToast(`${name} ajouté à la liste !`, '✅');
    trackEvent('waitlist_entry_added');
};

function renderWaitlistEntries(litter) {
    const container = document.getElementById('waitlist-entries');
    if (!container) return;
    const list = Array.isArray(litter.waitlist) ? litter.waitlist : [];

    if (list.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px 0;">Aucun adoptant en liste d\'attente.</p>';
        return;
    }

    const statusColors = {
        'En attente':    { bg: 'var(--gold-dim)',     color: 'var(--gold)',    border: 'var(--gold-border)' },
        'Acompte versé': { bg: 'rgba(82,201,122,0.1)', color: 'var(--success)', border: 'rgba(82,201,122,0.2)' },
        'Confirmé':      { bg: 'rgba(82,201,122,0.15)', color: 'var(--success)', border: 'rgba(82,201,122,0.3)' },
        'Annulé':        { bg: 'var(--danger-dim)',   color: 'var(--danger)',  border: 'rgba(224,82,82,0.2)' }
    };

    container.innerHTML = list.map((e, i) => {
        const sc = statusColors[e.status] || statusColors['En attente'];
        return `
        <div style="background:var(--bg-elevated); border:1px solid var(--card-border); border-radius:12px; padding:14px 16px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                <div>
                    <strong style="font-size:14px; color:var(--text);">${escHtml(e.name)}</strong>
                    ${e.deposit > 0 ? `<span style="margin-left:8px; background:var(--success-dim); color:var(--success); border:1px solid rgba(82,201,122,0.2); padding:2px 8px; border-radius:100px; font-size:11px; font-weight:700;">${e.deposit} € versés</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="background:${sc.bg}; color:${sc.color}; border:1px solid ${sc.border}; padding:3px 9px; border-radius:100px; font-size:11px; font-weight:700;">${escHtml(e.status)}</span>
                    <select onchange="updateWaitlistStatus('${litter.id}','${e.id}',this.value)" style="font-size:11px; padding:2px 4px; background:var(--bg-elevated); color:var(--text-muted); border:1px solid var(--card-border); border-radius:6px; cursor:pointer; width:auto;">
                        <option ${e.status==='En attente' ? 'selected' : ''}>En attente</option>
                        <option ${e.status==='Acompte versé' ? 'selected' : ''}>Acompte versé</option>
                        <option ${e.status==='Confirmé' ? 'selected' : ''}>Confirmé</option>
                        <option ${e.status==='Annulé' ? 'selected' : ''}>Annulé</option>
                    </select>
                    <button onclick="deleteWaitlistEntry('${litter.id}','${e.id}')" style="background:var(--danger-dim); border:1px solid rgba(224,82,82,0.2); color:var(--danger); border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:4px; font-size:12.5px; color:var(--text-muted);">
                ${e.phone !== '—' ? `<span><i class="fa-solid fa-phone" style="color:var(--gold); width:14px;"></i> ${escHtml(e.phone)}</span>` : ''}
                ${e.email !== '—' ? `<span><i class="fa-solid fa-envelope" style="color:var(--gold); width:14px;"></i> ${escHtml(e.email)}</span>` : ''}
                ${e.puppy !== '—' ? `<span><i class="fa-solid fa-paw" style="color:var(--gold); width:14px;"></i> Souhaite : ${escHtml(e.puppy)}</span>` : ''}
                ${e.notes ? `<span style="grid-column:1/-1;"><i class="fa-solid fa-note-sticky" style="color:var(--gold); width:14px;"></i> ${escHtml(e.notes)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

window.updateWaitlistStatus = function(litterId, entryId, newStatus) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter || !Array.isArray(litter.waitlist)) return;
    const entry = litter.waitlist.find(e => String(e.id) === String(entryId));
    if (!entry) return;
    entry.status = newStatus;
    saveLocalData(currentPetId, 'proLitters', proLitters);
    renderWaitlistEntries(litter);
    renderLitters();
    showToast(`Statut mis à jour : ${newStatus}`, '✅');
};

window.deleteWaitlistEntry = function(litterId, entryId) {
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    if (!litter || !Array.isArray(litter.waitlist)) return;
    showConfirm('Supprimer cet adoptant de la liste ?', () => {
        litter.waitlist = litter.waitlist.filter(e => String(e.id) !== String(entryId));
        saveLocalData(currentPetId, 'proLitters', proLitters);
        renderWaitlistEntries(litter);
        renderLitters();
        showToast('Adoptant retiré.', '🗑️');
    });
};

// ==========================================
// EXPORT PDF CARNET SANTÉ PAR CHIOT
// ==========================================
let _pdfLitterId = null;
let _pdfPuppyId  = null;

window.openPdfExportModal = function(litterId, puppyId) {
    _pdfLitterId = litterId;
    _pdfPuppyId  = puppyId;
    const litter = proLitters.find(l => String(l.id) === String(litterId));
    const puppy  = (litter?.puppies || []).find(p => String(p.id) === String(puppyId));
    if (!puppy) return;
    const nameEl = document.getElementById('pdf-puppy-name');
    if (nameEl) nameEl.textContent = puppy.name;
    document.getElementById('pdf-export-modal')?.classList.add('open');
};

window.closePdfModal = function() {
    document.getElementById('pdf-export-modal')?.classList.remove('open');
    _pdfLitterId = null; _pdfPuppyId = null;
};

window.exportPuppyPDF = function() {
    const litter = proLitters.find(l => String(l.id) === String(_pdfLitterId));
    const puppy  = (litter?.puppies || []).find(p => String(p.id) === String(_pdfPuppyId));
    if (!puppy || !litter) return;

    const profile  = getLocalData(currentPetId, 'profile', {});
    const weights  = Array.isArray(puppy.weights) ? [...puppy.weights].sort((a,b) => new Date(a.date)-new Date(b.date)) : [];
    const acts     = Array.isArray(puppy.acts)    ? [...puppy.acts].sort((a,b) => new Date(a.date)-new Date(b.date))    : [];
    const sexLabel = puppy.sex || 'Non précisé';
    const today    = new Date().toLocaleDateString('fr-FR');
    const breeder  = proData?.clubName || profile.name || 'Éleveur';

    const weightsRows = weights.length === 0
        ? '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px;">Aucune pesée enregistrée.</td></tr>'
        : weights.map(w => `<tr><td>${new Date(w.date).toLocaleDateString('fr-FR')}</td><td><strong>${w.weight} kg</strong></td></tr>`).join('');

    const actsRows = acts.length === 0
        ? '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px;">Aucun soin enregistré.</td></tr>'
        : acts.map(a => `<tr><td>${new Date(a.date).toLocaleDateString('fr-FR')}</td><td>${a.type}</td></tr>`).join('');

    const lastWeight = weights.length > 0 ? weights[weights.length-1].weight + ' kg' : 'Non renseigné';

    const qrUrl = puppy.cessionId ? `https://www.pablocanin.fr/?cession=${puppy.cessionId}` : '';
    const qrSection = qrUrl
        ? `<div style="text-align:center; margin-top:20px; padding:16px; border:2px dashed #c8922a; border-radius:10px;">
               <div style="font-size:13px; color:#c8922a; font-weight:700; margin-bottom:8px;">📱 Passeport numérique Pablo</div>
               <div style="font-size:11px; color:#888; margin-bottom:6px;">Scannez ou copiez ce lien pour récupérer le carnet numérique :</div>
               <div style="font-family:monospace; font-size:12px; background:#f5f5f5; padding:8px; border-radius:6px; word-break:break-all;">${qrUrl}</div>
           </div>`
        : '';

    const printWin = window.open('', '_blank');
    printWin.document.write(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <title>Carnet Santé — ${puppy.name}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 30px; }
                .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #c8922a; }
                .logo { font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: #c8922a; font-style: italic; }
                .logo span { font-style: normal; }
                .doc-title { font-size: 13px; color: #888; margin-top: 4px; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
                .info-card { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; }
                .info-card h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #c8922a; font-weight: 700; margin-bottom: 10px; }
                .info-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 12px; }
                .info-row .label { color: #888; }
                .info-row .value { font-weight: 600; color: #1a1a1a; }
                h2 { font-size: 13px; font-weight: 700; color: #1a1a1a; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .05em; border-left: 3px solid #c8922a; padding-left: 8px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th { background: #2d2d2d; color: #fff; padding: 7px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing:.04em; }
                td { padding: 7px 10px; border-bottom: 1px solid #eee; }
                tr:nth-child(even) td { background: #fafafa; }
                .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
                @media print { body { padding: 15px; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="logo">Pablo<span>.</span></div>
                    <div class="doc-title">Carnet de Santé — Document officiel de l'élevage</div>
                </div>
                <div style="text-align:right; font-size:11px; color:#888;">
                    Édité le ${today}<br>
                    <strong style="color:#1a1a1a;">${breeder}</strong>
                </div>
            </div>

            <div class="info-grid">
                <div class="info-card">
                    <h3>Identité du chiot</h3>
                    <div class="info-row"><span class="label">Nom</span><span class="value">${puppy.name}</span></div>
                    <div class="info-row"><span class="label">Sexe</span><span class="value">${sexLabel}</span></div>
                    <div class="info-row"><span class="label">Robe</span><span class="value">${puppy.color || 'Non renseignée'}</span></div>
                    <div class="info-row"><span class="label">N° Puce</span><span class="value">${puppy.chip || 'Non renseigné'}</span></div>
                    <div class="info-row"><span class="label">Date de naissance</span><span class="value">${puppy.birthDate ? new Date(puppy.birthDate).toLocaleDateString('fr-FR') : 'Non renseignée'}</span></div>
                    <div class="info-row"><span class="label">Statut</span><span class="value">${puppy.status || 'En élevage'}</span></div>
                </div>
                <div class="info-card">
                    <h3>Généalogie & Élevage</h3>
                    <div class="info-row"><span class="label">Race</span><span class="value">${profile.breed || 'Non renseignée'}</span></div>
                    <div class="info-row"><span class="label">Mère</span><span class="value">${puppy.dam || litter.dam || 'Non renseignée'}</span></div>
                    <div class="info-row"><span class="label">Père</span><span class="value">${puppy.sire || litter.sire || litter.partner || 'Non renseigné'}</span></div>
                    <div class="info-row"><span class="label">Poids actuel</span><span class="value">${lastWeight}</span></div>
                    <div class="info-row"><span class="label">Éleveur</span><span class="value">${breeder}</span></div>
                </div>
            </div>

            <h2>Courbe de croissance — ${weights.length} pesée(s)</h2>
            <table>
                <thead><tr><th>Date</th><th>Poids</th></tr></thead>
                <tbody>${weightsRows}</tbody>
            </table>

            <h2>Soins & Actes vétérinaires — ${acts.length} acte(s)</h2>
            <table>
                <thead><tr><th>Date</th><th>Acte réalisé</th></tr></thead>
                <tbody>${actsRows}</tbody>
            </table>

            ${qrSection}

            <div class="footer">
                Pablo — pablocanin.fr &nbsp;|&nbsp; Carnet généré automatiquement &nbsp;|&nbsp; ${today}
            </div>
        </body>
        </html>
    `);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); closePdfModal(); }, 400);
    trackEvent('puppy_pdf_exported');
};

// ==========================================
// ONGLETS SCREEN-PRO
// ==========================================
window.switchProTab = function(tab) {
    ['animal','elevage'].forEach(t => {
        document.getElementById('pro-tab-' + t)?.classList.toggle('active', t === tab);
        document.getElementById('tab-btn-' + t)?.classList.toggle('active', t === tab);
    });
};

// ==========================================
// NOM D'ÉLEVAGE — intégré dans saveProData / initProData
// ==========================================

// ==========================================
// DEMO + ONBOARDING
// ==========================================
function dateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

function clearPabloLocalDataset() {
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('firebase') || k.startsWith('clarity') || k.startsWith('_clarity')) return;
        localStorage.removeItem(k);
    });
}

function seedDemoDataset() {
    clearPabloLocalDataset();
    const nayaId = 'demo_naya';
    const pabloId = 'demo_pablo';
    petsList = [
        { id: nayaId, name: 'Naya' },
        { id: pabloId, name: 'Pablo' }
    ];
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    localStorage.setItem('current_pet_id', nayaId);
    localStorage.setItem('pablo_onboarded', '1');
    localStorage.setItem(DEMO_MODE_KEY, '1');

    setLocalDataOnly(nayaId, 'profile', {
        name: 'Naya', species: 'Chien', breed: 'Berger Allemand', age: 32, size: 61, weight: 31.4, avatar: '', birthDate: dateOffset(-980), sterilized: 'no',
        breedAdvice: '<p><strong>Berger Allemand :</strong> chien sportif, proche de son humain, qui a besoin de régularité. Surveillez surtout la croissance, les articulations, le poids et la récupération après l\'effort.</p>'
    });
    setLocalDataOnly(nayaId, 'weight', [
        { date: dateOffset(-150), weight: 27.8 },
        { date: dateOffset(-120), weight: 28.9 },
        { date: dateOffset(-90), weight: 30.1 },
        { date: dateOffset(-60), weight: 30.8 },
        { date: dateOffset(-30), weight: 31.2 },
        { date: dateOffset(-4), weight: 31.4 }
    ]);
    setLocalDataOnly(nayaId, 'medical', [
        { type: 'Vaccin', date: dateOffset(-335) },
        { type: 'Vermifuge', date: dateOffset(-82) },
        { type: 'Anti-puces', date: dateOffset(-26) },
        { type: 'Dents', date: dateOffset(-10) }
    ]);
    setLocalDataOnly(nayaId, 'education', { assis: 3, rappel: 2, 'marche-laisse': 2, solitude: 1 });
    setLocalDataOnly(nayaId, 'daily', { water: 950, walk: 70, date: new Date().toISOString().split('T')[0] });
    setLocalDataOnly(nayaId, 'chat', [
        { sender: 'bot', text: 'Bienvenue dans la démo Pablo. Ici, Naya a déjà un carnet santé, un suivi de poids et un module élevage rempli.' },
        { sender: 'user', text: 'Que dois-je surveiller cette semaine ?' },
        { sender: 'bot', text: 'Priorité : vermifuge bientôt à renouveler, stock de croquettes à vérifier et suivi des chiots de la portée A. Wouf !' }
    ]);
    setLocalDataOnly(nayaId, 'budget', [
        { id: 1, title: 'Croquettes performance 12 kg', amount: 68.9, date: dateOffset(-12) },
        { id: 2, title: 'Vermifuge', amount: 18.5, date: dateOffset(-7) },
        { id: 3, title: 'Jouet enrichissement', amount: 14.9, date: dateOffset(-2) }
    ]);
    setLocalDataOnly(nayaId, 'proData', {
        gender: 'Femelle', chip: '250268712345678', lof: 'LOF 1 B.AL. 998877', pedigree: 'Lignée travail', dna: 'ADN validé', xrays: 'Hanches A/A - Coudes 0/0',
        clubName: 'Club du Berger Allemand', clubDate: dateOffset(-420), optimalDate: dateOffset(-48), expectedBirth: dateOffset(18), actualBirth: '', heatReminder: true,
        kennelName: 'Élevage du Val Pablo', siren: '894 011 170', dept: '59 - Nord', website: 'facebook.com/elevage-val-pablo',
        ficheDescription: 'Petit élevage familial de Bergers Allemands, axé tempérament stable, suivi santé et accompagnement des familles.'
    });
    setLocalDataOnly(nayaId, 'proEvents', [
        { id: 1, type: 'Confirmation', date: dateOffset(24), note: 'Préparer carnet, LOF et certificat vétérinaire.' },
        { id: 2, type: 'Rendez-vous vétérinaire', date: dateOffset(7), note: 'Échographie de contrôle.' }
    ]);
    setLocalDataOnly(nayaId, 'proHistory', {
        heats: [{ id: 1, date: dateOffset(-68), note: 'Chaleurs régulières' }],
        matings: [{ id: 2, date: dateOffset(-45), partner: 'Oslo du Domaine Nord', note: 'Saillie confirmée' }]
    });
    setLocalDataOnly(nayaId, 'proLitters', [{
        id: 'demo_litter_a', date: dateOffset(-65), partner: 'Oslo du Domaine Nord', count: 4, dam: 'Naya', sire: 'Oslo du Domaine Nord',
        puppies: [
            { id: 'pup_a1', name: 'Athos', sex: 'Mâle', color: 'Noir et feu', chip: '250269100000001', birthDate: dateOffset(-65), dam: 'Naya', sire: 'Oslo', status: 'Disponible', weights: [{ date: dateOffset(-50), weight: 1.4 }, { date: dateOffset(-20), weight: 4.2 }], acts: [{ type: 'Vaccin', date: dateOffset(-8) }] },
            { id: 'pup_a2', name: 'Alma', sex: 'Femelle', color: 'Fauve charbonné', chip: '250269100000002', birthDate: dateOffset(-65), dam: 'Naya', sire: 'Oslo', status: 'Réservé', weights: [{ date: dateOffset(-50), weight: 1.3 }, { date: dateOffset(-20), weight: 3.9 }], acts: [{ type: 'Vermifuge', date: dateOffset(-12) }] }
        ],
        waitlist: [
            { id: 'wl_1', name: 'Famille Martin', phone: '06 12 34 56 78', email: 'martin@example.fr', status: 'À rappeler', deposit: 'Oui', note: 'Cherche femelle calme.' },
            { id: 'wl_2', name: 'Mme Leroy', phone: '06 98 76 54 32', email: 'leroy@example.fr', status: 'En attente', deposit: 'Non', note: 'Disponible fin août.' }
        ]
    }]);
    setLocalDataOnly(nayaId, 'healthExtras', {
        ...getDefaultHealthExtras(),
        allergies: 'Aucune connue',
        vetName: 'Clinique VetNord',
        vetPhone: '03 20 00 00 00',
        kibbleBag: 12,
        kibbleRemaining: 3.4,
        insurance: 'Mutuelle sante active',
        foodName: 'Croquettes performance agneau',
        chronicConditions: 'Surveillance post-gestation',
        recurringTreatment: 'Vermifuge selon calendrier elevage',
        emergencyNotes: 'Transporter avec carnet, puce et historique de portee.'
    });
    setLocalDataOnly(nayaId, 'memories', [
        { id: 1, date: dateOffset(-40), title: 'Première balade avec les chiots', text: 'Tout le monde a suivi Naya dans le jardin.' }
    ]);
    setLocalDataOnly(nayaId, 'gamification', { streak: 6, lastLogin: new Date().toISOString().split('T')[0], badges: ['first_weight', 'health_ready', 'breeder_mode'] });
    setLocalDataOnly(nayaId, 'registre', [
        { id: 1, type: 'Entrée — Naissance', date: dateOffset(-65), animal: 'Portée A - 4 chiots', chip: 'À identifier', person: 'Élevage du Val Pablo', createdAt: Date.now() - 1000 },
        { id: 2, type: 'Sortie — Réservation', date: dateOffset(-5), animal: 'Alma', chip: '250269100000002', person: 'Famille Martin', createdAt: Date.now() }
    ]);

    setLocalDataOnly(pabloId, 'profile', { name: 'Pablo', species: 'Chien', breed: 'Berger Allemand', age: 54, size: 64, weight: 36.8, avatar: '', birthDate: dateOffset(-1640), sterilized: 'yes', breedAdvice: '' });
    setLocalDataOnly(pabloId, 'weight', [{ date: dateOffset(-40), weight: 36.2 }, { date: dateOffset(-8), weight: 36.8 }]);
    setLocalDataOnly(pabloId, 'medical', [{ type: 'Vaccin', date: dateOffset(-210) }, { type: 'Anti-puces', date: dateOffset(-12) }]);
    setLocalDataOnly(pabloId, 'education', { assis: 3, rappel: 3, 'pas-bouger': 2 });
    setLocalDataOnly(pabloId, 'daily', { water: 700, walk: 45, date: new Date().toISOString().split('T')[0] });
    setLocalDataOnly(pabloId, 'chat', [{ sender: 'bot', text: 'Je suis le second profil de démo. Utilisez le sélecteur pour voir le multi-animal.' }]);
    setLocalDataOnly(pabloId, 'budget', []);
    setLocalDataOnly(pabloId, 'proData', { gender: 'Mâle' });
    setLocalDataOnly(pabloId, 'proEvents', []);
    setLocalDataOnly(pabloId, 'proLitters', []);
    setLocalDataOnly(pabloId, 'healthExtras', {
        ...getDefaultHealthExtras(),
        vetName: 'Clinique VetNord',
        vetPhone: '03 20 00 00 00',
        kibbleBag: 12,
        kibbleRemaining: 7.1,
        foodName: 'Croquettes adulte grande race'
    });
    setLocalDataOnly(pabloId, 'proHistory', { heats: [], matings: [] });
    setLocalDataOnly(pabloId, 'memories', []);
    setLocalDataOnly(pabloId, 'gamification', { streak: 2, lastLogin: new Date().toISOString().split('T')[0], badges: [] });
    setLocalDataOnly(pabloId, 'registre', []);
}

window.startDemoMode = function() {
    const existingPets = getPetsListFromStorage();
    const launch = () => {
        seedDemoDataset();
        showMainApp();
        navigateTo('screen-home');
        showToast('Démo chargée : explorez Pablo sans compte.', '✨');
        trackEvent('demo_started');
    };

    if (existingPets.length > 0 && localStorage.getItem(DEMO_MODE_KEY) !== '1' && !auth.currentUser && typeof showConfirm === 'function') {
        showConfirm('La démo va remplacer les données locales de test sur cet appareil. Continuer ?', launch);
        return;
    }
    launch();
};

window.resetDemoMode = function() {
    clearPabloLocalDataset();
    document.getElementById('main-app-layout').style.display = 'none';
    document.getElementById('auth-page').style.display = 'none';
    document.getElementById('landing-page').style.display = 'block';
    updateDemoModeUI();
    showToast('Démo quittée. Vous pouvez créer votre vrai carnet.', '✅');
};

window.startOnboarding = function(forceFresh = false) {
    if (!auth.currentUser) {
        if (forceFresh || localStorage.getItem(DEMO_MODE_KEY) === '1') {
            clearPabloLocalDataset();
            updateDemoModeUI();
        }
        document.getElementById('onboarding-overlay')?.classList.remove('open');
        document.getElementById('main-app-layout').style.display = 'none';
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('auth-page').style.display = 'flex';
        if (typeof window.showAuthMsg === 'function') {
            window.showAuthMsg("Connectez-vous pour creer votre vrai carnet.", "success");
        }
        return;
    }

    if (forceFresh || localStorage.getItem(DEMO_MODE_KEY) === '1') {
        clearPabloLocalDataset();
        updateDemoModeUI();
    } else if (localStorage.getItem('pablo_onboarded') && hasLocalAppData()) {
        enterApp();
        return;
    }
    obSetStep(1);
    ['ob-pet-name', 'ob-pet-breed', 'ob-pet-weight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const species = document.getElementById('ob-pet-species');
    if (species) species.value = 'Chien';
    document.getElementById('onboarding-overlay')?.classList.add('open');
    document.getElementById('landing-page').style.display = 'none';
    document.getElementById('auth-page').style.display = 'none';
};

function obSetStep(n) {
    [1,2,3].forEach(i => {
        const el = document.getElementById('ob-step-' + i);
        const s  = document.getElementById('ob-s' + i);
        if (el) el.style.display = i === n ? 'block' : 'none';
        if (s)  { s.classList.toggle('active', i === n); s.classList.toggle('done', i < n); }
    });
}

window.obNext = function(step) {
    if (step === 1) {
        const name = document.getElementById('ob-pet-name')?.value.trim();
        if (!name) { showToast('Donnez un nom à votre animal 🐾', '⚠️', 'error'); return; }
        obSetStep(2);
    } else if (step === 2) {
        obSetStep(3);
        const name = document.getElementById('ob-pet-name')?.value.trim() || 'votre compagnon';
        const nameEl = document.getElementById('ob-pet-name-display');
        if (nameEl) nameEl.textContent = name;
    }
};

window.finishOnboarding = function() {
    if (!auth.currentUser) {
        document.getElementById('onboarding-overlay')?.classList.remove('open');
        enterApp();
        if (typeof window.showAuthMsg === 'function') {
            window.showAuthMsg("Connectez-vous pour enregistrer votre carnet.", "error");
        }
        return;
    }

    const name    = document.getElementById('ob-pet-name')?.value.trim()    || 'Mon animal';
    const species = document.getElementById('ob-pet-species')?.value         || 'Chien';
    const breed   = document.getElementById('ob-pet-breed')?.value.trim()   || '';
    const weight  = parseFloat(document.getElementById('ob-pet-weight')?.value) || 0;

    const newId = 'pet_' + Date.now();
    petsList = getPetsListFromStorage();
    petsList.push({ id: newId, name });
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));

    saveLocalData(newId, 'profile',      { name, species, breed, age: 0, size: 0, weight, avatar: '', birthDate: '', sterilized: '', breedAdvice: '' });
    saveLocalData(newId, 'weight',       weight > 0 ? [{ date: new Date().toISOString().split('T')[0], weight }] : []);
    saveLocalData(newId, 'medical',      []);
    saveLocalData(newId, 'education',    {});
    saveLocalData(newId, 'daily',        { water: 0, walk: 0, date: new Date().toISOString().split('T')[0] });
    saveLocalData(newId, 'chat',         [{ sender: 'bot', text: `Wouf ! Je suis l'assistant de ${name}. Comment puis-je aider ?` }]);
    saveLocalData(newId, 'budget',       []);
    saveLocalData(newId, 'proData',      { gender: 'Non spécifié' });
    saveLocalData(newId, 'proEvents',    []);
    saveLocalData(newId, 'proLitters',   []);
    saveLocalData(newId, 'healthExtras', getDefaultHealthExtras());
    saveLocalData(newId, 'proHistory',   { heats: [], matings: [] });
    saveLocalData(newId, 'memories',     []);
    saveLocalData(newId, 'gamification', { streak: 0, lastLogin: null, badges: [] });
    saveLocalData(newId, 'registre',     []);

    localStorage.setItem('current_pet_id',   newId);
    localStorage.setItem('pablo_onboarded',  '1');
    saveCloudFields({ app_pets_list: petsList, current_pet_id: newId, pablo_onboarded: '1' });

    localStorage.removeItem(DEMO_MODE_KEY);
    showMainApp();
    showToast(`Carnet de ${name} créé ! 🐾`, '✅');
    trackEvent('onboarding_completed');
};

window.skipOnboarding = function() {
    document.getElementById('onboarding-overlay')?.classList.remove('open');
    if (auth.currentUser) showMainApp();
    else enterApp();
};

// ==========================================
// SHARE CARD 1080×1080
// ==========================================
let _sharePhotoDataUrl = null;

window.previewSharePhoto = function(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
        _sharePhotoDataUrl = reader.result;
        const img     = document.getElementById('share-photo-img');
        const preview = document.getElementById('share-photo-preview');
        if (img)     img.src             = reader.result;
        if (preview) preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
};

window.generateShareCard = function() {
    const canvas  = document.getElementById('share-canvas');
    if (!canvas) return;
    const ctx     = canvas.getContext('2d');
    const W = 1080, H = 1080;
    canvas.width  = W;
    canvas.height = H;

    const name    = petProfile.name   || 'Mon compagnon';
    const breed   = petProfile.breed  || '';
    const weight  = petProfile.weight ? petProfile.weight + ' kg' : '';
    const message = document.getElementById('share-message')?.value.trim() || '';
    const photoSrc = _sharePhotoDataUrl || petProfile.avatar || null;

    ctx.fillStyle = '#0d0b07';
    ctx.fillRect(0, 0, W, H);

    const grad = ctx.createRadialGradient(W*0.2, H*0.1, 0, W*0.2, H*0.1, W*0.7);
    grad.addColorStop(0, 'rgba(200,146,42,0.12)');
    grad.addColorStop(1, 'rgba(200,146,42,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    for (let i = 0; i < 3000; i++) {
        ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
    }

    ctx.strokeStyle = 'rgba(200,146,42,0.3)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.roundRect(16, 16, W-32, H-32, 40);
    ctx.stroke();

    ctx.font      = 'italic 600 72px Georgia, serif';
    ctx.fillStyle = '#c8922a';
    ctx.textAlign = 'center';
    ctx.fillText('Pablo.', W/2, 110);

    ctx.font      = '400 28px Outfit, Arial, sans-serif';
    ctx.fillStyle = 'rgba(240,232,216,0.35)';
    ctx.fillText('pablocanin.fr', W/2, 155);

    ctx.strokeStyle = 'rgba(200,146,42,0.4)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(160, 180); ctx.lineTo(W-160, 180);
    ctx.stroke();

    const drawPlaceholder = (cx, cy, r) => {
        const g2 = ctx.createLinearGradient(cx-r, cy-r, cx+r, cy+r);
        g2.addColorStop(0, '#1c1710'); g2.addColorStop(1, '#2a2215');
        ctx.fillStyle = g2; ctx.fill();
        ctx.font = `700 ${r}px Georgia, serif`;
        ctx.fillStyle = '#c8922a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((name || 'P').charAt(0).toUpperCase(), cx, cy);
        ctx.textBaseline = 'alphabetic';
    };

    const drawText = () => {
        ctx.textAlign = 'center';
        ctx.font      = 'italic 700 88px Georgia, serif';
        ctx.fillStyle = '#f0e8d8';
        ctx.fillText(name, W/2, 680);
        if (breed) { ctx.font = '400 38px Outfit, Arial, sans-serif'; ctx.fillStyle = '#c8922a'; ctx.fillText(breed, W/2, 740); }
        if (weight) { ctx.font = '300 30px Outfit, Arial, sans-serif'; ctx.fillStyle = 'rgba(240,232,216,0.4)'; ctx.fillText(weight, W/2, 790); }
        if (message) { ctx.font = '600 36px Outfit, Arial, sans-serif'; ctx.fillStyle = '#e8b84b'; ctx.fillText(message, W/2, 870); }
        ctx.strokeStyle = 'rgba(200,146,42,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(160, 920); ctx.lineTo(W-160, 920); ctx.stroke();
        ctx.font = '400 26px Outfit, Arial, sans-serif'; ctx.fillStyle = 'rgba(240,232,216,0.25)';
        ctx.fillText('Suivi de santé généré avec Pablo • pablocanin.fr', W/2, 980);
        ctx.font = '60px serif'; ctx.fillStyle = 'rgba(200,146,42,0.15)';
        ctx.fillText('🐾', W - 90, H - 50);
    };

    const photoSize = 360, photoX = (W-photoSize)/2, photoY = 210, photoR = photoSize/2;
    const cx = photoX + photoR, cy = photoY + photoR;

    ctx.beginPath(); ctx.arc(cx, cy, photoR + 10, 0, Math.PI*2);
    ctx.strokeStyle = '#c8922a'; ctx.lineWidth = 4; ctx.stroke();

    if (photoSrc) {
        const img = new Image();
        img.onload = () => {
            ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, photoR, 0, Math.PI*2); ctx.clip();
            ctx.drawImage(img, photoX, photoY, photoSize, photoSize); ctx.restore();
            drawText();
            document.getElementById('share-canvas-wrap').classList.add('open');
        };
        img.onerror = () => {
            ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, photoR, 0, Math.PI*2); ctx.clip();
            drawPlaceholder(cx, cy, photoR); ctx.restore();
            drawText();
            document.getElementById('share-canvas-wrap').classList.add('open');
        };
        img.src = photoSrc;
    } else {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, photoR, 0, Math.PI*2); ctx.clip();
        drawPlaceholder(cx, cy, photoR); ctx.restore();
        drawText();
        document.getElementById('share-canvas-wrap').classList.add('open');
    }
    trackEvent('share_card_generated');
};

window.downloadShareCard = function() {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `pablo-${(petProfile.name || 'animal').toLowerCase().replace(/\s+/g,'-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Image téléchargée ! 📸', '✅');
};

window.closeShareCanvas = function() {
    document.getElementById('share-canvas-wrap')?.classList.remove('open');
    _sharePhotoDataUrl = null;
    const input = document.getElementById('share-photo-input');
    if (input) input.value = '';
    const preview = document.getElementById('share-photo-preview');
    if (preview) preview.style.display = 'none';
};
// ==========================================
// MODE HORS-LIGNE
// ==========================================
window.addEventListener('online',  () => {
    document.getElementById('offline-banner')?.classList.remove('show');
    flushPendingCloudWrites();
});
window.addEventListener('offline', () => {
    document.getElementById('offline-banner')?.classList.add('show');
    setCloudStatus('offline', 'Hors ligne');
});
if (!navigator.onLine) {
    document.getElementById('offline-banner')?.classList.add('show');
    setCloudStatus('offline', 'Hors ligne');
}

// Wrapper IA offline-safe
const _groqChatOriginal = groqChat;
window._groqChatSafe = async function(messages) {
    if (!navigator.onLine) {
        showToast("Pas de connexion — l'IA est indisponible.", '📵', 'error');
        throw new Error('offline');
    }
    return _groqChatOriginal(messages);
};

// ==========================================
// NOTIFICATIONS FCM — FINALISÉ
// ==========================================
window.schedulePushReminders = async function() {
    if (!auth.currentUser) return;
    const reminders = [];
    const today     = new Date();

    const rules = { 'Vaccin': 365, 'Vermifuge': 90, 'Anti-puces': 30 };
    Object.keys(rules).forEach(type => {
        const events = medicalEvents.filter(e => e.type === type);
        const sorted = events.sort((a,b) => new Date(b.date)-new Date(a.date));
        const last   = sorted.length > 0 ? new Date(sorted[0].date) : null;
        const days   = last ? Math.ceil(Math.abs(today-last)/86400000) : 999;
        if (!last || days > rules[type] - 7) {
            reminders.push({ type, overdue: !last || days > rules[type], daysLeft: last ? rules[type]-days : 0 });
        }
    });

    // Sauvegarder les rappels dans Firestore pour la Cloud Function
    if (reminders.length > 0) {
        try {
            await setDoc(
                doc(db, 'users', auth.currentUser.uid),
                { pendingReminders: reminders, petName: petProfile.name || 'votre animal', updatedAt: Date.now() },
                { merge: true }
            );
        } catch (e) { console.warn('Erreur sauvegarde reminders:', e); }
    }
}

// Amélioration de requestNotificationPermission — appel schedulePushReminders après activation
const _originalRequestNotif = window.requestNotificationPermission;
window.requestNotificationPermission = async function() {
    await _originalRequestNotif();
    await schedulePushReminders();
};

// ==========================================
// CALCULATEUR DATES REPRODUCTION
// ==========================================
window.calcReproDates = function() {
    const dateInput = document.getElementById('calc-mating-date');
    if (!dateInput?.value) return;

    const saillie   = new Date(dateInput.value);
    const addDays   = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
    const fmt       = d => d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    const fec     = addDays(saillie, 12);
    const birth   = addDays(saillie, 63);
    const sevrage = addDays(birth,   56);
    const depart  = addDays(birth,   63);

    document.getElementById('calc-fec').textContent     = fmt(fec);
    document.getElementById('calc-birth').textContent   = fmt(birth);
    document.getElementById('calc-sevrage').textContent = fmt(sevrage);
    document.getElementById('calc-depart').textContent  = fmt(depart);

    document.getElementById('repro-calc-result').classList.add('show');
    document.getElementById('btn-apply-repro').style.display = 'block';

    // Stocker pour applyReproDates
    window._reproCalcData = {
        optimalDate:   fec.toISOString().split('T')[0],
        expectedBirth: birth.toISOString().split('T')[0]
    };
};

window.applyReproDates = function() {
    if (!window._reproCalcData) return;
    const opEl = document.getElementById('pro-optimal-date');
    const nbEl = document.getElementById('pro-expected-birth');
    if (opEl) opEl.value = window._reproCalcData.optimalDate;
    if (nbEl) nbEl.value = window._reproCalcData.expectedBirth;
    showToast('Dates appliquées au profil !', '✅');
};

// ==========================================
// RAPPEL SAC DE CROQUETTES — AMÉLIORÉ
// ==========================================
const _originalRefillKibble = window.refillKibbleBag;
window.refillKibbleBag = function() {
    _originalRefillKibble();
    updateKibbleDaysAlert();
};

// updateKibbleDaysAlert déplacée avant initHealthExtras

// updateKibbleDaysAlert est appelé directement dans initHealthExtras ci-dessous
// (patch inline pour éviter la redéclaration)

// ==========================================
// STATS ÉLEVAGE
// ==========================================
window.updateElevageStats = function updateElevageStats() {
    const totalPortees = proLitters.length;
    let totalChiots = 0, chiotsCedes = 0, chiotsDispo = 0, totalWaitlist = 0;

    proLitters.forEach(l => {
        const puppies = Array.isArray(l.puppies) ? l.puppies : [];
        totalChiots  += puppies.length;
        chiotsCedes  += puppies.filter(p => p.status === 'Cédé').length;
        chiotsDispo  += puppies.filter(p => p.status === 'En élevage').length;
        totalWaitlist += Array.isArray(l.waitlist) ? l.waitlist.filter(w => w.status !== 'Annulé').length : 0;
    });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-portees',       totalPortees);
    set('stat-chiots-total',  totalChiots);
    set('stat-chiots-cedes',  chiotsCedes);
    set('stat-chiots-dispo',  chiotsDispo);
    set('stat-waitlist',      totalWaitlist);
}

// updateElevageStats() est appelé directement dans initProData (voir ci-dessus)

// updateElevageStats() est appelé directement dans la vraie initProData (patch inline)

// ==========================================
// FICHE PUBLIQUE ÉLEVAGE
// ==========================================
// Photo fiche publique (base64)
let _fichePhotoDataUrl = null;

window.previewFichePhoto = function(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
        _fichePhotoDataUrl = reader.result;
        const img  = document.getElementById('fiche-photo-img');
        const icon = document.getElementById('fiche-photo-icon');
        if (img)  { img.src = reader.result; img.style.display = 'block'; }
        if (icon) icon.style.display = 'none';
    };
    reader.readAsDataURL(file);
};

window.generateFichePublique = async function() {
    if (!auth.currentUser) { showToast('Connectez-vous pour générer votre fiche.', '⚠️', 'error'); return; }

    const kennelNameInput = document.getElementById('fiche-kennel-name')?.value.trim();
    if (!kennelNameInput) { showToast("Renseignez le nom de l'élevage.", '⚠️', 'error'); return; }

    const btn = document.getElementById('btn-generate-fiche');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publication…'; }

    try {
        const ficheId   = auth.currentUser.uid;
        const animaux   = [];

        petsList.forEach(pet => {
            const p    = getLocalData(pet.id, 'profile', {});
            const proD = getLocalData(pet.id, 'proData', {});
            const litters = getLocalData(pet.id, 'proLitters', []);
            const availablePuppies = [];
            litters.forEach(l => {
                (l.puppies || []).filter(pup => pup.status === 'En élevage').forEach(pup => {
                    availablePuppies.push({ name: pup.name, sex: pup.sex, color: pup.color, chip: pup.chip, birthDate: pup.birthDate });
                });
            });
            animaux.push({
                name: pet.name, breed: p.breed || '', gender: proD.gender || '',
                lof: proD.lof || '', chip: proD.chip || '',
                availablePuppies
            });
        });

        const ficheData = {
            uid:         ficheId,
            kennelName:  kennelNameInput,
            description: document.getElementById('fiche-description')?.value.trim() || '',
            phone:       document.getElementById('fiche-phone')?.value.trim()       || '',
            email:       document.getElementById('fiche-email')?.value.trim()       || '',
            dept:        document.getElementById('fiche-dept')?.value.trim()        || proData.dept || '',
            website:     document.getElementById('fiche-website')?.value.trim()     || proData.website || '',
            photo:       _fichePhotoDataUrl || '',
            animaux,
            updatedAt:   Date.now()
        };

        await setDoc(doc(db, 'fiches_publiques', ficheId), ficheData);

        // Sauvegarder aussi dans proData
        proData.kennelName = kennelNameInput;
        proData.dept       = ficheData.dept;
        proData.website    = ficheData.website;
        saveLocalData(currentPetId, 'proData', proData);

        const url = `${window.location.origin}/fiche/${ficheId}`;
        const urlInput = document.getElementById('public-fiche-url');
        const wrap     = document.getElementById('public-fiche-link-wrap');
        if (urlInput) urlInput.value = url;
        if (wrap)     wrap.style.display = 'block';
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Mettre à jour la fiche';
        }

        showToast('Fiche publiée ! 🌐', '✅');
        trackEvent('fiche_publique_generated');
    } catch (e) {
        console.error('Erreur fiche publique:', e);
        showToast('Erreur lors de la publication.', '⚠️', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Générer ma fiche publique'; }
    }
};

window.copyFichePublique = function() {
    const url = document.getElementById('public-fiche-url')?.value;
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => showToast('Lien copié !', '📋')).catch(() => showToast('Copiez le lien manuellement.', '⚠️'));
};

window.openFichePublique = function() {
    const url = document.getElementById('public-fiche-url')?.value;
    if (url) window.open(url, '_blank');
};

// ==========================================
// EXPORT PDF CARNET ADULTE COMPLET
// ==========================================
window.exportCarnetAdultePDF = function() {
    const name    = petProfile.name   || 'Animal';
    const breed   = petProfile.breed  || 'Non renseignée';
    const species = petProfile.species || 'Chien';
    const today   = new Date().toLocaleDateString('fr-FR');
    const vet     = healthExtras.vetName  || '—';
    const vetTel  = healthExtras.vetPhone || '—';

    const medSorted = [...medicalEvents].sort((a,b) => new Date(b.date)-new Date(a.date));
    const wSorted   = [...weightHistory].sort((a,b) => new Date(a.date)-new Date(b.date));
    const budgetMonth = budgetExpenses.reduce((s,e) => s + e.amount, 0);

    const medRows = medSorted.length === 0
        ? '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px;">Aucun acte.</td></tr>'
        : medSorted.map(e => `<tr><td>${new Date(e.date).toLocaleDateString('fr-FR')}</td><td>${e.type}</td></tr>`).join('');

    const weightRows = wSorted.length === 0
        ? '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px;">Aucune pesée.</td></tr>'
        : wSorted.map(w => `<tr><td>${new Date(w.date).toLocaleDateString('fr-FR')}</td><td><strong>${w.weight} kg</strong></td></tr>`).join('');

    const budgetRows = budgetExpenses.length === 0
        ? '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:10px;">Aucune dépense.</td></tr>'
        : [...budgetExpenses].sort((a,b) => new Date(b.date)-new Date(a.date)).map(e => `<tr><td>${new Date(e.date).toLocaleDateString('fr-FR')}</td><td>${e.title}</td><td><strong>${e.amount.toFixed(2)} €</strong></td></tr>`).join('');

    const eduItems = Object.entries(educationData).map(([id,level]) => {
        const labels = ['À commencer','En cours','Acquis','Maîtrisé'];
        const ex = [...(window.DEFAULT_EDU_EXERCISES || [])].find(e => e.id === id);
        return ex ? `<tr><td>${ex.name}</td><td>${labels[level] || '—'}</td></tr>` : '';
    }).join('');

    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Carnet Santé — ${name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:30px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #c8922a}
.logo{font-family:Georgia,serif;font-size:28px;font-weight:700;color:#c8922a;font-style:italic}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
.info-card{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:12px}
.info-card h3{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#c8922a;font-weight:700;margin-bottom:8px}
.info-row{display:flex;justify-content:space-between;margin-bottom:4px;font-size:11.5px}
.info-row .l{color:#888}.info-row .v{font-weight:600}
h2{font-size:12px;font-weight:700;color:#1a1a1a;margin:18px 0 7px;text-transform:uppercase;letter-spacing:.05em;border-left:3px solid #c8922a;padding-left:8px}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{background:#2d2d2d;color:#fff;padding:7px 10px;text-align:left;font-size:10.5px;text-transform:uppercase}
td{padding:7px 10px;border-bottom:1px solid #eee}
tr:nth-child(even) td{background:#fafafa}
.footer{margin-top:28px;text-align:center;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:10px}
.total-row td{font-weight:700;background:#f0f0f0}
</style></head><body>
<div class="header">
    <div><div class="logo">Pablo.</div><div style="font-size:11px;color:#888;margin-top:4px;">Carnet de santé complet</div></div>
    <div style="text-align:right;font-size:11px;color:#888;">Édité le ${today}<br><strong style="color:#1a1a1a;">${name}</strong></div>
</div>
<div class="info-grid">
    <div class="info-card">
        <h3>Identité</h3>
        <div class="info-row"><span class="l">Nom</span><span class="v">${name}</span></div>
        <div class="info-row"><span class="l">Espèce</span><span class="v">${species}</span></div>
        <div class="info-row"><span class="l">Race</span><span class="v">${breed}</span></div>
        <div class="info-row"><span class="l">Poids actuel</span><span class="v">${petProfile.weight ? petProfile.weight + ' kg' : '—'}</span></div>
        <div class="info-row"><span class="l">Allergies</span><span class="v">${healthExtras.allergies || 'Aucune'}</span></div>
    </div>
    <div class="info-card">
        <h3>Vétérinaire</h3>
        <div class="info-row"><span class="l">Nom</span><span class="v">${vet}</span></div>
        <div class="info-row"><span class="l">Téléphone</span><span class="v">${vetTel}</span></div>
        <div class="info-row"><span class="l">Total dépenses</span><span class="v">${budgetMonth.toFixed(2)} €</span></div>
    </div>
</div>
<h2>Actes & Soins — ${medSorted.length} acte(s)</h2>
<table><thead><tr><th>Date</th><th>Acte</th></tr></thead><tbody>${medRows}</tbody></table>
<h2>Courbe de croissance — ${wSorted.length} pesée(s)</h2>
<table><thead><tr><th>Date</th><th>Poids</th></tr></thead><tbody>${weightRows}</tbody></table>
<h2>Éducation</h2>
<table><thead><tr><th>Exercice</th><th>Niveau</th></tr></thead><tbody>${eduItems || '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px;">Aucun exercice.</td></tr>'}</tbody></table>
<h2>Dépenses</h2>
<table><thead><tr><th>Date</th><th>Description</th><th>Montant</th></tr></thead><tbody>${budgetRows}
<tr class="total-row"><td colspan="2">Total</td><td>${budgetMonth.toFixed(2)} €</td></tr>
</tbody></table>
<div class="footer">Pablo — pablocanin.fr &nbsp;|&nbsp; Carnet généré automatiquement &nbsp;|&nbsp; ${today}</div>
</body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); }, 400);
    trackEvent('carnet_adulte_exported');
};

// ==========================================
// WIDGET iOS/ANDROID — PWA Shortcuts
// ==========================================
// Ajout dans le manifest dynamiquement si pas déjà fait
(async function injectPWAShortcuts() {
    try {
        const link = document.querySelector('link[rel="manifest"]');
        if (!link) return;
        const resp = await fetch(link.href);
        const manifest = await resp.json();
        if (manifest.shortcuts) return; // déjà présent
        manifest.shortcuts = [
            { name: "Accueil Pablo", short_name: "Accueil", url: "/?screen=home", icons: [{ src: "/pablo.jpg", sizes: "192x192" }] },
            { name: "Mes rappels", short_name: "Rappels", url: "/?screen=carnet", icons: [{ src: "/pablo.jpg", sizes: "192x192" }] },
            { name: "Hey Pablo", short_name: "IA", url: "/?screen=chat", icons: [{ src: "/pablo.jpg", sizes: "192x192" }] }
        ];
        const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
        const newUrl = URL.createObjectURL(blob);
        link.href = newUrl;
    } catch(e) { /* non bloquant */ }
})();

// Deep link depuis shortcuts PWA
(function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get('screen');
    if (screen && auth.currentUser) {
        setTimeout(() => navigateTo('screen-' + screen), 800);
    }
})();

// ==========================================
// MODE MULTI-UTILISATEURS — Partage de profil
// ==========================================
window.generateShareToken = async function() {
    if (!auth.currentUser || !currentPetId) return;
    const token    = Math.random().toString(36).slice(2,10).toUpperCase();
    const shareUrl = `${window.location.origin}/?share=${token}`;

    try {
        await setDoc(doc(db, 'shared_profiles', token), {
            ownerUid:  auth.currentUser.uid,
            petId:     currentPetId,
            petName:   petProfile.name || 'Animal',
            createdAt: Date.now(),
            expiresAt: Date.now() + 7 * 86400000 // 7 jours
        });
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(shareUrl);
            showToast(`Lien de partage copié ! Valable 7 jours.`, '🔗');
        }
    } catch(e) {
        console.error('Erreur partage:', e);
        showToast('Erreur lors du partage.', '⚠️', 'error');
    }
};

// Bouton partage dans les options système — injecté dynamiquement
document.addEventListener('DOMContentLoaded', () => {
    const optionsBtns = document.querySelector('.card.mt-12 .btn-danger')?.parentElement;
    if (optionsBtns) {
        const shareBtn = document.createElement('button');
        shareBtn.className   = 'btn btn-outline btn-full';
        shareBtn.innerHTML   = '<i class="fa-solid fa-user-plus"></i> Partager ce profil (co-maître)';
        shareBtn.onclick     = window.generateShareToken;
        shareBtn.style.color = 'var(--gold)';
        shareBtn.style.borderColor = 'var(--gold-border)';
        optionsBtns.insertBefore(shareBtn, optionsBtns.lastElementChild);
    }
});
// ==========================================
// INIT CHAMPS FICHE PUBLIQUE
// ==========================================
function initFicheFields() {
    // Pré-remplir depuis proData
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('fiche-kennel-name', proData.kennelName || '');
    setVal('fiche-dept',        proData.dept        || '');
    setVal('fiche-website',     proData.website     || '');
    setVal('fiche-phone',       proData.phone       || healthExtras?.vetPhone || '');
    setVal('fiche-description', proData.ficheDescription || '');

    // Restaurer la photo si elle existe
    if (proData.fichePhoto) {
        _fichePhotoDataUrl = proData.fichePhoto;
        const img  = document.getElementById('fiche-photo-img');
        const icon = document.getElementById('fiche-photo-icon');
        if (img)  { img.src = proData.fichePhoto; img.style.display = 'block'; }
        if (icon) icon.style.display = 'none';
    }

    // Afficher le lien si fiche déjà publiée
    if (auth.currentUser) {
        const ficheUrl = `${window.location.origin}/fiche/${auth.currentUser.uid}`;
        const wrap = document.getElementById('public-fiche-link-wrap');
        const urlInput = document.getElementById('public-fiche-url');
        // Vérifier en Firestore si la fiche existe
        getDoc(doc(db, 'fiches_publiques', auth.currentUser.uid)).then(snap => {
                if (snap.exists()) {
                    if (urlInput) urlInput.value = ficheUrl;
                    if (wrap) wrap.style.display = 'block';
                    const btn = document.getElementById('btn-generate-fiche');
                    if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Mettre à jour la fiche';
                    // Pré-remplir les champs depuis Firestore
                    const d = snap.data();
                    const setFV = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
                    setFV('fiche-kennel-name', d.kennelName);
                    setFV('fiche-description', d.description);
                    setFV('fiche-phone',       d.phone);
                    setFV('fiche-email',       d.email);
                    setFV('fiche-dept',        d.dept);
                    setFV('fiche-website',     d.website);
                    if (d.photo) {
                        _fichePhotoDataUrl = d.photo;
                        const img  = document.getElementById('fiche-photo-img');
                        const icon = document.getElementById('fiche-photo-icon');
                        if (img)  { img.src = d.photo; img.style.display = 'block'; }
                        if (icon) icon.style.display = 'none';
                    }
                }
        }).catch(() => {});
    }
}
