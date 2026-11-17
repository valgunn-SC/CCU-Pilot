export const APP_VERSION = '1.0.0';

export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function slugifyShipName(value = '') {
  return normalizeName(value).replace(/\s+/g, '-');
}

const MANUFACTURERS = [
  'aegis dynamics', 'aegis', 'anvil aerospace', 'anvil', 'argo astronautics', 'argo',
  'banu', 'consolidated outland', 'cnou', 'crusader industries', 'crusader', 'drake interplanetary',
  'drake', 'esperia', 'gatac manufacture', 'gatac', 'greycat industrial', 'greycat',
  'kruger intergalactic', 'kruger', 'musashi industrial and starlight concern', 'misc', 'mirai',
  'origin jumpworks', 'origin', 'roberts space industries', 'rsi', 'tumbril land systems', 'tumbril',
  'vanduul', 'xi an', 'xian'
];

export function slugCandidates(value = '') {
  const normalized = normalizeName(value);
  const values = [slugifyShipName(normalized)];
  for (const manufacturer of MANUFACTURERS) {
    if (normalized.startsWith(`${manufacturer} `)) {
      values.push(slugifyShipName(normalized.slice(manufacturer.length + 1)));
    }
  }
  return [...new Set(values.filter(Boolean))];
}

export function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2
  }).format(Number.isFinite(number) ? number : 0);
}

export function vatBreakdown(ttc, rate = 20) {
  const total = Number(ttc || 0);
  const divisor = 1 + Number(rate || 0) / 100;
  const beforeTax = divisor > 0 ? total / divisor : total;
  return { ttc: total, ht: beforeTax, vat: total - beforeTax };
}

export function catalogEntryFromApi(data = {}) {
  const skus = Array.isArray(data.skus) ? data.skus : [];
  const activeSkus = skus.filter((sku) => sku?.available === true);
  const standard = activeSkus.find((sku) => !sku?.is_warbond) || skus.find((sku) => !sku?.is_warbond);
  const warbond = activeSkus.find((sku) => sku?.is_warbond === true);
  const localized = (field) => field?.fr_FR || field?.en_EN || field || '';
  return {
    key: normalizeName(data.name || data.slug),
    name: data.name || data.slug || 'Inconnu',
    slug: data.slug || slugifyShipName(data.name),
    manufacturer: data.manufacturer?.name || data.manufacturer?.code || '',
    msrp: Number(data.msrp ?? standard?.price ?? 0),
    currentPrice: Number(standard?.discounted_price ?? standard?.price ?? data.msrp ?? 0),
    available: activeSkus.length > 0,
    warbondAvailable: Boolean(warbond),
    warbondPrice: Number(warbond?.discounted_price ?? warbond?.price ?? 0),
    productionStatus: localized(data.production_status),
    pledgeUrl: data.pledge_url || '',
    sourceUpdatedAt: data.updated_at || null,
    fetchedAt: new Date().toISOString()
  };
}

export function findCatalogEntry(catalog = {}, name = '') {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  if (catalog[wanted]) return catalog[wanted];
  const values = Object.values(catalog);
  return values.find((entry) => normalizeName(entry.name) === wanted || normalizeName(entry.slug) === wanted) || null;
}

export function fleetValue(state) {
  return (state.fleet || []).reduce((sum, item) => {
    const entry = findCatalogEntry(state.catalog, item.shipName);
    return sum + Number(entry?.currentPrice || entry?.msrp || item.currentValue || 0);
  }, 0);
}

export function reservedIds(state) {
  const tokenIds = new Set();
  const ccuIds = new Set();
  for (const chain of state.chains || []) {
    if (chain.tokenId) tokenIds.add(chain.tokenId);
    for (const id of chain.ccuIds || []) ccuIds.add(id);
  }
  return { tokenIds, ccuIds };
}

function ccuDestinationValue(ccu, catalog) {
  const target = findCatalogEntry(catalog, ccu.toShip);
  return Number(target?.currentPrice || target?.msrp || ccu.toValue || 0);
}

export function generateOwnedPath(state, tokenId, targetShip) {
  const token = (state.fleet || []).find((item) => item.id === tokenId);
  if (!token) throw new Error('Token de départ introuvable.');
  const targetKey = normalizeName(targetShip);
  if (!targetKey) throw new Error('Cible obligatoire.');

  const reservations = reservedIds(state);
  if (reservations.tokenIds.has(tokenId)) throw new Error('Ce token est déjà réservé dans une autre chaîne.');

  if (normalizeName(token.shipName) === targetKey) {
    const value = Number(findCatalogEntry(state.catalog, targetShip)?.currentPrice || token.currentValue || 0);
    return { exact: true, reachedShip: token.shipName, ccuIds: [], ownedPaid: 0, cash: 0, credit: 0, gapValue: 0, targetValue: value, reachedValue: value };
  }

  const edges = (state.ccus || []).filter((ccu) => !reservations.ccuIds.has(ccu.id) && ccu.active !== false);
  const targetCatalogValue = Number(findCatalogEntry(state.catalog, targetShip)?.currentPrice || findCatalogEntry(state.catalog, targetShip)?.msrp || 0);
  const queue = [{ ship: token.shipName, ids: [], paid: 0, cash: 0, credit: 0 }];
  const visited = new Map([[normalizeName(token.shipName), 0]]);
  let best = queue[0];
  let exact = null;

  while (queue.length && !exact) {
    const current = queue.shift();
    const currentValue = findCatalogEntry(state.catalog, current.ship)?.currentPrice || 0;
    const bestValue = findCatalogEntry(state.catalog, best.ship)?.currentPrice || 0;
    if (currentValue > bestValue || (currentValue === bestValue && current.ids.length > best.ids.length)) best = current;

    for (const ccu of edges) {
      if (current.ids.includes(ccu.id)) continue;
      if (normalizeName(ccu.fromShip) !== normalizeName(current.ship)) continue;
      const destinationValue = ccuDestinationValue(ccu, state.catalog);
      if (targetCatalogValue > 0 && destinationValue > targetCatalogValue) continue;
      const nextKey = normalizeName(ccu.toShip);
      const paid = Number(ccu.paidAmount || 0);
      const next = {
        ship: ccu.toShip,
        ids: [...current.ids, ccu.id],
        paid: current.paid + paid,
        cash: current.cash + (ccu.fundingType === 'cash' ? paid : 0),
        credit: current.credit + (ccu.fundingType === 'credit' ? paid : 0)
      };
      if (nextKey === targetKey) { exact = next; break; }
      const knownLength = visited.get(nextKey);
      if (knownLength == null || next.ids.length < knownLength) {
        visited.set(nextKey, next.ids.length);
        queue.push(next);
      }
    }
  }

  const result = exact || best;
  const targetEntry = findCatalogEntry(state.catalog, targetShip);
  const reachedEntry = findCatalogEntry(state.catalog, result.ship);
  const targetValue = Number(targetEntry?.currentPrice || targetEntry?.msrp || 0);
  const reachedValue = Number(reachedEntry?.currentPrice || reachedEntry?.msrp || token.currentValue || 0);
  return {
    exact: Boolean(exact),
    reachedShip: result.ship,
    ccuIds: result.ids,
    ownedPaid: result.paid,
    cash: result.cash,
    credit: result.credit,
    gapValue: Math.max(0, targetValue - reachedValue),
    targetValue,
    reachedValue
  };
}

export function chainMetrics(state, chain) {
  const token = (state.fleet || []).find((item) => item.id === chain.tokenId);
  const ccus = (chain.ccuIds || []).map((id) => (state.ccus || []).find((ccu) => ccu.id === id)).filter(Boolean);
  const target = findCatalogEntry(state.catalog, chain.targetShip);
  const paidItems = [token, ...ccus].filter(Boolean);
  const paid = paidItems.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  const cash = paidItems.reduce((sum, item) => sum + (item.fundingType === 'cash' ? Number(item.paidAmount || 0) : 0), 0);
  const credit = paidItems.reduce((sum, item) => sum + (item.fundingType === 'credit' ? Number(item.paidAmount || 0) : 0), 0);
  const currentValue = Number(target?.currentPrice || target?.msrp || chain.targetValue || 0);
  const nonMeltable = Boolean(token && (token.tokenType === 'giveaway' || token.tokenType === 'referral' || token.meltable === false));
  const speculative = ccus.some((ccu) => ccu.speculative);
  return { paid, cash, credit, currentValue, saving: currentValue - paid, nonMeltable, speculative };
}

export function createEmptyState() {
  return {
    schemaVersion: 2,
    appVersion: APP_VERSION,
    updatedAt: new Date().toISOString(),
    settings: { vatRate: 20, autoRefreshHours: 12 },
    wallet: { storeCredit: 0 },
    fleet: [],
    ccus: [],
    chains: [],
    catalog: {},
    catalogMeta: { lastRefreshAt: null, source: 'Star Citizen Wiki API / données RSI', lastError: null }
  };
}

export function sanitizeState(input) {
  const base = createEmptyState();
  if (!input || typeof input !== 'object') return base;
  const candidate = input.state && typeof input.state === 'object' ? input.state : input;
  const fleet = Array.isArray(candidate.fleet) ? candidate.fleet : Array.isArray(candidate.tokens) ? candidate.tokens : [];
  const ccus = Array.isArray(candidate.ccus) ? candidate.ccus : Array.isArray(candidate.upgrades) ? candidate.upgrades : [];
  const chains = Array.isArray(candidate.chains) ? candidate.chains : [];
  return {
    ...base,
    ...candidate,
    schemaVersion: 2,
    settings: { ...base.settings, ...(candidate.settings || {}) },
    wallet: { ...base.wallet, ...(candidate.wallet || {}) },
    fleet: fleet.map((item) => ({ id: item.id || uid('ship'), shipName: item.shipName || item.name || item.ship || '', tokenType: item.tokenType || item.type || 'standard', fundingType: item.fundingType || 'historical', meltable: item.meltable !== false, paidAmount: Number(item.paidAmount ?? item.paid ?? item.cost ?? 0), currentValue: Number(item.currentValue ?? item.value ?? 0), insurance: item.insurance || '' })),
    ccus: ccus.map((item) => ({ id: item.id || uid('ccu'), fromShip: item.fromShip || item.from || item.source || '', toShip: item.toShip || item.to || item.target || '', paidAmount: Number(item.paidAmount ?? item.paid ?? item.cost ?? 0), fundingType: item.fundingType || 'historical', warbond: Boolean(item.warbond), speculative: Boolean(item.speculative), active: item.active !== false })),
    chains,
    catalog: candidate.catalog && typeof candidate.catalog === 'object' ? candidate.catalog : {},
    catalogMeta: { ...base.catalogMeta, ...(candidate.catalogMeta || {}) },
    updatedAt: candidate.updatedAt || base.updatedAt
  };
}
