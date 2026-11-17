(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CCUCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const round2 = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function vatSplit(ttc, vatRate) {
    const gross = round2(ttc);
    const rate = Math.max(0, number(vatRate));
    const net = rate ? round2(gross / (1 + rate / 100)) : gross;
    return { ttc: gross, ht: net, vat: round2(gross - net), rate };
  }

  function compareScore(a, b) {
    if (a.coverage !== b.coverage) return a.coverage - b.coverage;
    if (a.savings !== b.savings) return a.savings - b.savings;
    if (a.estimated !== b.estimated) return a.estimated - b.estimated;
    return b.count - a.count;
  }

  function pickOptimalCCUs(ccus, startValue, ceilingValue, includeSpeculative = true, startName = '') {
    const normalizedStartName = String(startName || '').trim().toLocaleLowerCase();
    const candidates = ccus
      .filter((c) => c.active !== false && !c.usedBy)
      .filter((c) => Number.isFinite(Number(c.fromValue)) && Number.isFinite(Number(c.toValue)))
      .filter((c) => number(c.fromValue) >= startValue && number(c.toValue) <= ceilingValue && number(c.toValue) > number(c.fromValue))
      .filter((c) => number(c.fromValue) > startValue || !normalizedStartName || String(c.fromName || '').trim().toLocaleLowerCase() === normalizedStartName)
      .filter((c) => includeSpeculative || !c.speculative)
      .map((c) => ({ ...c }))
      .sort((a, b) => number(a.toValue) - number(b.toValue) || number(a.fromValue) - number(b.fromValue));

    const empty = { coverage: 0, savings: 0, estimated: 0, count: 0, ids: [] };
    const endingAt = [];
    let best = empty;
    const sameName = (a, b) => String(a || '').trim().toLocaleLowerCase() === String(b || '').trim().toLocaleLowerCase();
    candidates.forEach((c, i) => {
      let base = empty;
      for (let j = 0; j < i; j++) {
        const previous = candidates[j];
        const hasPositiveFiller = number(previous.toValue) < number(c.fromValue);
        const directlyConnects = number(previous.toValue) === number(c.fromValue) && sameName(previous.toName, c.fromName);
        if ((hasPositiveFiller || directlyConnects) && compareScore(endingAt[j], base) > 0) base = endingAt[j];
      }
      const delta = number(c.toValue) - number(c.fromValue);
      const estimatedDelta = Math.max(0, number(c.estimatedToValue, number(c.toValue)) - number(c.toValue));
      endingAt[i] = {
        coverage: round2(base.coverage + delta),
        savings: round2(base.savings + Math.max(0, delta - number(c.paidHistorical))),
        estimated: round2(base.estimated + estimatedDelta),
        count: base.count + 1,
        ids: [...base.ids, c.id]
      };
      if (compareScore(endingAt[i], best) > 0) best = endingAt[i];
    });
    const selectedIds = new Set(best.ids);
    return candidates.filter((c) => selectedIds.has(c.id)).sort((a, b) => number(a.fromValue) - number(b.fromValue));
  }

  function generateChain(state, input) {
    const token = state.tokens.find((t) => t.id === input.tokenId);
    if (!token) throw new Error('Token de base introuvable.');
    if (token.usedBy) throw new Error('Ce token est déjà affecté à une autre chaîne.');
    const targetCurrentValue = number(input.targetCurrentValue, NaN);
    if (!Number.isFinite(targetCurrentValue) || targetCurrentValue <= number(token.currentValue)) {
      throw new Error('La valeur cible doit être supérieure à la valeur du token.');
    }
    const finalWb = input.finalWb && input.finalWb.enabled ? {
      enabled: true,
      fromName: String(input.finalWb.fromName || 'Départ Warbond').trim(),
      fromValue: number(input.finalWb.fromValue, NaN),
      cashCost: number(input.finalWb.cashCost, NaN)
    } : { enabled: false };
    if (finalWb.enabled && (!Number.isFinite(finalWb.fromValue) || finalWb.fromValue < number(token.currentValue) || finalWb.fromValue >= targetCurrentValue || !Number.isFinite(finalWb.cashCost) || finalWb.cashCost < 0)) {
      throw new Error('Le CCU Warbond final est incomplet ou incohérent.');
    }
    const ceiling = finalWb.enabled ? finalWb.fromValue : targetCurrentValue;
    const picked = pickOptimalCCUs(state.ccus, number(token.currentValue), ceiling, input.includeSpeculative !== false, token.name);
    const steps = [];
    steps.push({
      id: uid('step'), type: 'token', label: 'Token de base', fromName: '—', toName: token.name,
      fromValue: 0, toValue: number(token.currentValue), historicalTTC: number(token.paidHistorical),
      storeCreditTTC: 0, freshCashTTC: 0, ccuId: null
    });
    let currentName = token.name;
    let currentValue = number(token.currentValue);
    picked.forEach((ccu) => {
      const fromValue = number(ccu.fromValue);
      if (fromValue > currentValue) {
        steps.push({
          id: uid('step'), type: 'filler', label: 'CCU standard à acheter', fromName: currentName, toName: ccu.fromName,
          fromValue: currentValue, toValue: fromValue, historicalTTC: 0,
          storeCreditTTC: round2(fromValue - currentValue), freshCashTTC: 0, ccuId: null
        });
      }
      steps.push({
        id: uid('step'), type: ccu.speculative ? 'owned-speculative' : 'owned', label: ccu.speculative ? 'CCU possédé spéculatif' : 'CCU possédé',
        fromName: ccu.fromName, toName: ccu.toName, fromValue, toValue: number(ccu.toValue),
        estimatedToValue: number(ccu.estimatedToValue, number(ccu.toValue)), historicalTTC: number(ccu.paidHistorical),
        storeCreditTTC: 0, freshCashTTC: 0, ccuId: ccu.id, warbond: Boolean(ccu.warbond), risk: ccu.risk || 'moyen'
      });
      currentName = ccu.toName;
      currentValue = number(ccu.toValue);
    });
    if (finalWb.enabled) {
      if (currentValue > finalWb.fromValue) throw new Error('La route calculée dépasse le départ du Warbond final.');
      if (currentValue < finalWb.fromValue) {
        steps.push({
          id: uid('step'), type: 'filler', label: 'CCU standard à acheter', fromName: currentName, toName: finalWb.fromName,
          fromValue: currentValue, toValue: finalWb.fromValue, historicalTTC: 0,
          storeCreditTTC: round2(finalWb.fromValue - currentValue), freshCashTTC: 0, ccuId: null
        });
      }
      steps.push({
        id: uid('step'), type: 'warbond-final', label: 'CCU Warbond final', fromName: finalWb.fromName,
        toName: String(input.targetName || 'Cible').trim(), fromValue: finalWb.fromValue, toValue: targetCurrentValue,
        historicalTTC: 0, storeCreditTTC: 0, freshCashTTC: finalWb.cashCost, ccuId: null, warbond: true
      });
    } else if (currentValue < targetCurrentValue) {
      steps.push({
        id: uid('step'), type: 'filler', label: 'CCU standard final', fromName: currentName,
        toName: String(input.targetName || 'Cible').trim(), fromValue: currentValue, toValue: targetCurrentValue,
        historicalTTC: 0, storeCreditTTC: round2(targetCurrentValue - currentValue), freshCashTTC: 0, ccuId: null
      });
    }
    const historicalTTC = round2(steps.reduce((s, x) => s + number(x.historicalTTC), 0));
    const storeCreditTTC = round2(steps.reduce((s, x) => s + number(x.storeCreditTTC), 0));
    const freshCashTTC = round2(steps.reduce((s, x) => s + number(x.freshCashTTC), 0));
    const effectiveCostTTC = round2(historicalTTC + storeCreditTTC + freshCashTTC);
    const targetEstimatedValue = Math.max(targetCurrentValue, number(input.targetEstimatedValue, targetCurrentValue));
    const nonMeltable = token.meltable === false || ['gift', 'referral'].includes(token.type);
    const vat = vatSplit(effectiveCostTTC, state.settings.vatRate);
    return {
      id: uid('chain'), name: String(input.name || `${token.name} → ${input.targetName || 'Cible'}`).trim(),
      tokenId: token.id, tokenName: token.name, targetName: String(input.targetName || 'Cible').trim(),
      targetCurrentValue, targetEstimatedValue, createdAt: new Date().toISOString(), status: 'planifiée',
      nonMeltable, nonMeltableReason: nonMeltable ? (token.type === 'referral' ? 'Token Referral Reward' : token.type === 'gift' ? 'Gift CIG' : 'Token non meltable') : '',
      ccuIds: picked.map((c) => c.id), steps, totals: {
        historicalTTC, storeCreditTTC, freshCashTTC, effectiveCostTTC,
        currentSavings: round2(targetCurrentValue - effectiveCostTTC),
        estimatedSavings: round2(targetEstimatedValue - effectiveCostTTC),
        vatTTC: vat.ttc, vatHT: vat.ht, vatAmount: vat.vat
      }
    };
  }

  function saveChain(state, chain) {
    const next = clone(state);
    if (next.chains.some((c) => c.id === chain.id)) throw new Error('Cette chaîne est déjà enregistrée.');
    const token = next.tokens.find((t) => t.id === chain.tokenId);
    if (!token || token.usedBy) throw new Error('Le token a été affecté entre-temps.');
    for (const id of chain.ccuIds) {
      const ccu = next.ccus.find((c) => c.id === id);
      if (!ccu || ccu.usedBy) throw new Error('Un CCU sélectionné a été affecté entre-temps.');
    }
    token.usedBy = chain.id;
    chain.ccuIds.forEach((id) => { next.ccus.find((c) => c.id === id).usedBy = chain.id; });
    next.chains.push(clone(chain));
    next.meta.updatedAt = new Date().toISOString();
    return next;
  }

  function deleteChain(state, chainId) {
    const next = clone(state);
    next.chains = next.chains.filter((c) => c.id !== chainId);
    next.tokens.forEach((t) => { if (t.usedBy === chainId) t.usedBy = null; });
    next.ccus.forEach((c) => { if (c.usedBy === chainId) c.usedBy = null; });
    next.meta.updatedAt = new Date().toISOString();
    return next;
  }

  function portfolioTotals(state) {
    const totals = state.chains.reduce((acc, c) => {
      acc.storeCredit += number(c.totals.storeCreditTTC);
      acc.freshCash += number(c.totals.freshCashTTC);
      acc.historical += number(c.totals.historicalTTC);
      acc.currentValue += number(c.targetCurrentValue);
      acc.estimatedValue += number(c.targetEstimatedValue);
      return acc;
    }, { storeCredit: 0, freshCash: 0, historical: 0, currentValue: 0, estimatedValue: 0 });
    Object.keys(totals).forEach((k) => { totals[k] = round2(totals[k]); });
    totals.storeCreditRemaining = round2(number(state.settings.storeCreditBalance) - totals.storeCredit);
    totals.effectiveCost = round2(totals.storeCredit + totals.freshCash + totals.historical);
    totals.currentSavings = round2(totals.currentValue - totals.effectiveCost);
    totals.estimatedSavings = round2(totals.estimatedValue - totals.effectiveCost);
    return totals;
  }

  function validateState(state) {
    const errors = [];
    const tokenIds = new Set(); const ccuIds = new Set(); const chainIds = new Set();
    state.tokens.forEach((t) => { if (tokenIds.has(t.id)) errors.push(`Token dupliqué: ${t.id}`); tokenIds.add(t.id); });
    state.ccus.forEach((c) => { if (ccuIds.has(c.id)) errors.push(`CCU dupliqué: ${c.id}`); ccuIds.add(c.id); });
    state.chains.forEach((c) => {
      if (chainIds.has(c.id)) errors.push(`Chaîne dupliquée: ${c.id}`); chainIds.add(c.id);
      if (!tokenIds.has(c.tokenId)) errors.push(`Token manquant pour ${c.name}`);
      c.ccuIds.forEach((id) => { if (!ccuIds.has(id)) errors.push(`CCU manquant ${id} pour ${c.name}`); });
    });
    const used = new Map();
    state.chains.forEach((c) => c.ccuIds.forEach((id) => {
      if (used.has(id)) errors.push(`CCU ${id} réutilisé dans ${used.get(id)} et ${c.name}`); else used.set(id, c.name);
    }));
    return { valid: errors.length === 0, errors };
  }

  return { clone, number, round2, uid, vatSplit, pickOptimalCCUs, generateChain, saveChain, deleteChain, portfolioTotals, validateState };
});
