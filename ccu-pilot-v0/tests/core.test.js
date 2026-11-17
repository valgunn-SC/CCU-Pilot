const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Core = require('../core.js');
const seedScript = fs.readFileSync(require('path').join(__dirname,'..','seed.js'),'utf8');
const sandbox = {window:{}}; vm.createContext(sandbox); vm.runInContext(seedScript,sandbox);
const seed = JSON.parse(JSON.stringify(sandbox.window.CCU_SEED));

assert.strictEqual(seed.chains.length,0,'Aucune chaîne pré-enregistrée');
assert.strictEqual(seed.tokens.length,12);
assert.strictEqual(seed.ccus.length,15);
assert.strictEqual(seed.tokens.filter(t=>t.type==='referral').length,2);
assert.ok(seed.tokens.filter(t=>t.type==='referral').every(t=>t.meltable===false));

const referral = seed.tokens.find(t=>t.type==='referral');
const chain = Core.generateChain(seed,{tokenId:referral.id,name:'Test referral',targetName:'Hermes',targetCurrentValue:220,targetEstimatedValue:240,includeSpeculative:true});
assert.strictEqual(chain.nonMeltable,true,'Referral => chaîne non meltable');
assert.ok(chain.ccuIds.length>0,'Picking de CCU disponible');
assert.ok(chain.totals.storeCreditTTC>=0);
assert.strictEqual(chain.totals.freshCashTTC,0);
assert.strictEqual(chain.targetCurrentValue,220);
assert.strictEqual(chain.targetEstimatedValue,240);

const saved = Core.saveChain(seed,chain);
assert.strictEqual(saved.chains.length,1);
assert.strictEqual(saved.tokens.find(t=>t.id===referral.id).usedBy,chain.id);
assert.ok(chain.ccuIds.every(id=>saved.ccus.find(c=>c.id===id).usedBy===chain.id));
assert.throws(()=>Core.generateChain(saved,{tokenId:referral.id,targetName:'X',targetCurrentValue:300}),/déjà affecté/);

const otherToken = saved.tokens.find(t=>!t.usedBy && t.currentValue < 220);
const secondPreview = Core.generateChain(saved,{tokenId:otherToken.id,targetName:'Hermes 2',targetCurrentValue:220});
assert.ok(secondPreview.ccuIds.every(id=>!chain.ccuIds.includes(id)),'Aucun CCU réservé réutilisé');

const released = Core.deleteChain(saved,chain.id);
assert.strictEqual(released.chains.length,0);
assert.strictEqual(released.tokens.find(t=>t.id===referral.id).usedBy,null);
assert.ok(chain.ccuIds.every(id=>released.ccus.find(c=>c.id===id).usedBy===null));

const standardToken = seed.tokens.find(t=>t.type==='standard' && t.currentValue===60);
const wb = Core.generateChain(seed,{tokenId:standardToken.id,name:'WB final',targetName:'Constellation MK V',targetCurrentValue:300,targetEstimatedValue:320,finalWb:{enabled:true,fromName:'Hermes',fromValue:220,cashCost:50}});
assert.strictEqual(wb.totals.freshCashTTC,50,'Warbond final séparé en argent frais');
assert.ok(wb.totals.storeCreditTTC>0,'Fillers en Store Credit');
assert.ok(wb.steps.some(s=>s.type==='warbond-final'));
assert.strictEqual(Core.vatSplit(120,20).vat,20);
assert.strictEqual(Core.vatSplit(120,20).ht,100);

const equalityInventory = [
  {id:'a',active:true,usedBy:null,fromName:'A',toName:'Galaxy',fromValue:350,toValue:400,paidHistorical:10},
  {id:'b',active:true,usedBy:null,fromName:'Railen',toName:'600i Touring',fromValue:400,toValue:435,paidHistorical:10},
  {id:'c',active:true,usedBy:null,fromName:'Galaxy',toName:'Cible compatible',fromValue:400,toValue:430,paidHistorical:10}
];
const equalityPick = Core.pickOptimalCCUs(equalityInventory,300,435,true,'Token');
assert.ok(!(equalityPick.some(c=>c.id==='a') && equalityPick.some(c=>c.id==='b')),'Pas de sidegrade impossible à valeur égale');
assert.ok(equalityPick.some(c=>c.id==='a') && equalityPick.some(c=>c.id==='c'),'Connexion directe autorisée si le nom correspond');

const invalid = Core.clone(saved); invalid.chains.push({...chain,id:'duplicate-chain',name:'Doublon'});
assert.strictEqual(Core.validateState(invalid).valid,false,'Détection réutilisation CCU');
console.log('OK — 20 assertions métier');
