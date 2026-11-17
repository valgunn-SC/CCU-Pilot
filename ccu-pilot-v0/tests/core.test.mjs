import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, slugCandidates, vatBreakdown, catalogEntryFromApi,
  generateOwnedPath, reservedIds, chainMetrics, sanitizeState, createEmptyState
} from '../core.mjs';

test('normalise les noms et propose un slug sans constructeur', () => {
  assert.equal(normalizeName('Aegis – Avenger Titan'), 'aegis avenger titan');
  assert.deepEqual(slugCandidates('Aegis Avenger Titan'), ['aegis-avenger-titan', 'avenger-titan']);
});

test('calcule la TVA à partir du TTC', () => {
  const result = vatBreakdown(120, 20);
  assert.equal(result.ht, 100);
  assert.equal(Math.round(result.vat), 20);
});

test('convertit la réponse publique en prix et disponibilité', () => {
  const entry = catalogEntryFromApi({
    name: 'Odyssey', slug: 'odyssey', msrp: 700,
    skus: [{ price: 700, available: true, is_warbond: false }, { price: 625, discounted_price: 625, available: true, is_warbond: true }],
    production_status: { en_EN: 'in-concept' }
  });
  assert.equal(entry.currentPrice, 700);
  assert.equal(entry.available, true);
  assert.equal(entry.warbondAvailable, true);
  assert.equal(entry.warbondPrice, 625);
});

test('génère une chaîne connectée et réserve chaque CCU une seule fois', () => {
  const state = createEmptyState();
  state.fleet = [{ id: 't1', shipName: 'Aurora MR', paidAmount: 40, fundingType: 'cash', tokenType: 'standard' }];
  state.ccus = [
    { id: 'c1', fromShip: 'Aurora MR', toShip: 'Avenger Titan', paidAmount: 15, fundingType: 'credit', active: true },
    { id: 'c2', fromShip: 'Avenger Titan', toShip: 'Prospector', paidAmount: 100, fundingType: 'cash', active: true }
  ];
  state.catalog = {
    'aurora mr': { name: 'Aurora MR', currentPrice: 45 },
    'avenger titan': { name: 'Avenger Titan', currentPrice: 60 },
    prospector: { name: 'Prospector', currentPrice: 155 }
  };
  const path = generateOwnedPath(state, 't1', 'Prospector');
  assert.equal(path.exact, true);
  assert.deepEqual(path.ccuIds, ['c1', 'c2']);
  state.chains.push({ id: 'ch1', tokenId: 't1', targetShip: 'Prospector', ccuIds: path.ccuIds });
  const reserved = reservedIds(state);
  assert.equal(reserved.tokenIds.has('t1'), true);
  assert.equal(reserved.ccuIds.has('c2'), true);
  assert.throws(() => generateOwnedPath(state, 't1', 'Prospector'), /déjà réservé/);
});

test('hérite du statut non meltable du token Referral', () => {
  const state = createEmptyState();
  state.fleet = [{ id: 't1', shipName: 'Dragonfly', tokenType: 'referral', meltable: false, paidAmount: 0, fundingType: 'historical' }];
  state.catalog = { galaxy: { name: 'Galaxy', currentPrice: 380 } };
  const metrics = chainMetrics(state, { tokenId: 't1', targetShip: 'Galaxy', ccuIds: [] });
  assert.equal(metrics.nonMeltable, true);
  assert.equal(metrics.currentValue, 380);
});

test('importe un format V0 simplifié', () => {
  const state = sanitizeState({ tokens: [{ name: 'Cutter', cost: 45 }], upgrades: [{ from: 'Cutter', to: 'C1 Spirit', paid: 65 }] });
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.fleet[0].shipName, 'Cutter');
  assert.equal(state.ccus[0].toShip, 'C1 Spirit');
});
