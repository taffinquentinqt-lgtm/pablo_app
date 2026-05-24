// --- IMPORTS FIREBASE & CLOUD FIRESTORE ---
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// ==========================================
// CONFIGURATION GLOBALE
// ==========================================
const GLOBAL_CONFIG_ID = "pablo_global_config";

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
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app); 

let petsList = [];
let currentPetId = null;
let petProfile = {};
let weightHistory = [];
let medicalEvents = [];
let dailyTrackers = {};
let chatHistory = [];
let budgetExpenses = [];
let educationData = {};
let concoursList = [];
let clubsDirectory = [];

let weightChartInstance = null;
let darkModeActive = false;
let isLoginMode = true;

const DEFAULT_EDU_EXERCISES = [
    { id: 'assis', name: "S'asseoir (Assis)", icon: 'fa-arrow-down' },
    { id: 'coucher', name: 'Se coucher (Couché)', icon: 'fa-bed' },
    { id: 'rappel', name: 'Le Rappel au pied', icon: 'fa-dog' },
    { id: 'pas-bouger', name: 'Pas bouger (Statique)', icon: 'fa-hand' },
    { id: 'proprete', name: 'La Propreté', icon: 'fa-droplet-slash' },
    { id: 'marche-laisse', name: 'Marche en laisse détendue', icon: 'fa-bezier-curve' },
    { id: 'solitude', name: 'Gestion de la solitude', icon: 'fa-house-chimney-user' }
];

onAuthStateChanged(auth, async (user) => {
    const authPage = document.getElementById('auth-page');
    const mainApp = document.getElementById('main-app-layout');
    const landing = document.getElementById('landing-page');
    
    if (user) {
        console.log("🟢 Connecté :", user.email);
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const cloudData = userDoc.data();
                Object.keys(cloudData).forEach(key => {
                    localStorage.setItem(key, JSON.stringify(cloudData[key]));
                });
            }
        } catch (e) {
            console.error(e);
        }
        if(landing) landing.style.display = 'none';
        if(authPage) authPage.style.display = 'none';
        initApp();
        if(mainApp) {
            mainApp.style.display = 'flex';
            setTimeout(() => { if (typeof renderWeightChart === 'function') renderWeightChart(); }, 150);
        }
    } else {
        if(mainApp) mainApp.style.display = 'none';
    }
});

window.enterApp = () => {
    const landing = document.getElementById('landing-page');
    const authPage = document.getElementById('auth-page');
    if (landing) landing.style.display = 'none';
    if (!auth.currentUser && authPage) authPage.style.display = 'flex';
};

window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-action-btn').innerText = isLoginMode ? "Se connecter" : "Créer mon compte";
};

window.processAuth = async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!email || !password) return alert("Champs vides.");
    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
        }
    } catch (error) {
        alert(error.message);
    }
};

window.processGoogleAuth = async () => {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
        alert(error.message);
    }
};

window.logoutApp = async () => {
    await signOut(auth);
    location.reload();
};

document.addEventListener('DOMContentLoaded', () => {
    initGlobalConfig();
    initApp();
    const chatInput = document.getElementById('chat-input-field');
    if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    if (document.getElementById('weight-date')) document.getElementById('weight-date').value = new Date().toISOString().split('T')[0];
    if (document.getElementById('pet-selector')) document.getElementById('pet-selector').addEventListener('change', (e) => switchPet(e.target.value));
    if (document.getElementById('mobile-pet-selector')) document.getElementById('mobile-pet-selector').addEventListener('change', (e) => switchPet(e.target.value));

    const heatEl = document.getElementById('profile-last-heat');
    if (heatEl) heatEl.addEventListener('change', calculateNextHeat);
    const matingEl = document.getElementById('profile-mating-date');
    if (matingEl) matingEl.addEventListener('change', calculateGestation);
});

function initGlobalConfig() {
    const config = localStorage.getItem(GLOBAL_CONFIG_ID);
    if (config) darkModeActive = JSON.parse(config).darkMode || false;
    applyTheme();
}

function applyTheme() {
    const elements = [document.querySelector('.app-container'), document.getElementById('main-app-layout'), document.body];
    elements.forEach(el => {
        if (el) darkModeActive ? el.classList.add('dark-mode') : el.classList.remove('dark-mode');
    });
    if (typeof renderWeightChart === 'function') renderWeightChart();
}

function toggleDarkMode() {
    darkModeActive = !darkModeActive;
    localStorage.setItem(GLOBAL_CONFIG_ID, JSON.stringify({ darkMode: darkModeActive }));
    applyTheme();
}

async function saveLocalData(petId, key, data) {
    localStorage.setItem(`${key}_${petId}`, JSON.stringify(data));
    if (auth.currentUser) {
        try {
            await setDoc(doc(db, "users", auth.currentUser.uid), { [`${key}_${petId}`]: data }, { merge: true });
        } catch (e) {
            console.error(e);
        }
    }
}

function getLocalData(petId, key, defaultValue) {
    const data = localStorage.getItem(`${key}_${petId}`);
    return data ? JSON.parse(data) : defaultValue;
}

function initApp() {
    const savedPets = localStorage.getItem('app_pets_list');
    petsList = savedPets ? JSON.parse(savedPets) : [];

    if (petsList.length === 0) {
        const defaultId = 'pet_' + Date.now();
        petsList.push({ id: defaultId, name: 'Pablo' });
        localStorage.setItem('app_pets_list', JSON.stringify(petsList));
        
        petProfile = { name: "Pablo", species: "Chien", breed: "Berger Allemand", age: 14, size: 65, weight: 31.5, sex: "M", avatar: "", breedAdvice: "" };
        saveLocalData(defaultId, 'profile', petProfile);
        saveLocalData(defaultId, 'weight', [{ date: new Date().toISOString().split('T')[0], weight: 31.5 }]);
        saveLocalData(defaultId, 'education', {});
        currentPetId = defaultId;
        localStorage.setItem('current_pet_id', currentPetId);
    } else {
        currentPetId = localStorage.getItem('current_pet_id') || petsList[0].id;
    }
    renderPetSelector();
    loadCurrentPetData();
}

function renderPetSelector() {
    const s = document.getElementById('pet-selector');
    const ms = document.getElementById('mobile-pet-selector');
    if(s) s.innerHTML = ''; if(ms) ms.innerHTML = '';
    petsList.forEach(pet => {
        const o = document.createElement('option'); o.value = pet.id; o.textContent = pet.name;
        if(pet.id === currentPetId) o.selected = true;
        if(s) s.appendChild(o); if(ms) ms.appendChild(o.cloneNode(true));
    });
}

function switchPet(petId) {
    currentPetId = petId;
    localStorage.setItem('current_pet_id', currentPetId);
    loadCurrentPetData();
    navigateTo('screen-home');
}

function createNewPet() {
    const modal = document.getElementById('add-pet-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('new-pet-name-input').value = '';
        document.getElementById('new-pet-name-input').focus();
    }
}

function closePetModal() {
    if (document.getElementById('add-pet-modal')) document.getElementById('add-pet-modal').style.display = 'none';
}

function confirmCreateNewPet() {
    const name = document.getElementById('new-pet-name-input').value.trim();
    if (!name) return alert("Le nom est vide.");
    
    const newId = 'pet_' + Date.now();
    petsList.push({ id: newId, name: name });
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    
    const newProfile = { name, species: "Chien", breed: "", age: 0, size: 0, weight: 0, sex: "M", avatar: "", breedAdvice: "" };
    saveLocalData(newId, 'profile', newProfile);
    saveLocalData(newId, 'weight', []);
    saveLocalData(newId, 'medical', []);
    saveLocalData(newId, 'education', {});
    saveLocalData(newId, 'custom_exercises', []);
    saveLocalData(newId, 'daily', {water: 0, walk: 0, date: new Date().toISOString().split('T')[0]});
    saveLocalData(newId, 'chat', [{sender: 'bot', text: `Bonjour !`}]);
    saveLocalData(newId, 'budget', []);

    closePetModal();
    switchPet(newId);
}

function loadCurrentPetData() {
    initPetProfile();
    initWeightHistory();
    initMedicalRecords();
    initEducation();
    initDailyTrackers();
    initChat();
    initBudgetTracker();
    initConcoursAndClubs();
}

function deleteCurrentPet() {
    if (!confirm("Supprimer ce compagnon ?")) return;
    const keys = ['profile', 'weight', 'medical', 'education', 'custom_exercises', 'daily', 'chat', 'budget', 'concours', 'clubs'];
    keys.forEach(key => localStorage.removeItem(`${key}_${currentPetId}`));
    petsList = petsList.filter(pet => pet.id !== currentPetId);
    localStorage.setItem('app_pets_list', JSON.stringify(petsList));
    if(petsList.length === 0) { currentPetId = null; initApp(); } else { switchPet(petsList[0].id); }
}

// ==========================================
// REPRODUCTION, CALS AUTOMATIQUES ET TRAQUEUR D'ÂGE
// ==========================================
function initPetProfile() {
    petProfile = getLocalData(currentPetId, 'profile', {});
    
    if (document.getElementById('header-pet-name')) document.getElementById('header-pet-name').innerHTML = `${petProfile.name || 'PABLO'}<span>.</span>`;
    if (document.getElementById('header-pet-breed')) document.getElementById('header-pet-breed').innerText = petProfile.breed || "Race non définie";
    if (document.getElementById('welcome-pet-name')) document.getElementById('welcome-pet-name').innerText = petProfile.name || "";
    if (document.getElementById('current-pet-display-top')) document.getElementById('current-pet-display-top').innerText = petProfile.name || "";

    if (petProfile.avatar && document.getElementById('profile-pet-image')) {
        document.getElementById('profile-pet-image').src = petProfile.avatar;
        document.getElementById('profile-pet-image').style.display = 'block';
        if (document.getElementById('profile-avatar-placeholder')) document.getElementById('profile-avatar-placeholder').style.display = 'none';
    }

    if(document.getElementById('profile-name')) document.getElementById('profile-name').value = petProfile.name || "";
    if(document.getElementById('profile-species')) document.getElementById('profile-species').value = petProfile.species || "Chien";
    if(document.getElementById('profile-breed')) document.getElementById('profile-breed').value = petProfile.breed || "";
    if(document.getElementById('profile-age')) document.getElementById('profile-age').value = petProfile.age || 0;
    if(document.getElementById('profile-size')) document.getElementById('profile-size').value = petProfile.size || 0;
    if(document.getElementById('profile-weight')) document.getElementById('profile-weight').value = petProfile.weight || 0;
    if(document.getElementById('profile-sex')) document.getElementById('profile-sex').value = petProfile.sex || "M";

    if(document.getElementById('profile-chip')) document.getElementById('profile-chip').value = petProfile.chip || "";
    if(document.getElementById('profile-lof')) document.getElementById('profile-lof').value = petProfile.lof || "";
    if(document.getElementById('profile-last-heat')) document.getElementById('profile-last-heat').value = petProfile.lastHeat || "";
    if(document.getElementById('profile-mating-date')) document.getElementById('profile-mating-date').value = petProfile.matingDate || "";
    if(document.getElementById('profile-birth-estimated')) document.getElementById('profile-birth-estimated').value = petProfile.birthEstimated || "";
    if(document.getElementById('profile-litter-birth-date')) document.getElementById('profile-litter-birth-date').value = petProfile.litterBirthDate || "";
    if(document.getElementById('profile-litter-size')) document.getElementById('profile-litter-size').value = petProfile.litterSize || 0;
    
    if(document.getElementById('profile-dna')) document.getElementById('profile-dna').value = petProfile.dnaTest || "";
    if(document.getElementById('profile-hips')) document.getElementById('profile-hips').value = petProfile.hipsRadio || "";
    if(document.getElementById('profile-elbows')) document.getElementById('profile-elbows').value = petProfile.elbowsRadio || "";
    if(document.getElementById('profile-confirmation-date')) document.getElementById('profile-confirmation-date').value = petProfile.confirmationDate || "";
    if(document.getElementById('profile-csau-date')) document.getElementById('profile-csau-date').value = petProfile.csauDate || "";
    if(document.getElementById('profile-cotation')) document.getElementById('profile-cotation').value = petProfile.cotation || "1";
    
    if(document.getElementById('profile-club-name')) document.getElementById('profile-club-name').value = petProfile.clubName || "";
    if(document.getElementById('profile-club-entry')) document.getElementById('profile-club-entry').value = petProfile.clubEntry || "";

    const ped = petProfile.pedigree || {};
    if(document.getElementById('pedigree-father')) document.getElementById('pedigree-father').value = ped.father || "";
    if(document.getElementById('pedigree-mother')) document.getElementById('pedigree-mother').value = ped.mother || "";
    if(document.getElementById('pedigree-gfather-p')) document.getElementById('pedigree-gfather-p').value = ped.gFatherP || "";
    if(document.getElementById('pedigree-gmother-p')) document.getElementById('pedigree-gmother-p').value = ped.gMotherP || "";
    if(document.getElementById('pedigree-gfather-m')) document.getElementById('pedigree-gfather-m').value = ped.gFatherM || "";
    if(document.getElementById('pedigree-gmother-m')) document.getElementById('pedigree-gmother-m').value = ped.gMotherM || "";

    // Affichage dynamique du suivi des chaleurs si femelle
    const femaleSection = document.getElementById('repro-female-only');
    if(femaleSection) femaleSection.style.display = (petProfile.sex === "F") ? "block" : "none";

    calculateNextHeat();
    calculateGestation();
    updateLitterAgeTracker();

    const mobileEduBtn = document.querySelector('.mobile-nav .nav-item[onclick*="screen-edu"]');
    const sidebarEduBtn = document.getElementById('sidebar-nav-edu');
    if (petProfile.species === "Chien") {
        if (mobileEduBtn) mobileEduBtn.style.display = 'flex';
        if (sidebarEduBtn) sidebarEduBtn.style.display = 'flex';
    } else {
        if (mobileEduBtn) mobileEduBtn.style.display = 'none';
        if (sidebarEduBtn) sidebarEduBtn.style.display = 'none';
    }
    updateBreedAdviceUI();
}

function calculateNextHeat() {
    const elInput = document.getElementById('profile-last-heat');
    const elNextHeat = document.getElementById('next-heat-estimate');
    const elSaillie = document.getElementById('calc-saillie');
    
    if (!elInput || !elInput.value) return;
    const d = new Date(elInput.value);
    
    // Prochaines chaleurs (+6 mois)
    const nextHeat = new Date(d.getTime());
    nextHeat.setDate(nextHeat.getDate() + 180);
    if(elNextHeat) elNextHeat.innerText = nextHeat.toLocaleDateString('fr-FR');

    // Zone optimale de saillie (J11 à J13)
    const saillieStart = new Date(d.getTime()); saillieStart.setDate(saillieStart.getDate() + 11);
    const saillieEnd = new Date(d.getTime()); saillieEnd.setDate(saillieEnd.getDate() + 13);
    if(elSaillie) elSaillie.innerText = `Du ${saillieStart.toLocaleDateString('fr-FR')} au ${saillieEnd.toLocaleDateString('fr-FR')}`;
}

function calculateGestation() {
    const elInput = document.getElementById('profile-mating-date');
    const elTarget = document.getElementById('profile-birth-estimated');
    if (!elInput || !elInput.value || !elTarget) return;
    const d = new Date(elInput.value);
    d.setDate(d.getDate() + 63); 
    elTarget.value = d.toISOString().split('T')[0];
}

// L'OPTION COOL : COMPTEUR D'ÂGE PRÉCIS POUR LES CHIOTS (Jours, Semaines, Mois)
function updateLitterAgeTracker() {
    const birthInput = document.getElementById('profile-litter-birth-date');
    const displayBox = document.getElementById('litter-age-counter-box');
    const textDisplay = document.getElementById('litter-exact-age-display');
    const alertDisplay = document.getElementById('litter-milestone-alert');

    if (!birthInput || !birthInput.value || !displayBox) return;

    const birthDate = new Date(birthInput.value);
    const now = new Date();
    const diffTime = now - birthDate;

    if (diffTime < 0) {
        displayBox.style.display = 'none';
        return;
    }

    displayBox.style.display = 'block';

    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30.43); // Moyenne jours/mois

    textDisplay.innerHTML = `🍼 Âge de la portée : <br><span style="font-size:24px; color:var(--accent)">${diffDays} Jours</span> | <span>${diffWeeks} Semaines</span> | <span>${diffMonths} Mois</span>`;

    // Alertes réglementaires automatiques selon l'âge
    if (diffDays <= 5) {
        alertDisplay.innerText = "🚨 Alerte Élevage : Suivi quotidien rigoureux du poids requis (J0-J5).";
    } else if (diffWeeks >= 6 && diffWeeks < 8) {
        alertDisplay.innerText = "💉 Rappel : Fenêtre idéale pour le premier vaccin de sevrage et l'identification puce.";
    } else if (diffWeeks >= 8) {
        alertDisplay.innerText = "🏡 Information : Les chiots ont atteint l'âge légal pour rejoindre leurs nouvelles familles.";
    } else {
        alertDisplay.innerText = "✨ Lignée en pleine croissance.";
    }
}

function savePetProfile() {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) return alert("Le nom est obligatoire.");
    
    petProfile.name = name;
    petProfile.species = document.getElementById('profile-species').value;
    petProfile.breed = document.getElementById('profile-breed').value.trim();
    petProfile.age = parseInt(document.getElementById('profile-age').value) || 0;
    petProfile.size = parseInt(document.getElementById('profile-size').value) || 0;
    petProfile.weight = parseFloat(document.getElementById('profile-weight').value) || 0;
    petProfile.sex = document.getElementById('profile-sex').value;

    petProfile.chip = document.getElementById('profile-chip').value.trim();
    petProfile.lof = document.getElementById('profile-lof').value.trim();
    petProfile.lastHeat = document.getElementById('profile-last-heat').value;
    petProfile.matingDate = document.getElementById('profile-mating-date').value;
    petProfile.birthEstimated = document.getElementById('profile-birth-estimated').value;
    petProfile.litterBirthDate = document.getElementById('profile-litter-birth-date').value;
    petProfile.litterSize = parseInt(document.getElementById('profile-litter-size').value) || 0;
    
    petProfile.dnaTest = document.getElementById('profile-dna').value.trim();
    petProfile.hipsRadio = document.getElementById('profile-hips').value.trim();
    petProfile.elbowsRadio = document.getElementById('profile-elbows').value.trim();
    petProfile.confirmationDate = document.getElementById('profile-confirmation-date').value;
    petProfile.csauDate = document.getElementById('profile-csau-date').value;
    petProfile.cotation = document.getElementById('profile-cotation').value;
    
    petProfile.clubName = document.getElementById('profile-club-name').value.trim();
    petProfile.clubEntry = document.getElementById('profile-club-entry').value;

    petProfile.pedigree = {
        father: document.getElementById('pedigree-father').value.trim(),
        mother: document.getElementById('pedigree-mother').value.trim(),
        gFatherP: document.getElementById('pedigree-gfather-p').value.trim(),
        gMotherP: document.getElementById('pedigree-gmother-p').value.trim(),
        gFatherM: document.getElementById('pedigree-gfather-m').value.trim(),
        gMotherM: document.getElementById('pedigree-gmother-m').value.trim()
    };

    saveLocalData(currentPetId, 'profile', petProfile);
    loadCurrentPetData();
    alert("Profil mis à jour ! 🐾");
    navigateTo('screen-home');
}

// ==========================================
// MODULE COMPLET : CONCOURS & CLUBS (L'OPTION COOL)
// ==========================================
function initConcoursAndClubs() {
    concoursList = getLocalData(currentPetId, 'concours', []);
    clubsDirectory = getLocalData(currentPetId, 'clubs', []);
    renderConcoursAgenda();
    renderClubsDirectory();
}

window.addConcoursEvent = function() {
    const title = document.getElementById('concours-title').value.trim();
    const date = document.getElementById('concours-event-date').value;
    const club = document.getElementById('concours-club').value.trim();

    if(!title || !date) return alert("Veuillez renseigner un titre et une date pour le concours.");

    concoursList.push({ id: Date.now(), title, date, club });
    saveLocalData(currentPetId, 'concours', concoursList);
    
    document.getElementById('concours-title').value = '';
    document.getElementById('concours-event-date').value = '';
    document.getElementById('concours-club').value = '';
    renderConcoursAgenda();
};

function renderConcoursAgenda() {
    const container = document.getElementById('concours-agenda-list');
    if(!container) return; container.innerHTML = '';

    if(concoursList.length === 0) {
        container.innerHTML = "<p style='color:#777; font-size:13px; text-align:center;'>Aucun concours prévu au calendrier.</p>";
        return;
    }

    // Tri des concours par date la plus proche
    concoursList.sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(c => {
        const cDate = new Date(c.date);
        const now = new Date();
        now.setHours(0,0,0,0);
        const diffTime = cDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const item = document.createElement('div');
        item.className = "list-item-custom";
        
        let countdownBadge = "";
        if(diffDays < 0) {
            countdownBadge = "<span class='alert-badge' style='background:#ddd; color:#666;'>Terminé</span>";
        } else if(diffDays === 0) {
            countdownBadge = "<span class='alert-badge danger'>AUJOURD'HUI 🏆</span>";
        } else {
            countdownBadge = `<span class='alert-badge success'>J - ${diffDays} jours</span>`;
        }

        item.innerHTML = `
            <div>
                <strong>${c.title}</strong><br>
                <span style='font-size:12px; color:var(--text-muted);'><i class="fa-solid fa-building-columns"></i> Organisé par : ${c.club || 'Inconnu'}</span><br>
                <span style='font-size:12px; color:var(--accent);'><i class="fa-solid fa-calendar-days"></i> ${cDate.toLocaleDateString('fr-FR')}</span>
            </div>
            <div>${countdownBadge}</div>
        `;
        container.appendChild(item);
    });
}

window.addClubToDirectory = function() {
    const name = document.getElementById('club-directory-name').value.trim();
    const contact = document.getElementById('club-directory-contact').value.trim();

    if(!name) return alert("Le nom du club est requis.");

    clubsDirectory.push({ id: Date.now(), name, contact });
    saveLocalData(currentPetId, 'clubs', clubsDirectory);

    document.getElementById('club-directory-name').value = '';
    document.getElementById('club-directory-contact').value = '';
    renderClubsDirectory();
};

function renderClubsDirectory() {
    const container = document.getElementById('clubs-directory-list');
    if(!container) return; container.innerHTML = '';

    if(clubsDirectory.length === 0) {
        container.innerHTML = "<p style='color:#777; font-size:13px; text-align:center;'>Aucun club enregistré dans l'annuaire.</p>";
        return;
    }

    clubsDirectory.forEach(club => {
        const item = document.createElement('div');
        item.className = "list-item-custom";
        item.innerHTML = `
            <div>
                <strong>${club.name}</strong><br>
                <span style='font-size:12px; color:var(--text-muted);'>📍 Contact/Infos : ${club.contact || 'Aucune information saisie'}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

// ==========================================
// AUTRES COMPOSANTS (RECONSTRUITS À L'IDENTIQUE)
// ==========================================
async function updateBreedAdviceUI() {
    const adviceCard = document.getElementById('breed-advice-card');
    const adviceContent = document.getElementById('breed-advice-content');
    if (!adviceCard || !adviceContent || !petProfile.breed) return;

    adviceCard.style.display = 'block';
    if(petProfile.breedAdvice) { adviceContent.innerHTML = petProfile.breedAdvice; return; }

    adviceContent.innerHTML = "Génération de l'encyclopédie...";
    try {
        const response = await fetch("/api/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: "Tu es un éleveur canin expert. Rédige une fiche synthétique en HTML.",
                messages: [{ content: `Donne des conseils pour la race ${petProfile.breed}. Rédige uniquement en HTML simple.` }]
            })
        });
        const data = await response.json();
        petProfile.breedAdvice = data.choices[0].message.content.trim();
        saveLocalData(currentPetId, 'profile', petProfile);
        adviceContent.innerHTML = petProfile.breedAdvice;
    } catch (error) { adviceContent.innerText = "Fiche non disponible."; }
}

function initWeightHistory() {
    weightHistory = getLocalData(currentPetId, 'weight', []);
    updateWeightUI();
}

function updateWeightUI() {
    if(weightHistory.length === 0) return;
    weightHistory.sort((a,b) => new Date(a.date) - new Date(b.date));
    const latest = weightHistory[weightHistory.length - 1].weight;
    if (document.getElementById('nutrition-weight-text')) document.getElementById('nutrition-weight-text').innerText = latest + " kg";
    updateNutritionUI();
}

async function updateNutritionUI() {
    const textEl = document.getElementById('nutrition-ration-text');
    if (!textEl || !petProfile.weight) return;
    try {
        const response = await fetch("/api/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: "Réponds uniquement par un chiffre suivi de 'g'.",
                messages: [{ content: `Ration de croquettes pour un ${petProfile.species} de ${petProfile.weight} kg.` }]
            })
        });
        const data = await response.json();
        textEl.innerText = data.choices[0].message.content.trim();
    } catch (e) { textEl.innerText = "-- g"; }
}

function addNewWeight() {
    const w = parseFloat(document.getElementById('weight-input').value);
    const d = document.getElementById('weight-date').value;
    if(!w || !d) return;
    weightHistory.push({ date: d, weight: w });
    saveLocalData(currentPetId, 'weight', weightHistory);
    updateWeightUI();
    renderWeightChart();
}

function renderWeightChart() {
    const canvas = document.getElementById('weightChart');
    if(!canvas || weightHistory.length === 0) return;
    if (weightChartInstance) weightChartInstance.destroy();
    weightChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: weightHistory.map(h => h.date),
            datasets: [{ data: weightHistory.map(h => h.weight), borderColor: '#2C2520', fill: false }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function initDailyTrackers() {
    const today = new Date().toISOString().split('T')[0];
    dailyTrackers = getLocalData(currentPetId, 'daily', { water: 0, walk: 0, date: today });
    if (dailyTrackers.date !== today) dailyTrackers = { water: 0, walk: 0, date: today };
    updateTrackersUI();
}

function updateTrackersUI() {
    if(document.getElementById('water-current-text')) document.getElementById('water-current-text').innerText = `${dailyTrackers.water} ml`;
    if(document.getElementById('walk-current-text')) document.getElementById('walk-current-text').innerText = `${dailyTrackers.walk} min`;
}

window.addWater = () => { dailyTrackers.water += 250; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); };
window.addWalk = () => { dailyTrackers.walk += 15; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); };
window.resetDailyTrackers = () => { dailyTrackers.water = 0; dailyTrackers.walk = 0; saveLocalData(currentPetId, 'daily', dailyTrackers); updateTrackersUI(); };

function initMedicalRecords() {
    medicalEvents = getLocalData(currentPetId, 'medical', []);
    renderMedicalHistory();
    renderReminders();
}

window.addMedicalEvent = function() {
    const type = document.getElementById('event-type').value;
    const date = document.getElementById('event-date').value;
    if (!date) return;
    medicalEvents.push({ type, date });
    saveLocalData(currentPetId, 'medical', medicalEvents);
    renderMedicalHistory();
    renderReminders();
};

function renderMedicalHistory() {
    const list = document.getElementById('medical-history-list');
    if(!list) return; list.innerHTML = '';
    medicalEvents.forEach(ev => {
        const item = document.createElement('div'); item.className = 'health-log-item';
        item.innerHTML = `<span>${ev.type}</span><strong>${ev.date}</strong>`;
        list.appendChild(item);
    });
}

function renderReminders() {
    const container = document.getElementById('dynamic-reminders-list');
    if(!container) return; container.innerHTML = '';
    const rules = { 'Vaccin': 365, 'Vermifuge': 90, 'Anti-puces': 30 };
    Object.keys(rules).forEach(type => {
        const eventsOfType = medicalEvents.filter(e => e.type === type);
        let lastDate = eventsOfType.length > 0 ? new Date(eventsOfType.sort((a,b) => new Date(b.date) - new Date(a.date))[0].date) : null;
        let daysPass = lastDate ? Math.ceil(Math.abs(new Date() - lastDate) / 86400000) : 999;
        if (!lastDate || daysPass > rules[type]) {
            const reminderDiv = document.createElement('div'); reminderDiv.className = 'reminder-item main-card';
            reminderDiv.innerHTML = `<div class="reminder-info"><h4>${type} requis</h4></div><span class="alert-badge danger">À FAIRE</span>`;
            container.appendChild(reminderDiv);
        }
    });
}

function initEducation() {
    educationData = getLocalData(currentPetId, 'education', {});
    renderEducation();
}

function renderEducation() {
    const container = document.getElementById('edu-container');
    if (!container) return; container.innerHTML = '';
    const custom = getLocalData(currentPetId, 'custom_exercises', []);
    [...DEFAULT_EDU_EXERCISES, ...custom].forEach(ex => {
        const lvl = educationData[ex.id] || 0;
        const card = document.createElement('div'); card.className = 'health-log-item';
        card.innerHTML = `<span>${ex.name}</span>
            <select onchange="updateEduLevel('${ex.id}', this.value)">
                <option value="0" ${lvl===0?'selected':''}>À commencer</option>
                <option value="1" ${lvl===1?'selected':''}>En cours</option>
                <option value="2" ${lvl===2?'selected':''}>Acquis</option>
            </select>`;
        container.appendChild(card);
    });
}

window.updateEduLevel = async function(id, val) {
    educationData[id] = parseInt(val);
    await saveLocalData(currentPetId, 'education', educationData);
};

window.addCustomExercise = async function() {
    const input = document.getElementById('new-custom-exercise-input');
    if (!input || !input.value.trim()) return;
    const custom = getLocalData(currentPetId, 'custom_exercises', []);
    custom.push({ id: 'c_' + Date.now(), name: input.value.trim() });
    await saveLocalData(currentPetId, 'custom_exercises', custom);
    input.value = ''; renderEducation();
};

function initBudgetTracker() {
    budgetExpenses = getLocalData(currentPetId, 'budget', []);
    updateBudgetUI();
}

function updateBudgetUI() {
    const total = budgetExpenses.reduce((sum, e) => sum + e.amount, 0);
    if(document.getElementById('budget-screen-total')) document.getElementById('budget-screen-total').innerText = total.toFixed(2) + " €";
    if(document.getElementById('home-budget-total')) document.getElementById('home-budget-total').innerText = total.toFixed(2) + " €";
    renderBudgetHistory(budgetExpenses);
}

function renderBudgetHistory(expenses) {
    const list = document.getElementById('budget-history-list');
    if (!list) return; list.innerHTML = '';
    [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(expense => {
        const item = document.createElement('div'); item.className = 'budget-item';
        item.innerHTML = `<span>${expense.title}</span><div><strong>${expense.amount.toFixed(2)} €</strong></div>`;
        list.appendChild(item);
    });
}

window.addBudgetExpense = function() {
    const title = document.getElementById('budget-title').value;
    const amount = parseFloat(document.getElementById('budget-amount').value);
    if(!title || !amount) return;
    budgetExpenses.push({ title, amount, date: new Date().toISOString() });
    saveLocalData(currentPetId, 'budget', budgetExpenses);
    updateBudgetUI();
};

function initChat() {
    chatHistory = getLocalData(currentPetId, 'chat', [{ sender: 'bot', text: "Bonjour !" }]);
    renderChat();
}

function renderChat() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return; container.innerHTML = '';
    chatHistory.forEach(m => {
        const d = document.createElement('div'); d.className = m.sender === 'bot' ? 'msg msg-bot' : 'msg msg-user';
        d.innerHTML = `<div class="msg-content">${m.text}</div>`; container.appendChild(d);
    });
    container.scrollTop = container.scrollHeight;
}

window.askPreset = (q) => { document.getElementById('chat-input-field').value = q; window.sendMessage(); };

window.sendMessage = async () => {
    const input = document.getElementById('chat-input-field');
    const text = input.value.trim();
    if (!text) return;
    chatHistory.push({ sender: 'user', text }); input.value = ''; renderChat();

    try {
        const response = await fetch("/api/mammouth-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: `Tu es Pablo, un assistant d'élevage expert. Tu accompagnes l'animal : ${petProfile.name}, Race: ${petProfile.breed}, Sexe: ${petProfile.sex}.`,
                messages: [{ content: text }]
            })
        });
        const data = await response.json();
        chatHistory.push({ sender: 'bot', text: data.choices[0].message.content });
        renderChat();
        saveLocalData(currentPetId, 'chat', chatHistory);
    } catch (e) {
        chatHistory.push({ sender: 'bot', text: "Erreur de réseau." }); renderChat();
    }
};

function uploadPetPhoto() {
    const file = document.getElementById('file-upload-input').files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            petProfile.avatar = reader.result;
            saveLocalData(currentPetId, 'profile', petProfile);
            initPetProfile();
        };
        reader.readAsDataURL(file);
    }
}

window.navigateTo = (screenId) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if(document.getElementById(screenId)) document.getElementById(screenId).classList.add('active');
};

window.switchPet = switchPet;
window.createNewPet = createNewPet;
window.confirmCreateNewPet = confirmCreateNewPet;
window.closePetModal = closePetModal;
window.toggleDarkMode = toggleDarkMode;
window.updateNutritionUI = updateNutritionUI;
window.addNewWeight = addNewWeight;
window.uploadPetPhoto = uploadPetPhoto;
window.savePetProfile = savePetProfile;
window.deleteCurrentPet = deleteCurrentPet;