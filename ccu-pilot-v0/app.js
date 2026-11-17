(() => {
  'use strict';
  const Core = window.CCUCore;
  const STORAGE_KEY = 'ccu-pilot-v0-state';
  let state = loadState();
  let previewChain = null;
  let deferredInstall = null;
  let toastTimer = null;
  let cloud = { configured: false, user: null, auth: null, db: null, api: null, syncTimer: null };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR', {minimumFractionDigits:0, maximumFractionDigits:2}).format(Core.number(value))} $`;
  const percent = (value) => `${new Intl.NumberFormat('fr-FR', {maximumFractionDigits:1}).format(Core.number(value))} %`;
  const dateText = (value) => value ? new Intl.DateTimeFormat('fr-FR', {dateStyle:'medium', timeStyle: value.includes?.('T') ? 'short' : undefined}).format(new Date(value)) : '—';
  const badge = (label, type = '') => `<span class="badge ${type}">${esc(label)}</span>`;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.version === 1) return saved;
    } catch (error) { console.warn(error); }
    return Core.clone(window.CCU_SEED);
  }

  function persist({ render = true, cloudSync = true } = {}) {
    state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('#save-status').textContent = cloud.user ? `Local + ${cloud.user.email}` : 'Sauvegardé localement';
    if (render) renderAll();
    if (cloudSync && state.settings.autoSync) scheduleCloudPush();
  }

  function toast(message, isError = false) {
    const el = $('#toast'); el.textContent = message; el.style.borderColor = isError ? '#7e3640' : '#244257'; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function renderAll() {
    renderDashboard(); renderGenerator(); renderChains(); renderCCUs(); renderTokens(); renderHistory(); renderSettings();
  }

  function hero(eyebrow, title, text, extra = '') {
    return `<div class="hero"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(text)}</p></div>${extra}</div>`;
  }

  function renderDashboard() {
    const t = Core.portfolioTotals(state);
    const available = state.ccus.filter((c) => !c.usedBy && c.active !== false).length;
    const used = state.ccus.filter((c) => c.usedBy).length;
    const nonMeltable = state.chains.filter((c) => c.nonMeltable).length;
    const creditClass = t.storeCreditRemaining < 0 ? 'danger' : t.storeCreditRemaining < state.settings.storeCreditBalance * .2 ? 'warn' : '';
    $('#page-dashboard').innerHTML = hero('Pilotage financier', 'Vos chaînes, sans double emploi', 'Les CCU sont réservés au moment de l’enregistrement. Store Credit et argent frais restent séparés, montants TTC en dollars.') + `
      <div class="grid">
        <article class="card metric ${creditClass}"><div class="label">Store Credit restant</div><div class="value">${money(t.storeCreditRemaining)}</div><div class="sub">Budget ${money(state.settings.storeCreditBalance)} · planifié ${money(t.storeCredit)}</div></article>
        <article class="card metric"><div class="label">Argent frais restant planifié</div><div class="value">${money(t.freshCash)}</div><div class="sub">Toujours isolé du Store Credit</div></article>
        <article class="card metric"><div class="label">Valeur actuelle</div><div class="value">${money(t.currentValue)}</div><div class="sub">${state.chains.length} chaîne(s) enregistrée(s)</div></article>
        <article class="card metric"><div class="label">Valeur estimée</div><div class="value">${money(t.estimatedValue)}</div><div class="sub">Gain potentiel ${money(t.estimatedSavings)}</div></article>
        <article class="card wide"><h2>État de l’inventaire</h2><div class="kpi-row"><div><span>CCU disponibles</span><strong>${available}</strong></div><div><span>CCU réservés</span><strong>${used}</strong></div><div><span>Chaînes non meltables</span><strong>${nonMeltable}</strong></div></div>
          <div class="divider"></div><div class="source-note">Aucune chaîne n’est pré-enregistrée. Le générateur effectue un picking parmi les CCU libres, puis les verrouille uniquement quand la chaîne est enregistrée.</div></article>
        <article class="card side"><h2>Coût complet des plans</h2><div class="totals"><div><span>Historique</span><strong>${money(t.historical)}</strong></div><div><span>À financer</span><strong>${money(t.storeCredit + t.freshCash)}</strong></div><div><span>Économie actuelle</span><strong>${money(t.currentSavings)}</strong></div></div><div class="source-note">TVA paramétrée à ${percent(state.settings.vatRate)}. Les montants saisis et calculés sont TTC.</div></article>
        <article class="card full"><h2>Chaînes actives</h2>${state.chains.length ? state.chains.map(chainSummary).join('') : '<div class="empty">Aucune chaîne enregistrée. Lancez le générateur pour créer la première.</div>'}</article>
      </div>`;
  }

  function chainSummary(c) {
    return `<div class="chain-head" style="padding:10px 0;border-bottom:1px solid var(--line)"><div><strong>${esc(c.name)}</strong><div class="chain-route">${esc(c.tokenName)} → ${esc(c.targetName)}</div></div><div class="actions">${c.nonMeltable ? badge('Non meltable','danger') : badge('Meltable','ok')} ${badge(`${c.ccuIds.length} CCU pické(s)`,'info')} <strong>${money(c.totals.storeCreditTTC)} crédit / ${money(c.totals.freshCashTTC)} frais</strong></div></div>`;
  }

  function renderGenerator() {
    const tokens = state.tokens.filter((t) => !t.usedBy);
    const options = tokens.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${money(t.currentValue)}${t.meltable === false ? ' · NON MELTABLE' : ''}</option>`).join('');
    $('#page-generator').innerHTML = hero('Construction dynamique', 'Générer une chaîne', 'Choisissez un token et une cible. Le moteur maximise la valeur couverte par vos CCU disponibles, sans réutiliser un CCU déjà réservé.') + `
      <div class="grid"><form id="generator-form" class="card full"><div class="form-grid">
        <div class="field wide"><label>Nom de la chaîne</label><input name="name" placeholder="Ex. Route vers Liberator"></div>
        <div class="field wide"><label>Token de base *</label><select name="tokenId" required><option value="">Choisir…</option>${options}</select></div>
        <div class="field wide"><label>Vaisseau cible *</label><input name="targetName" required placeholder="Ex. Liberator"></div>
        <div class="field"><label>Valeur actuelle TTC ($) *</label><input name="targetCurrentValue" type="number" min="1" step="0.01" required></div>
        <div class="field"><label>Valeur estimée TTC ($)</label><input name="targetEstimatedValue" type="number" min="1" step="0.01"></div>
        <div class="field"><label class="check"><input name="includeSpeculative" type="checkbox" checked> Inclure les CCU spéculatifs</label></div>
        <div class="field"><label class="check"><input id="final-wb-toggle" name="finalWbEnabled" type="checkbox"> CCU Warbond final</label></div>
        <div id="final-wb-fields" class="full hidden"><div class="form-grid">
          <div class="field wide"><label>Vaisseau de départ du WB</label><input name="finalWbFromName" placeholder="Ex. Hermes"></div>
          <div class="field"><label>Valeur de départ WB ($)</label><input name="finalWbFromValue" type="number" min="1" step="0.01"></div>
          <div class="field"><label>Coût argent frais TTC ($)</label><input name="finalWbCashCost" type="number" min="0" step="0.01"></div>
        </div></div>
        <div class="field full"><div class="actions"><button type="submit">Générer la meilleure route</button><span class="muted">${state.ccus.filter((c)=>!c.usedBy && c.active !== false).length} CCU disponibles</span></div></div>
      </div></form><div id="generator-preview" class="full">${previewChain ? renderChainCard(previewChain, true) : ''}</div></div>`;
  }

  function renderChainCard(c, preview = false) {
    const creditRemaining = Core.number(state.settings.storeCreditBalance) - Core.portfolioTotals(state).storeCredit - (preview ? c.totals.storeCreditTTC : 0);
    const steps = c.steps.map((s) => `<div class="step"><div class="step-title">${esc(s.label)} · ${esc(s.fromName)} → ${esc(s.toName)}</div><div class="step-meta">${money(s.fromValue)} → ${money(s.toValue)} · Historique ${money(s.historicalTTC)} · Crédit ${money(s.storeCreditTTC)} · Argent frais ${money(s.freshCashTTC)}${s.risk ? ` · Risque ${esc(s.risk)}` : ''}</div></div>`).join('');
    return `<article class="card chain-card"><div class="chain-head"><div><div class="eyebrow">${preview ? 'Prévisualisation — rien n’est encore réservé' : 'Chaîne enregistrée'}</div><h2>${esc(c.name)}</h2><div class="chain-route">${esc(c.tokenName)} → ${esc(c.targetName)}</div></div><div class="actions">${c.nonMeltable ? badge(`Non meltable · ${c.nonMeltableReason}`,'danger') : badge('Meltable','ok')} ${badge(`${c.ccuIds.length} CCU`,'info')}</div></div>
      ${c.nonMeltable ? '<div class="alert danger"><strong>Alerte :</strong> le token de base rend la chaîne entière non meltable. Cette alerte est héritée par toutes les étapes.</div>' : ''}
      <div class="totals"><div><span>Store Credit</span><strong>${money(c.totals.storeCreditTTC)}</strong></div><div><span>Argent frais</span><strong>${money(c.totals.freshCashTTC)}</strong></div><div><span>Valeur actuelle</span><strong>${money(c.targetCurrentValue)}</strong></div><div><span>Valeur estimée</span><strong>${money(c.targetEstimatedValue)}</strong></div><div><span>Économie actuelle</span><strong>${money(c.totals.currentSavings)}</strong></div><div><span>TVA incluse</span><strong>${money(c.totals.vatAmount)}</strong></div></div>
      ${creditRemaining < 0 ? `<div class="alert danger">Store Credit insuffisant de ${money(Math.abs(creditRemaining))} pour ce plan.</div>` : `<div class="alert">Store Credit restant après enregistrement : ${money(creditRemaining)}.</div>`}
      <div class="steps">${steps}</div><div class="divider"></div><div class="actions">${preview ? '<button data-action="save-preview">Enregistrer et réserver les CCU</button>' : `<button class="ghost small" data-action="export-chain" data-id="${esc(c.id)}">Exporter cette chaîne</button><button class="danger small" data-action="delete-chain" data-id="${esc(c.id)}">Supprimer et libérer</button>`}</div></article>`;
  }

  function renderChains() {
    $('#page-chains').innerHTML = hero('Stockage local', 'Chaînes enregistrées', 'Supprimer une chaîne libère automatiquement son token et tous ses CCU. L’export d’une chaîne reste portable.') + (state.chains.length ? state.chains.map((c) => renderChainCard(c)).join('') : '<article class="card empty">Aucune chaîne enregistrée.</article>');
  }

  function renderCCUs() {
    const rows = state.ccus.map((c) => `<tr><td>${esc(c.fromName)} → ${esc(c.toName)}</td><td>${c.fromValue == null ? '—' : money(c.fromValue)} → ${c.toValue == null ? '—' : money(c.toValue)}</td><td>${money(c.paidHistorical)}</td><td>${c.warbond ? badge('Warbond','info') : 'Standard'} ${c.speculative ? badge('Spéculatif','warn') : ''}</td><td>${c.speculative ? `${money(c.estimatedToValue)} · ${esc(c.risk)}` : '—'}</td><td>${c.usedBy ? badge(state.chains.find((x)=>x.id===c.usedBy)?.name || 'Réservé','danger') : c.active === false ? badge('À identifier','warn') : badge('Disponible','ok')}</td><td><div class="actions"><button class="ghost small" data-action="edit-ccu" data-id="${esc(c.id)}">Modifier</button><button class="danger small" data-action="delete-ccu" data-id="${esc(c.id)}" ${c.usedBy?'disabled':''}>Supprimer</button></div></td></tr>`).join('');
    $('#page-ccus').innerHTML = hero('Inventaire', 'CCU disponibles', 'Inventaire issu du classeur Excel. Les anciennes affectations du plan ne sont pas reprises : tous les CCU valides démarrent disponibles.') + `
      <form id="ccu-form" class="card"><h2>Ajouter un CCU</h2><div class="form-grid"><div class="field wide"><label>De *</label><input name="fromName" required></div><div class="field wide"><label>À *</label><input name="toName" required></div><div class="field"><label>Valeur départ ($) *</label><input name="fromValue" type="number" min="0" step="0.01" required></div><div class="field"><label>Valeur arrivée actuelle ($) *</label><input name="toValue" type="number" min="0" step="0.01" required></div><div class="field"><label>Coût historique TTC ($)</label><input name="paidHistorical" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Valeur arrivée estimée ($)</label><input name="estimatedToValue" type="number" min="0" step="0.01"></div><div class="field"><label class="check"><input name="warbond" type="checkbox"> Warbond</label></div><div class="field"><label class="check"><input name="speculative" type="checkbox"> Spéculatif</label></div><div class="field"><label>Risque</label><select name="risk"><option>faible</option><option selected>moyen</option><option>élevé</option></select></div><div class="field"><label>Assurance</label><input name="insurance" placeholder="Ex. 120 mois"></div><div class="field full"><button type="submit">Ajouter à l’inventaire</button></div></div></form>
      <div class="section-title"><h2>${state.ccus.length} CCU</h2><span class="muted">Un CCU réservé ne peut pas être supprimé.</span></div><div class="table-wrap"><table><thead><tr><th>Route</th><th>Valeurs TTC</th><th>Payé</th><th>Type</th><th>Estimation</th><th>État</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderTokens() {
    const rows = state.tokens.map((t) => `<tr><td>${esc(t.name)}</td><td>${money(t.currentValue)}</td><td>${money(t.estimatedValue)}</td><td>${money(t.paidHistorical)}</td><td>${esc(t.insurance || '—')}</td><td>${badge(t.type, t.type === 'standard' ? 'info' : 'danger')}</td><td>${t.meltable ? badge('Oui','ok') : badge('Non','danger')}</td><td>${t.usedBy ? badge(state.chains.find((x)=>x.id===t.usedBy)?.name || 'Réservé','danger') : badge('Disponible','ok')}</td><td><div class="actions"><button class="ghost small" data-action="edit-token" data-id="${esc(t.id)}">Modifier</button><button class="danger small" data-action="delete-token" data-id="${esc(t.id)}" ${t.usedBy?'disabled':''}>Supprimer</button></div></td></tr>`).join('');
    $('#page-tokens').innerHTML = hero('Bases de chaîne', 'Tokens', 'Les Gifts CIG et Referral Rewards sont automatiquement non meltables. Cette propriété se propage à la chaîne entière.') + `
      <form id="token-form" class="card"><h2>Ajouter un token</h2><div class="form-grid"><div class="field wide"><label>Nom *</label><input name="name" required></div><div class="field"><label>Valeur actuelle TTC ($) *</label><input name="currentValue" type="number" min="0" step="0.01" required></div><div class="field"><label>Valeur estimée ($)</label><input name="estimatedValue" type="number" min="0" step="0.01"></div><div class="field"><label>Coût historique TTC ($)</label><input name="paidHistorical" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Type</label><select name="type"><option value="standard">Standard</option><option value="gift">Gift CIG</option><option value="referral">Referral Reward</option></select></div><div class="field"><label>Assurance</label><input name="insurance" value="LTI"></div><div class="field wide"><label>Package / note</label><input name="package"></div><div class="field full"><button type="submit">Ajouter le token</button></div></div></form>
      <div class="section-title"><h2>${state.tokens.length} tokens</h2></div><div class="table-wrap"><table><thead><tr><th>Token</th><th>Actuelle</th><th>Estimée</th><th>Payé</th><th>Assurance</th><th>Type</th><th>Meltable</th><th>État</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function historyStats() {
    const groups = {};
    state.priceHistory.forEach((h) => (groups[h.ship] ||= []).push(h));
    return Object.entries(groups).map(([ship, items]) => {
      items.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const discounts = items.filter((x)=>Core.number(x.catalogPrice)>0).map((x)=>(Core.number(x.catalogPrice)-Core.number(x.warbondPrice))/Core.number(x.catalogPrice)*100);
      return { ship, count:items.length, averageDiscount: discounts.length ? discounts.reduce((a,b)=>a+b,0)/discounts.length : 0, trend: Core.number(items.at(-1).catalogPrice)-Core.number(items[0].catalogPrice), latest:items.at(-1) };
    }).sort((a,b)=>b.count-a.count);
  }

  function renderHistory() {
    const stats = historyStats();
    const statsRows = stats.map((s)=>`<tr><td>${esc(s.ship)}</td><td>${s.count}</td><td>${percent(s.averageDiscount)}</td><td>${money(s.trend)}</td><td>${dateText(s.latest.date)}</td></tr>`).join('');
    const rows = [...state.priceHistory].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map((h)=>`<tr><td>${dateText(h.date)}</td><td>${esc(h.ship)}</td><td>${money(h.catalogPrice)}</td><td>${money(h.warbondPrice)}</td><td>${percent((Core.number(h.catalogPrice)-Core.number(h.warbondPrice))/Math.max(1,Core.number(h.catalogPrice))*100)}</td><td><button class="danger small" data-action="delete-history" data-id="${esc(h.id)}">Supprimer</button></td></tr>`).join('');
    $('#page-history').innerHTML = hero('Historique Warbond', 'Spéculation documentée', 'Enregistrez les offres passées et les évolutions de prix. Le risque reste explicite ; une hausse estimée n’est jamais traitée comme une valeur garantie.', '<a class="button ghost" target="_blank" rel="noopener" href="https://citizenshub.app/price-history">Ouvrir Citizens’ Hub</a>') + `
      <div class="grid"><form id="history-form" class="card wide"><h2>Ajouter une observation</h2><div class="form-grid"><div class="field wide"><label>Vaisseau *</label><input name="ship" required></div><div class="field"><label>Date *</label><input name="date" type="date" required></div><div class="field"><label>Prix catalogue TTC ($) *</label><input name="catalogPrice" type="number" min="0" step="0.01" required></div><div class="field"><label>Prix Warbond TTC ($) *</label><input name="warbondPrice" type="number" min="0" step="0.01" required></div><div class="field full"><button type="submit">Ajouter l’observation</button></div></div></form><article class="card side"><h2>Règle V0</h2><p class="source-note">Un historique récurrent augmente la confiance, sans prédire une future offre. Marquez ensuite le CCU concerné comme « spéculatif », saisissez sa valeur estimée et son niveau de risque. Source de travail : historique public de Citizens’ Hub.</p></article></div>
      <div class="section-title"><h2>Synthèse par vaisseau</h2></div>${stats.length?`<div class="table-wrap"><table><thead><tr><th>Vaisseau</th><th>Observations</th><th>Remise WB moyenne</th><th>Évolution catalogue</th><th>Dernière date</th></tr></thead><tbody>${statsRows}</tbody></table></div>`:'<article class="card empty">Aucun historique saisi.</article>'}
      <div class="section-title"><h2>Observations</h2></div>${rows?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Vaisseau</th><th>Catalogue</th><th>Warbond</th><th>Remise</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<article class="card empty">Ajoutez manuellement les données vérifiées sur Citizens’ Hub.</article>'}`;
  }

  function renderSettings() {
    const configured = Boolean(window.CCU_FIREBASE_CONFIG?.apiKey && window.CCU_FIREBASE_CONFIG?.projectId);
    $('#page-settings').innerHTML = hero('Données et synchronisation', 'Réglages', 'Les données restent dans le stockage local de chaque appareil. L’export JSON fournit une sauvegarde complète. Firebase active la synchronisation par compte Google.') + `
      <div class="grid"><form id="settings-form" class="card wide"><h2>Finances</h2><div class="form-grid"><div class="field wide"><label>Store Credit disponible TTC ($)</label><input name="storeCreditBalance" type="number" min="0" step="0.01" value="${esc(state.settings.storeCreditBalance)}"></div><div class="field wide"><label>TVA (%)</label><input name="vatRate" type="number" min="0" max="100" step="0.01" value="${esc(state.settings.vatRate)}"></div><div class="field full"><label class="check"><input name="autoSync" type="checkbox" ${state.settings.autoSync?'checked':''}> Synchroniser automatiquement quand Google est connecté</label></div><div class="field full"><button type="submit">Enregistrer les réglages</button></div></div></form>
      <article class="card side"><h2>Google / Chrome</h2><p>${configured ? badge('Firebase configuré','ok') : badge('Configuration requise','warn')}</p><p class="source-note">Connexion autorisée : Google uniquement. La même URL installée dans Chrome sur PC et Android retrouve les données après connexion.</p><div class="actions"><button data-action="cloud-login">${cloud.user?'Synchroniser maintenant':'Connexion Google'}</button>${cloud.user?'<button class="ghost" data-action="cloud-logout">Déconnexion</button>':''}</div></article>
      <article class="card full"><h2>Import / export</h2><div class="actions"><button data-action="export-all">Exporter la sauvegarde JSON</button><label class="button ghost" for="import-json">Importer JSON</label><input id="import-json" class="hidden" type="file" accept="application/json,.json"><label class="button ghost" for="import-xlsx">Importer Optimisation_chaines_CCU.xlsx</label><input id="import-xlsx" class="hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><button class="danger" data-action="reset-data">Réinitialiser avec l’Excel livré</button></div><p class="source-note">L’import Excel remplace tokens et CCU, puis efface les chaînes pour éviter toute référence incohérente. Aucun accès RSI automatique en V0.</p></article>
      <article class="card full"><h2>Intégrité</h2>${(() => {const v=Core.validateState(state); return v.valid?'<div class="alert">Données cohérentes : aucun CCU n’est réutilisé dans plusieurs chaînes.</div>':`<div class="alert danger">${v.errors.map(esc).join('<br>')}</div>`;})()}</article></div>`;
  }

  function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }

  document.addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.target; const data = formObject(form);
    try {
      if (form.id === 'generator-form') {
        previewChain = Core.generateChain(state, {
          ...data, includeSpeculative: form.elements.includeSpeculative.checked,
          finalWb: {enabled:form.elements.finalWbEnabled.checked,fromName:data.finalWbFromName,fromValue:data.finalWbFromValue,cashCost:data.finalWbCashCost}
        }); renderGenerator(); $('#generator-preview')?.scrollIntoView({behavior:'smooth'}); toast('Route générée. Rien n’est réservé avant enregistrement.');
      } else if (form.id === 'ccu-form') {
        const fromValue=Core.number(data.fromValue), toValue=Core.number(data.toValue); if(toValue<=fromValue) throw new Error('La valeur d’arrivée doit dépasser la valeur de départ.');
        state.ccus.push({id:Core.uid('ccu'),fromName:data.fromName.trim(),toName:data.toName.trim(),fromValue,toValue,estimatedToValue:Core.number(data.estimatedToValue,toValue)||toValue,paidHistorical:Core.number(data.paidHistorical),warbond:form.elements.warbond.checked,speculative:form.elements.speculative.checked,risk:data.risk,insurance:data.insurance||'',note:'Saisie manuelle',usedBy:null,active:true}); persist(); form.reset(); toast('CCU ajouté.');
      } else if (form.id === 'token-form') {
        const type=data.type; state.tokens.push({id:Core.uid('token'),name:data.name.trim(),currentValue:Core.number(data.currentValue),estimatedValue:Core.number(data.estimatedValue,Core.number(data.currentValue))||Core.number(data.currentValue),paidHistorical:Core.number(data.paidHistorical),insurance:data.insurance||'',location:'Saisie manuelle',package:data.package||'',type,meltable:type==='standard',usedBy:null}); persist(); form.reset(); toast('Token ajouté.');
      } else if (form.id === 'history-form') {
        state.priceHistory.push({id:Core.uid('history'),ship:data.ship.trim(),date:data.date,catalogPrice:Core.number(data.catalogPrice),warbondPrice:Core.number(data.warbondPrice),source:'Citizens Hub / saisie manuelle'}); persist(); form.reset(); toast('Observation ajoutée.');
      } else if (form.id === 'settings-form') {
        state.settings.storeCreditBalance=Core.number(data.storeCreditBalance); state.settings.vatRate=Core.number(data.vatRate); state.settings.autoSync=form.elements.autoSync.checked; persist(); toast('Réglages enregistrés.');
      }
    } catch (error) { toast(error.message || String(error), true); }
  });

  document.addEventListener('change', async (event) => {
    const target = event.target;
    if (target.id === 'final-wb-toggle') $('#final-wb-fields').classList.toggle('hidden', !target.checked);
    if (target.id === 'import-json' && target.files[0]) await importJSON(target.files[0]);
    if (target.id === 'import-xlsx' && target.files[0]) await importExcel(target.files[0]);
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action; const id = button.dataset.id;
    try {
      if (action === 'save-preview') {
        if (!previewChain) return; state = Core.saveChain(state, previewChain); previewChain = null; persist(); showPage('chains'); toast('Chaîne enregistrée : token et CCU réservés.');
      } else if (action === 'delete-chain') {
        if (confirm('Supprimer cette chaîne et libérer son token et ses CCU ?')) { state=Core.deleteChain(state,id); persist(); toast('Chaîne supprimée, éléments libérés.'); }
      } else if (action === 'export-chain') downloadJSON(state.chains.find((c)=>c.id===id), `chaine-${safeName(state.chains.find((c)=>c.id===id)?.name)}.json`);
      else if (action === 'delete-ccu') { state.ccus=state.ccus.filter((c)=>c.id!==id); persist(); toast('CCU supprimé.'); }
      else if (action === 'delete-token') { state.tokens=state.tokens.filter((t)=>t.id!==id); persist(); toast('Token supprimé.'); }
      else if (action === 'delete-history') { state.priceHistory=state.priceHistory.filter((h)=>h.id!==id); persist(); toast('Observation supprimée.'); }
      else if (action === 'edit-ccu') editCCU(id);
      else if (action === 'edit-token') editToken(id);
      else if (action === 'export-all') downloadJSON(state, `ccu-pilot-sauvegarde-${new Date().toISOString().slice(0,10)}.json`);
      else if (action === 'reset-data') { if(confirm('Réinitialiser toutes les données locales avec l’inventaire livré ?')) {state=Core.clone(window.CCU_SEED);previewChain=null;persist();toast('Données réinitialisées.');} }
      else if (action === 'cloud-login') await cloudLogin();
      else if (action === 'cloud-logout') await cloudLogout();
    } catch (error) { toast(error.message || String(error), true); }
  });

  function editCCU(id) {
    const c=state.ccus.find((x)=>x.id===id); if(!c||c.usedBy) return toast('Libérez d’abord ce CCU de sa chaîne.',true);
    const est=prompt('Valeur d’arrivée estimée ($)',c.estimatedToValue ?? c.toValue); if(est===null)return;
    const spec=confirm('Marquer ce CCU comme spéculatif ? OK = oui, Annuler = non.');
    let risk=c.risk||'moyen'; if(spec){risk=prompt('Risque : faible, moyen ou élevé',risk)||risk;}
    c.estimatedToValue=Core.number(est,c.toValue);c.speculative=spec;c.risk=risk;persist();toast('CCU mis à jour.');
  }
  function editToken(id) {
    const t=state.tokens.find((x)=>x.id===id); if(!t||t.usedBy) return toast('Libérez d’abord ce token de sa chaîne.',true);
    const est=prompt('Valeur estimée du token ($)',t.estimatedValue ?? t.currentValue); if(est===null)return;
    const type=prompt('Type : standard, gift ou referral',t.type||'standard'); if(type===null)return;
    t.estimatedValue=Core.number(est,t.currentValue);t.type=['gift','referral'].includes(type)?type:'standard';t.meltable=t.type==='standard';persist();toast('Token mis à jour.');
  }

  function safeName(value='export') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'export'; }
  function downloadJSON(data, filename) { const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

  async function importJSON(file) {
    try { const parsed=JSON.parse(await file.text()); const check=Core.validateState(parsed); if(!parsed.version||!check.valid) throw new Error(`Sauvegarde invalide. ${check.errors?.join(' ')||''}`); if(confirm('Remplacer toutes les données locales par cette sauvegarde ?')){state=parsed;previewChain=null;persist();toast('Sauvegarde JSON importée.');} } catch(error){toast(error.message||String(error),true);}
  }

  async function importExcel(file) {
    try {
      const workbook=await window.XLSXLite.read(file); const tokenRows=workbook.Sheets['Flotte_Tokens']; const ccuRows=workbook.Sheets['Inventaire_CCU'];
      if(!tokenRows||!ccuRows) throw new Error('Onglets Flotte_Tokens ou Inventaire_CCU introuvables.');
      const tokens=[]; const tokenHeader=tokenRows.findIndex((r)=>(r||[]).includes('Qté'));
      for(let i=tokenHeader+1;i<tokenRows.length;i++){const r=tokenRows[i]||[];if(String(r[0]||'').startsWith('TOTAL'))break;if(!Number.isFinite(Number(r[0])))continue;for(let q=0;q<Number(r[0]);q++){const pkg=String(r[9]||'');const low=pkg.toLowerCase();const type=low.includes('referral')?'referral':(low.includes('giveaway')||low.includes('gift cig'))?'gift':'standard';tokens.push({id:Core.uid('token'),name:String(r[1]||''),currentValue:Core.number(r[2]),estimatedValue:Core.number(r[2]),paidHistorical:Core.number(r[3]),insurance:String(r[6]||''),location:String(r[7]||''),package:pkg,type,meltable:type==='standard',usedBy:null});}}
      const ccus=[]; const ccuHeader=ccuRows.findIndex((r)=>(r||[]).includes('Qté'));
      for(let i=ccuHeader+1;i<ccuRows.length;i++){const r=ccuRows[i]||[];if(String(r[0]||'').startsWith('TOTAL'))break;if(!Number.isFinite(Number(r[0])))continue;for(let q=0;q<Number(r[0]);q++){const valid=Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4]));ccus.push({id:Core.uid('ccu'),fromName:String(r[1]||''),toName:String(r[2]||''),fromValue:valid?Core.number(r[3]):null,toValue:valid?Core.number(r[4]):null,estimatedToValue:valid?Core.number(r[4]):null,paidHistorical:Core.number(r[6]),warbond:String(r[9]||'').toLowerCase().startsWith('oui'),speculative:false,risk:'moyen',insurance:String(r[10]||''),note:String(r[12]||''),usedBy:null,active:valid});}}
      if(!tokens.length||!ccus.length)throw new Error('Aucune donnée exploitable trouvée.');
      if(confirm(`Importer ${tokens.length} tokens et ${ccus.length} CCU ? Les chaînes actuelles seront effacées.`)){state.tokens=tokens;state.ccus=ccus;state.chains=[];state.meta.source=file.name;state.meta.importedAt=new Date().toISOString();previewChain=null;persist();toast('Excel importé. Aucune chaîne pré-enregistrée.');}
    } catch(error){toast(`Import Excel impossible : ${error.message||error}`,true);}
  }

  function showPage(name) {
    $$('.tabs button').forEach((b)=>b.classList.toggle('active',b.dataset.page===name));
    $$('.page').forEach((p)=>p.classList.toggle('active',p.id===`page-${name}`));
    window.scrollTo({top:0,behavior:'smooth'});
  }
  $$('.tabs button').forEach((button)=>button.addEventListener('click',()=>showPage(button.dataset.page)));

  async function initCloud() {
    const cfg=window.CCU_FIREBASE_CONFIG||{}; if(!cfg.apiKey||!cfg.projectId)return;
    try {
      const appApi=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      const authApi=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
      const dbApi=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      const app=appApi.initializeApp(cfg);cloud.auth=authApi.getAuth(app);cloud.db=dbApi.getFirestore(app);cloud.api={...authApi,...dbApi};cloud.configured=true;
      authApi.onAuthStateChanged(cloud.auth,async(user)=>{cloud.user=user||null;$('#cloud-login').textContent=user?user.email:'Connexion Google';renderSettings();if(user)await cloudPull();});
    } catch(error){console.warn(error);toast('Firebase non disponible ; le mode local reste actif.',true);}
  }
  async function cloudLogin(){if(!cloud.configured)throw new Error('Renseignez firebase-config.js puis déployez l’application.');if(cloud.user){await cloudPush();toast('Synchronisation terminée.');return;}const provider=new cloud.api.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await cloud.api.signInWithPopup(cloud.auth,provider);}
  async function cloudLogout(){if(cloud.auth)await cloud.api.signOut(cloud.auth);cloud.user=null;renderSettings();toast('Déconnecté de Google.');}
  function cloudRef(){return cloud.api.doc(cloud.db,'users',cloud.user.uid,'states','main');}
  async function cloudPull(){if(!cloud.user)return;const snap=await cloud.api.getDoc(cloudRef());if(!snap.exists()){await cloudPush();return;}const remote=snap.data().state;const remoteDate=new Date(remote?.meta?.updatedAt||0);const localDate=new Date(state.meta.updatedAt||0);if(remote&&remoteDate>localDate&&confirm('Une sauvegarde Google plus récente existe. La charger sur cet appareil ?')){const check=Core.validateState(remote);if(check.valid){state=remote;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));renderAll();toast('Sauvegarde Google chargée.');}}}
  async function cloudPush(){if(!cloud.user||!cloud.api)return;await cloud.api.setDoc(cloudRef(),{state,updatedAt:new Date().toISOString()});state.settings.lastCloudSync=new Date().toISOString();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));$('#save-status').textContent=`Synchronisé · ${cloud.user.email}`;}
  function scheduleCloudPush(){if(!cloud.user||!cloud.api)return;clearTimeout(cloud.syncTimer);cloud.syncTimer=setTimeout(()=>cloudPush().catch((e)=>toast(`Sync: ${e.message}`,true)),900);}

  window.addEventListener('beforeinstallprompt',(event)=>{event.preventDefault();deferredInstall=event;$('#install-app').classList.remove('hidden');});
  $('#install-app').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#install-app').classList.add('hidden');});
  $('#cloud-login').addEventListener('click',()=>cloudLogin().catch((e)=>toast(e.message,true)));
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.warn));

  renderAll(); initCloud();
})();
