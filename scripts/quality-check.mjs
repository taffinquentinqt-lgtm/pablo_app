import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatHeyPabloMessage, normalizeHeyPabloText } from '../src/utils/heyPabloFormatting.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(relPath) {
    return readFileSync(path.join(root, relPath), 'utf8');
}

function readJson(relPath) {
    return JSON.parse(read(relPath));
}

function walk(dir, ignored = new Set(['.git', '.vercel', '.firebase', '.claude', 'dist', 'node_modules'])) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(fullPath, ignored));
        else out.push(fullPath);
    }
    return out;
}

function assertContains(haystack, needle, label) {
    assert.ok(haystack.includes(needle), `${label} doit contenir ${needle}`);
}

for (const relPath of ['package.json', 'vercel.json', 'manifest.json', 'firebase.json']) {
    readJson(relPath);
}

assert.ok(existsSync(path.join(root, 'docs/ARCHITECTURE.md')), 'La doc architecture doit exister.');

const formatted = formatHeyPabloMessage('Voici l essentiel : 1. **Creer un espace** - panier. 2. `Securiser` la maison ? <script>');
const plain = normalizeHeyPabloText('**A retenir** : `calme` ?');
assert.ok(!formatted.includes('**'), 'Hey Pablo ne doit pas afficher de Markdown gras brut.');
assert.ok(!formatted.includes('`'), 'Hey Pablo ne doit pas afficher de backticks bruts.');
assert.ok(formatted.includes('&lt;script&gt;'), 'Hey Pablo doit echapper le HTML.');
assert.ok(formatted.includes('<br><br>1.'), 'Hey Pablo doit aerer les listes numerotees.');
assert.equal(plain, 'A retenir : calme?');

const api = read('api/pablo-chat.js');
assertContains(api, 'verifyFirebaseUser', 'Le proxy IA');
assertContains(api, 'ALLOWED_ORIGINS', 'Le proxy IA');
assertContains(api, 'OPENAI_API_KEY', 'Le proxy IA');
assertContains(api, 'Cache-Control", "no-store"', 'Le proxy IA');
assert.ok(!api.includes('Access-Control-Allow-Origin", "*"'), 'Le proxy IA ne doit pas ouvrir CORS a tout le monde.');

const app = read('app.js');
const chatClient = read('src/services/pabloChatClient.mjs');
assertContains(app, 'formatHeyPabloMessage', 'app.js');
assertContains(app, 'callPabloChat', 'Service Hey Pablo');
assertContains(app, 'VITE_FIREBASE_APPCHECK_SITE_KEY', 'App Check');
assertContains(app, 'exportPabloData', 'Export utilisateur');
assertContains(app, 'clearLocalCacheFromSettings', 'Cache utilisateur');
assertContains(app, 'client_error', 'Monitoring client');
assertContains(app, 'client_promise_error', 'Monitoring client');
assertContains(app, 'copyChatMessage', 'Hey Pablo premium');
assertContains(app, 'saveChatMessage', 'Hey Pablo premium');
assertContains(app, 'rateChatMessage', 'Hey Pablo premium');
assertContains(app, 'askChatFollowUp', 'Hey Pablo premium');
assertContains(app, 'clearChatHistory', 'Hey Pablo premium');
assertContains(app, 'isChatSending', 'Hey Pablo anti double envoi');
assertContains(chatClient, 'getIdToken', 'Service Hey Pablo');
assertContains(chatClient, 'AbortController', 'Service Hey Pablo');
assertContains(chatClient, 'Authorization', 'Service Hey Pablo');
assert.ok(!app.includes('sk-proj-'), 'Aucune cle OpenAI ne doit etre dans app.js.');

const vercel = read('vercel.json');
assertContains(vercel, 'X-Content-Type-Options', 'Headers Vercel');
assertContains(vercel, 'Cross-Origin-Opener-Policy', 'Headers Vercel');
assertContains(vercel, 'same-origin-allow-popups', 'Headers Vercel');
const sitemap = read('public/sitemap.xml');
const llms = read('public/llms.txt');
const indexHtml = read('index.html');
assertContains(indexHtml, 'id="chat-send-btn"', 'Chat accessible');
assertContains(indexHtml, 'enterkeyhint="send"', 'Chat mobile');
assertContains(indexHtml, 'clearChatHistory()', 'Chat reset');
const seoPages = [
    'carnet-sante-chien-numerique',
    'rappel-vaccin-chien',
    'application-eleveur-canin',
    'ration-berger-allemand',
    'calendrier-vaccins-chiot',
    'suivi-poids-chiot',
    'alimentation-chiot-croissance'
];

for (const slug of seoPages) {
    const relPath = `public/blog/${slug}.html`;
    assert.ok(existsSync(path.join(root, relPath)), `${relPath} doit exister.`);
    const html = read(relPath);
    assertContains(html, '<meta name="description"', relPath);
    assertContains(html, '<link rel="canonical"', relPath);
    assertContains(html, 'application/ld+json', relPath);
    assertContains(vercel, `/blog/${slug}`, 'vercel.json');
    assertContains(sitemap, `https://www.pablocanin.fr/blog/${slug}`, 'sitemap.xml');
    assertContains(llms, `/blog/${slug}`, 'llms.txt');
}

for (const relPath of ['sw.js', 'public/sw.js']) {
    const sw = read(relPath);
    assertContains(sw, "url.pathname.startsWith('/api/')", relPath);
    assertContains(sw, 'CACHE_NAME', relPath);
}

const sourceFiles = walk(root)
    .filter(file => /\.(js|mjs|html|json|md|xml|txt|rules)$/i.test(file))
    .filter(file => !file.endsWith('.env') && !file.includes(`${path.sep}package-lock.json`));

for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    assert.ok(!/sk-proj-[A-Za-z0-9_-]{20,}/.test(content), `Cle OpenAI detectee dans ${path.relative(root, file)}`);
}

console.log('Pablo quality check OK');
