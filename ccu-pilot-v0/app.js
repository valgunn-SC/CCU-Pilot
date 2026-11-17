import {
  APP_VERSION, uid, normalizeName, slugCandidates, money, vatBreakdown,
  catalogEntryFromApi, findCatalogEntry, fleetValue, reservedIds,
  generateOwnedPath, chainMetrics, createEmptyState, sanitizeState
} from './core.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const cfg = window.CCU_PILOT_FIREBASE || {};
const CATALOG_API = 'https://api.star-citizen.wiki/api/shipmatrix/vehicles';
const LEGACY_KEYS = ['ccuPilotState', 'ccu-pilot-state', 'ccuPilotData', 'ccu-pilot-data'];

let state = createEmptyState();
let currentUser = null;
let auth = null;
let db = null;
let firebase = null;
let remoteRef = null;
let remoteUnsubscribe = null;
let saveTimer = null;
let toastTimer = null;
let syncInFlight = false;

function configured() {
  const fc = cfg.firebaseConfig || {};
  return Boolean(fc.apiKey && fc.projectId && fc.authDomain && cfg.ownerEmail?.includes('@') && !String(fc.apiKey).includes('REMPLACER') && !String(cfg.ownerEmail).includes('REMPLACER'));
}

function showOnly(id) {
  ['setup-screen', 'login-screen', 'app-shell'].forEach((item) => $(`#${item}`).classList.toggle('hidden', item !== id));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatDate(value, withTime = true) {
  if (!value) return 'Jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'toast', 3300);
}

function setSyncStatus(mode, label) {
  const el = $('#sync-indicator');
  el.className = `sync-indicator ${mode || ''}`;
  $('span', el).textContent = label;
}

function localKey() {
  return currentUser ? `ccuPilotStateV2:${currentUser.uid}` : null;
}

function loadLocal() {
  const key = localKey();
  if (!key) return createEmptyState();
  try {
    const current = localStorage.getItem(key);
    if (current) return sanitizeState(JSON.parse(current));
    for (const legacyKey of LEGACY_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) {
        const migrated = sanitizeState(JSON.parse(legacy));
        localStorage.setItem(key, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch (error) {
    console.warn('Sauvegarde locale illisible', error);
  }
  return createEmptyState();
}

function persistLocal() {
  const key = localKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(state));
}

function mutate(callback, { render = true, remote = true } = {}) {
  callback(state);
  state.appVersion = APP_VERSION;
  state.updatedAt = new Date().toISOString();
  persistLocal();
  if (render) renderAll();
  if (remote) scheduleRemoteSave();
}

function scheduleRemoteSave(immediate = false) {
  if (!remoteRef || !firebase) return;
  clearTimeout(saveTimer);
  setSyncStatus('', 'À synchroniser');
  saveTimer = setTimeout(syncRemote, immediate ? 0 : 800);
}

async function syncRemote() {
  if (!remoteRef || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus('', 'Synchronisation…');
  try {
    await firebase.setDoc(remoteRef, {
      state,
      ownerEmail: currentUser.email,
      updatedAt: firebase.serverTimestamp()
    });
    $('#last-sync').textContent = formatDate(new Date().toISOString());
    setSyncStatus('synced', 'Synchronisé');
  } catch (error) {
    console.error(error);
    setSyncStatus('error', 'Erreur de synchro');
    toast('Synchronisation impossible. La copie locale est conservée.', 'error');
  } finally {
    syncInFlight = false;
  }
}

async function initFirebase() {
  if (!configured()) {
    showOnly('setup-screen');
    return;
  }
  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
    ]);
    const app = appModule.initializeApp(cfg.firebaseConfig);
    auth = authModule.getAuth(app);
    db = firestoreModule.getFirestore(app);
    firebase = { ...authModule, ...firestoreModule };
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);
    try { await firestoreModule.enableMultiTabIndexedDbPersistence(db); } catch (error) { console.info('Cache Firestore déjà actif ou indisponible', error.code); }
    try { await authModule.getRedirectResult(auth); } catch (error) { $('#login-error').textContent = readableAuthError(error); }
    authModule.onAuthStateChanged(auth, handleAuthState);
  } catch (error) {
    console.error(error);
    showOnly('login-screen');
    $('#login-error').textContent = 'Firebase ne peut pas être chargé. Vérifie le réseau et la configuration.';
  }
}

function readableAuthError(error) {
  const code = error?.code || '';
  if (code.includes('popup-blocked')) return 'La fenêtre Google a été bloquée. Autorise les pop-ups puis réessaie.';
  if (code.includes('unauthorized-domain')) return 'Ce domaine GitHub Pages n’est pas autorisé dans Firebase Authentication.';
  if (code.includes('popup-closed')) return 'Connexion annulée.';
  return `Connexion impossible${code ? ` (${code})` : ''}.`;
}

async function login() {
  $('#login-error').textContent = '';
  const provider = new firebase.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await firebase.signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === 'auth/popup-blocked') {
      await firebase.signInWithRedirect(auth, provider);
      return;
    }
    $('#login-error').textContent = readableAuthError(error);
  }
}

async function handleAuthState(user) {
  if (!user) {
    currentUser = null;
    showOnly('login-screen');
    return;
  }
  if (normalizeName(user.email) !== normalizeName(cfg.ownerEmail)) {
    const attempted = user.email;
    await firebase.signOut(auth);
    showOnly('login-screen');
    $('#login-error').textContent = `Accès refusé pour ${attempted}. Seul le compte propriétaire est autorisé.`;
    return;
  }
  currentUser = user;
  state = loadLocal();
  remoteRef = firebase.doc(db, 'users', user.uid, 'app', 'state');
  $('#account-name').textContent = user.displayName || user.email;
  $('#account-avatar').src = user.photoURL || './icon.svg';
  $('#owner-email').textContent = cfg.ownerEmail;
  showOnly('app-shell');
  renderAll();
  watchRemote();
  maybeAutoRefresh();
}

function watchRemote() {
  remoteUnsubscribe?.();
  remoteUnsubscribe = firebase.onSnapshot(remoteRef, async (snapshot) => {
    if (!snapshot.exists()) {
      scheduleRemoteSave(true);
      return;
    }
    const remote = sanitizeState(snapshot.data().state);
    const remoteTime = new Date(remote.updatedAt || 0).getTime();
    const localTime = new Date(state.updatedAt || 0).getTime();
    if (remoteTime > localTime + 500) {
      state = remote;
      persistLocal();
      renderAll();
      toast('Données synchronisées depuis ton autre appareil.');
    }
    const serverDate = snapshot.data().updatedAt?.toDate?.();
    if (serverDate) $('#last-sync').textContent = formatDate(serverDate);
    setSyncStatus('synced', 'Synchronisé');
  }, (error) => {
    console.error(error);
    setSyncStatus('error', 'Accès distant refusé');
    toast('Firestore a refusé l’accès. Vérifie les règles et l’adresse propriétaire.', 'error');
  });
}

function switchView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function totals() {
  const items = [...state.fleet, ...state.ccus];
  const cash = items.reduce((sum, item) => sum + (item.fundingType === 'cash' ? Number(item.paidAmount || 0) : 0), 0);
  const credit = items.reduce((sum, item) => sum + (item.fundingType === 'credit' ? Number(item.paidAmount || 0) : 0), 0);
  const saving = state.chains.reduce((sum, chain) => sum + chainMetrics(state, chain).saving, 0);
  return { cash, credit, saving };
}

function availabilityBadge(entry) {
  if (!entry) return '<span class="badge warn">À actualiser</span>';
  return entry.available ? '<span class="badge good">Disponible</span>' : '<span class="badge bad">Indisponible</span>';
}

function fundingLabel(value) {
  return ({ cash: 'Argent frais', credit: 'Store Credit', historical: 'Historique' })[value] || 'Historique';
}

function tokenLabel(value) {
  return ({ standard: 'Standard', giveaway: 'Gift CIG', referral: 'Referral' })[value] || 'Standard';
}

function renderDashboard() {
  const t = totals();
  $('#metric-fleet-value').textContent = money(fleetValue(state));
  $('#metric-fleet-count').textContent = `${state.fleet.length} vaisseau${state.fleet.length > 1 ? 'x' : ''}`;
  $('#metric-cash').textContent = money(t.cash);
  $('#metric-credit').textContent = money(t.credit);
  $('#metric-wallet').textContent = `${money(state.wallet.storeCredit)} disponible`;
  $('#metric-saving').textContent = money(t.saving);
  $('#metric-chains-count').textContent = `${state.chains.length} chaîne${state.chains.length > 1 ? 's' : ''}`;

  const filter = $('#fleet-filter').value;
  const search = normalizeName($('#fleet-search').value);
  const reserved = reservedIds(state).tokenIds;
  const rows = state.fleet.filter((item) => {
    const entry = findCatalogEntry(state.catalog, item.shipName);
    if (search && !normalizeName(item.shipName).includes(search)) return false;
    if (filter === 'available' && !entry?.available) return false;
    if (filter === 'unavailable' && entry?.available !== false) return false;
    if (filter === 'reserved' && !reserved.has(item.id)) return false;
    return true;
  });
  $('#fleet-dashboard-body').innerHTML = rows.map((item) => {
    const entry = findCatalogEntry(state.catalog, item.shipName);
    const value = entry?.currentPrice || entry?.msrp || item.currentValue;
    return `<tr><td><span class="cell-title">${escapeHtml(item.shipName)}</span><span class="cell-sub">${escapeHtml(tokenLabel(item.tokenType))}${item.insurance ? ` · ${escapeHtml(item.insurance)}` : ''}</span></td><td>${money(item.paidAmount)}</td><td>${value ? money(value) : '—'}</td><td>${availabilityBadge(entry)}</td><td>${escapeHtml(fundingLabel(item.fundingType))}</td><td>${reserved.has(item.id) ? '<span class="badge info">Réservé</span>' : '<span class="badge">Libre</span>'}</td></tr>`;
  }).join('');
  $('#fleet-empty').classList.toggle('hidden', state.fleet.length > 0);
  $('.table-wrap', $('.fleet-panel')).classList.toggle('hidden', state.fleet.length === 0);

  const meta = state.catalogMeta;
  if (meta.lastRefreshAt) {
    $('#catalog-status-title').textContent = meta.lastError ? 'Catalogue partiellement actualisé' : 'Prix et disponibilité actualisés';
    $('#catalog-status-text').textContent = `${Object.keys(state.catalog).length} référence(s) · ${formatDate(meta.lastRefreshAt)}${meta.lastError ? ` · ${meta.lastError}` : ''}`;
  } else {
    $('#catalog-status-title').textContent = 'Catalogue non actualisé';
    $('#catalog-status-text').textContent = 'Ajoute ta flotte puis lance l’actualisation.';
  }
}

function renderInventory() {
  const reserved = reservedIds(state);
  $('#fleet-list-count').textContent = `${state.fleet.length} élément(s), ${reserved.tokenIds.size} réservé(s)`;
  $('#fleet-cards').innerHTML = state.fleet.length ? state.fleet.map((item) => {
    const entry = findCatalogEntry(state.catalog, item.shipName);
    const value = entry?.currentPrice || entry?.msrp || item.currentValue;
    const locked = reserved.tokenIds.has(item.id);
    return `<article class="item-card"><div class="item-card-head"><div><h3>${escapeHtml(item.shipName)}</h3><p>${escapeHtml(tokenLabel(item.tokenType))} · ${escapeHtml(item.insurance || 'Assurance non renseignée')}</p></div>${availabilityBadge(entry)}</div><div class="item-card-values"><div><span>Payé TTC</span><strong>${money(item.paidAmount)}</strong></div><div><span>Valeur catalogue</span><strong>${value ? money(value) : '—'}</strong></div></div><div class="card-actions">${locked ? '<span class="badge info">Dans une chaîne</span>' : `<button class="mini-button delete-fleet" data-id="${item.id}">Supprimer</button>`}</div></article>`;
  }).join('') : '<p class="fine-print">Aucun vaisseau enregistré.</p>';

  $('#ccu-list-count').textContent = `${state.ccus.length} CCU, ${reserved.ccuIds.size} réservé(s)`;
  $('#ccu-table-body').innerHTML = state.ccus.map((ccu) => {
    const from = findCatalogEntry(state.catalog, ccu.fromShip);
    const to = findCatalogEntry(state.catalog, ccu.toShip);
    const gap = from && to ? Number(to.currentPrice || to.msrp) - Number(from.currentPrice || from.msrp) : null;
    const locked = reserved.ccuIds.has(ccu.id);
    return `<tr><td><span class="cell-title">${escapeHtml(ccu.fromShip)} → ${escapeHtml(ccu.toShip)}</span></td><td>${money(ccu.paidAmount)}</td><td>${gap == null ? '—' : money(gap)}</td><td>${ccu.warbond ? '<span class="badge good">Warbond</span>' : '<span class="badge">Standard</span>'}${ccu.speculative ? ' <span class="badge warn">Spéculatif</span>' : ''}</td><td>${locked ? '<span class="badge info">Réservé</span>' : '<span class="badge">Libre</span>'}</td><td>${locked ? '' : `<button class="mini-button delete-ccu" data-id="${ccu.id}">Supprimer</button>`}</td></tr>`;
  }).join('');
}

function renderChains() {
  const reserved = reservedIds(state);
  const options = state.fleet.filter((item) => !reserved.tokenIds.has(item.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.shipName)} — ${escapeHtml(tokenLabel(item.tokenType))}</option>`).join('');
  $('#chain-token').innerHTML = options || '<option value="">Aucun token libre</option>';
  $('#chain-token').disabled = !options;
  const names = [...new Set(Object.values(state.catalog).map((entry) => entry.name).filter(Boolean))].sort();
  $('#catalog-names').innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
  $('#chains-empty').classList.toggle('hidden', state.chains.length > 0);
  $('#chains-list').innerHTML = state.chains.map((chain) => {
    const token = state.fleet.find((item) => item.id === chain.tokenId);
    const ccus = chain.ccuIds.map((id) => state.ccus.find((ccu) => ccu.id === id)).filter(Boolean);
    const metrics = chainMetrics(state, chain);
    const vat = vatBreakdown(metrics.paid, state.settings.vatRate);
    const nodes = [token?.shipName || 'Token manquant', ...ccus.map((ccu) => ccu.toShip)];
    if (normalizeName(nodes.at(-1)) !== normalizeName(chain.targetShip)) nodes.push(`Trou → ${chain.targetShip}`);
    return `<article class="panel chain-card"><div class="chain-top"><div><span class="eyebrow">${chain.exact ? 'Chaîne complète' : 'Chaîne partielle'}</span><h2>${escapeHtml(chain.name)}</h2></div><button class="mini-button delete-chain" data-id="${chain.id}">Supprimer et libérer</button></div><div class="chain-path">${nodes.map((name, index) => `${index ? '<span class="path-arrow">→</span>' : ''}<span class="path-node">${escapeHtml(name)}</span>`).join('')}</div><div class="chain-metrics"><div><span>Valeur cible</span><strong>${money(metrics.currentValue)}</strong></div><div><span>Coût payé</span><strong>${money(metrics.paid)}</strong></div><div><span>Argent frais</span><strong>${money(metrics.cash)}</strong></div><div><span>Store Credit</span><strong>${money(metrics.credit)}</strong></div><div><span>Économie</span><strong>${money(metrics.saving)}</strong></div></div><p class="fine-print">Base HT estimée : ${money(vat.ht)} · TVA incluse : ${money(vat.vat)} · ${ccus.length} CCU réservé(s)</p>${metrics.nonMeltable ? '<div class="chain-alert">⚠ Chaîne entière non meltable : le token de départ est un Gift CIG, un Referral Reward ou est marqué non meltable.</div>' : ''}${metrics.speculative ? '<div class="chain-alert">△ Cette chaîne contient au moins un CCU spéculatif. Les gains futurs ne sont pas garantis.</div>' : ''}${!chain.exact ? `<div class="chain-alert">Chaîne incomplète : trou catalogue estimé à ${money(chain.gapValue || 0)}.</div>` : ''}</article>`;
  }).join('');
}

function renderSettings() {
  const form = $('#settings-form');
  form.storeCredit.value = state.wallet.storeCredit;
  form.vatRate.value = state.settings.vatRate;
  form.autoRefreshHours.value = state.settings.autoRefreshHours;
  $('#catalog-last-attempt').textContent = state.catalogMeta.lastRefreshAt ? `${formatDate(state.catalogMeta.lastRefreshAt)}${state.catalogMeta.lastError ? ` — ${state.catalogMeta.lastError}` : ''}` : 'Jamais';
}

function renderAll() {
  renderDashboard();
  renderInventory();
  renderChains();
  renderSettings();
  bindDynamicEvents();
}

function bindDynamicEvents() {
  $$('.delete-fleet').forEach((button) => button.onclick = () => deleteFleet(button.dataset.id));
  $$('.delete-ccu').forEach((button) => button.onclick = () => deleteCcu(button.dataset.id));
  $$('.delete-chain').forEach((button) => button.onclick = () => deleteChain(button.dataset.id));
}

async function confirmAction(title, message) {
  const dialog = $('#confirm-dialog');
  $('#dialog-title').textContent = title;
  $('#dialog-message').textContent = message;
  dialog.showModal();
  const result = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  return result;
}

async function deleteFleet(id) {
  if (!(await confirmAction('Supprimer ce token ?', 'Le vaisseau sera retiré de la flotte.'))) return;
  mutate((draft) => { draft.fleet = draft.fleet.filter((item) => item.id !== id); });
}
async function deleteCcu(id) {
  if (!(await confirmAction('Supprimer ce CCU ?', 'Le CCU sera retiré de l’inventaire.'))) return;
  mutate((draft) => { draft.ccus = draft.ccus.filter((item) => item.id !== id); });
}
async function deleteChain(id) {
  if (!(await confirmAction('Supprimer cette chaîne ?', 'Le token et tous les CCU de la chaîne redeviendront immédiatement disponibles.'))) return;
  mutate((draft) => { draft.chains = draft.chains.filter((chain) => chain.id !== id); });
  toast('Chaîne supprimée. Les éléments sont de nouveau libres.');
}

async function fetchCatalogEntry(name) {
  let lastError = null;
  for (const slug of slugCandidates(name)) {
    try {
      const response = await fetch(`${CATALOG_API}/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) { lastError = new Error(`HTTP ${response.status}`); continue; }
      const json = await response.json();
      if (json?.data) return catalogEntryFromApi(json.data);
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Vaisseau introuvable');
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function knownShipNames(extra = []) {
  const names = [
    ...state.fleet.map((item) => item.shipName),
    ...state.ccus.flatMap((ccu) => [ccu.fromShip, ccu.toShip]),
    ...state.chains.map((chain) => chain.targetShip), ...extra
  ].filter(Boolean);
  return [...new Map(names.map((name) => [normalizeName(name), name])).values()];
}

async function refreshCatalog(extra = [], { silent = false } = {}) {
  const names = knownShipNames(extra);
  if (!names.length) {
    if (!silent) toast('Ajoute d’abord un vaisseau ou un CCU.');
    return;
  }
  const button = $('#refresh-catalog-btn');
  button.disabled = true;
  button.textContent = 'Actualisation…';
  let successes = 0;
  const failures = [];
  const entries = await mapLimit(names, 4, async (name) => {
    try { return { name, entry: await fetchCatalogEntry(name) }; }
    catch (error) { failures.push(name); return { name, entry: null }; }
  });
  mutate((draft) => {
    for (const { name, entry } of entries) {
      if (!entry) continue;
      successes++;
      draft.catalog[normalizeName(name)] = entry;
      draft.catalog[entry.key] = entry;
    }
    draft.catalogMeta.lastRefreshAt = new Date().toISOString();
    draft.catalogMeta.lastError = failures.length ? `${failures.length} nom(s) non reconnu(s) : ${failures.slice(0, 3).join(', ')}` : null;
  });
  button.disabled = false;
  button.textContent = '↻ Actualiser prix & disponibilité';
  if (!silent) toast(successes ? `${successes} référence(s) actualisée(s).` : 'Aucune référence actualisée. Vérifie les noms et le réseau.', successes ? '' : 'error');
}

function maybeAutoRefresh() {
  const hours = Number(state.settings.autoRefreshHours || 12);
  const last = new Date(state.catalogMeta.lastRefreshAt || 0).getTime();
  if (knownShipNames().length && Date.now() - last > hours * 3600000) refreshCatalog([], { silent: true });
}

function exportBackup() {
  const payload = { product: 'CCU-Pilot', schemaVersion: 2, exportedAt: new Date().toISOString(), ownerEmail: currentUser.email, state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ccu-pilot-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const imported = sanitizeState(parsed);
    if (!(await confirmAction('Importer cette sauvegarde ?', `${imported.fleet.length} vaisseau(x), ${imported.ccus.length} CCU et ${imported.chains.length} chaîne(s) remplaceront les données actuelles.`))) return;
    state = imported;
    state.updatedAt = new Date().toISOString();
    persistLocal();
    renderAll();
    scheduleRemoteSave(true);
    toast('Sauvegarde importée.');
    refreshCatalog([], { silent: true });
  } catch (error) {
    console.error(error);
    toast('Fichier JSON invalide ou incompatible.', 'error');
  }
}

function bindStaticEvents() {
  $('#login-btn').addEventListener('click', login);
  $('#logout-btn').addEventListener('click', async () => { remoteUnsubscribe?.(); await firebase.signOut(auth); });
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-view-target]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewTarget)));
  $('#refresh-catalog-btn').addEventListener('click', () => refreshCatalog());
  $('#fleet-search').addEventListener('input', renderDashboard);
  $('#fleet-filter').addEventListener('change', renderDashboard);

  $('#fleet-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tokenType = data.get('tokenType');
    mutate((draft) => draft.fleet.push({ id: uid('ship'), shipName: String(data.get('shipName')).trim(), paidAmount: Number(data.get('paidAmount') || 0), fundingType: data.get('fundingType'), tokenType, meltable: tokenType === 'standard', insurance: String(data.get('insurance') || '').trim(), currentValue: 0 }));
    const name = data.get('shipName');
    event.currentTarget.reset();
    toast('Vaisseau ajouté. Recherche du prix en cours…');
    refreshCatalog([name], { silent: true });
  });

  $('#ccu-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fromShip = String(data.get('fromShip')).trim();
    const toShip = String(data.get('toShip')).trim();
    if (normalizeName(fromShip) === normalizeName(toShip)) { toast('Le départ et l’arrivée doivent être différents.', 'error'); return; }
    mutate((draft) => draft.ccus.push({ id: uid('ccu'), fromShip, toShip, paidAmount: Number(data.get('paidAmount') || 0), fundingType: data.get('fundingType'), warbond: data.get('warbond') === 'on', speculative: data.get('speculative') === 'on', active: true }));
    event.currentTarget.reset();
    toast('CCU ajouté. Recherche des valeurs en cours…');
    refreshCatalog([fromShip, toShip], { silent: true });
  });

  $('#chain-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tokenId = data.get('tokenId');
    const targetShip = String(data.get('targetShip')).trim();
    if (!findCatalogEntry(state.catalog, targetShip)) await refreshCatalog([targetShip], { silent: true });
    try {
      const path = generateOwnedPath(state, tokenId, targetShip);
      mutate((draft) => draft.chains.push({ id: uid('chain'), name: String(data.get('chainName')).trim(), tokenId, targetShip, ccuIds: path.ccuIds, exact: path.exact, gapValue: path.gapValue, targetValue: path.targetValue, createdAt: new Date().toISOString() }));
      event.currentTarget.reset();
      toast(path.exact ? 'Chaîne complète enregistrée et éléments réservés.' : 'Meilleure chaîne partielle enregistrée. Le trou reste signalé.');
    } catch (error) { toast(error.message, 'error'); }
  });

  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutate((draft) => { draft.wallet.storeCredit = Number(data.get('storeCredit') || 0); draft.settings.vatRate = Number(data.get('vatRate') || 0); draft.settings.autoRefreshHours = Number(data.get('autoRefreshHours') || 12); });
    toast('Réglages enregistrés.');
  });
  $('#sync-now-btn').addEventListener('click', () => scheduleRemoteSave(true));
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-input').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importBackup(file); event.target.value = ''; });
  $('#reset-btn').addEventListener('click', async () => {
    if (!(await confirmAction('Tout réinitialiser ?', 'La flotte, les CCU, les chaînes et le catalogue seront effacés localement et dans Firestore.'))) return;
    state = createEmptyState();
    persistLocal();
    renderAll();
    scheduleRemoteSave(true);
    toast('Données réinitialisées.');
  });
}

bindStaticEvents();
initFirebase();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch((error) => console.warn('Service worker', error)));
}
