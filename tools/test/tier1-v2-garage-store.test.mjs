import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSimModules } from './helpers.mjs';

let mods;
let garageStoreMod;

before(async () => {
  mods = await loadSimModules();
  garageStoreMod = await mods.server.ssrLoadModule('/src/ui/GarageStore.ts');
});

after(async () => {
  await mods?.close();
});

describe('Tier 1 (V2 M4) — GarageStore Economy, Persistence, Handling Bias & Cosmetics', () => {
  it('parses empty or corrupted storage safely and seeds unlocked vehicles + owned defaults', () => {
    const { parseGarageState, GarageStore } = garageStoreMod;
    const { PLAYER_VEHICLES, VEHICLE_COST } = mods.playerCar;

    const clean = parseGarageState(null, null, null, null);
    assert.equal(clean.bank, 0);
    for (const v of PLAYER_VEHICLES) {
      assert.equal(clean.builds[v].engine, 0);
      assert.equal(clean.builds[v].paint, 'stock');
      assert.equal(clean.builds[v].livery, 'none');
      assert.equal(clean.builds[v].underglow, 'none');
      assert.equal(clean.builds[v].horn, 'stock');
      assert.equal(clean.unlocked.has(v), VEHICLE_COST[v] === 0);
    }

    const corrupted = parseGarageState(
      'not-a-number',
      '{"alto":{"engine":99,"handling":-4,"handlingBias":9,"paint":"bogus","livery":42}}',
      '[{"bad":true}]',
      '"corrupt"',
    );
    const store = new GarageStore(corrupted, false);
    assert.equal(store.bank, 0);
    const alto = store.getBuild('alto');
    assert.equal(alto.engine, 3, 'engine tier should clamp cleanly to 3');
    assert.equal(alto.handling, 0, 'negative handling tier should clamp cleanly to 0');
    assert.equal(alto.handlingBias, 0, 'handlingBias must reset to 0 when handling === 0');
    assert.equal(alto.paint, 'stock');
    assert.equal(alto.livery, 'none');
    assert.equal(store.isVehicleUnlocked('alto'), true);
    assert.equal(store.isVehicleUnlocked('minibus'), false);
  });

  it('buys upgrade tiers, deducts exact cost, enforces max/funds, and keeps vehicles unlocked', () => {
    const { parseGarageState, GarageStore } = garageStoreMod;
    const { upgradeCost } = mods.upgrades;

    // Seed bank = 2000 so minibus (cost 1200) unlocks initially
    const store = new GarageStore(parseGarageState('2000', null, null, null), false);
    assert.equal(store.isVehicleUnlocked('minibus'), true);

    const e1Cost = upgradeCost('alto', 'engine', 1);
    const r1 = store.buyUpgrade('alto', 'engine');
    assert.deepEqual(r1, { ok: true, cost: e1Cost, newTier: 1 });
    assert.equal(store.bank, 2000 - e1Cost);

    const e2Cost = upgradeCost('alto', 'engine', 2);
    const r2 = store.buyUpgrade('alto', 'engine');
    assert.deepEqual(r2, { ok: true, cost: e2Cost, newTier: 2 });

    const e3Cost = upgradeCost('alto', 'engine', 3);
    const r3 = store.buyUpgrade('alto', 'engine');
    assert.deepEqual(r3, { ok: true, cost: e3Cost, newTier: 3 });

    // Maxed out -> rejected cleanly without charging bank
    const bankAfterEngine = store.bank;
    const r4 = store.buyUpgrade('alto', 'engine');
    assert.deepEqual(r4, { ok: false, reason: 'max', cost: 0 });
    assert.equal(store.bank, bankAfterEngine);

    // Bank is now below minibus cost (1200), yet minibus MUST remain unlocked
    assert.ok(store.bank < 1200, `Expected remaining bank < 1200, got ${store.bank}`);
    assert.equal(store.isVehicleUnlocked('minibus'), true, 'Spending Rs on upgrades must not re-lock minibus');

    // Next tier 2 nitrous (base 420 -> > remaining bank) rejects cleanly
    store.buyUpgrade('alto', 'nitrous'); // tier 1
    const lowStore = new GarageStore(parseGarageState('50', null, null, JSON.stringify(['alto', 'coupe', 'minibus'])), false);
    const lowRes = lowStore.buyUpgrade('coupe', 'engine');
    assert.equal(lowRes.ok, false);
    assert.equal(lowRes.reason, 'insufficient');
    assert.equal(lowStore.isVehicleUnlocked('rickshaw'), false);
    const lockedRes = lowStore.buyUpgrade('rickshaw', 'armor');
    assert.deepEqual(lockedRes, { ok: false, reason: 'locked', cost: 0 });
  });

  it('gates handling bias behind handling >= 1, rounds/clamps to [-1, 1], and shares owned cosmetics across vehicles', () => {
    const { parseGarageState, GarageStore } = garageStoreMod;
    const { VEHICLE_SHOWCASE, VEHICLE_SPECS } = mods.playerCar;
    const { applyUpgrades, cosmeticCost, deriveShowcaseMeta, maxIntegrityForBuild } = mods.upgrades;

    const store = new GarageStore(parseGarageState('2500', null, null, null), false);

    // Handling bias requires handling >= 1
    assert.equal(store.setHandlingBias('alto', 0.8), false);
    assert.equal(store.getBuild('alto').handlingBias, 0);

    // Install Handling tier 1 and Armor tier 2 -> tune bias to +2.4 (clamps to +1)
    assert.equal(store.buyUpgrade('alto', 'handling').ok, true);
    assert.equal(store.buyUpgrade('alto', 'armor').ok, true);
    assert.equal(store.buyUpgrade('alto', 'armor').ok, true);
    assert.equal(store.setHandlingBias('alto', 2.4), true);
    assert.equal(store.getBuild('alto').handlingBias, 1);
    assert.equal(store.setHandlingBias('alto', -0.44), true);
    assert.equal(store.getBuild('alto').handlingBias, -0.4);

    // Buy truck-art on alto, deduct cost once, then equip free on coupe
    const truckArtCost = cosmeticCost('livery', 'truck-art');
    const beforeCosmeticBank = store.bank;
    const buyLivery = store.selectOrBuyCosmetic('alto', 'livery', 'truck-art');
    assert.deepEqual(buyLivery, { ok: true, purchased: true, cost: truckArtCost });
    assert.equal(store.bank, beforeCosmeticBank - truckArtCost);
    assert.equal(store.isCosmeticOwned('livery', 'truck-art'), true);

    const equipFreeOnCoupe = store.selectOrBuyCosmetic('coupe', 'livery', 'truck-art');
    assert.deepEqual(equipFreeOnCoupe, { ok: true, purchased: false, cost: 0 });
    assert.equal(store.bank, beforeCosmeticBank - truckArtCost);

    const badCosmetic = store.selectOrBuyCosmetic('alto', 'paint', 'does-not-exist');
    assert.deepEqual(badCosmetic, { ok: false, purchased: false, reason: 'invalid', cost: 0 });

    // Derive showcase + sim integration verification
    const build = store.getBuild('alto');
    const meta = deriveShowcaseMeta('alto', VEHICLE_SHOWCASE.alto, build);
    assert.ok(meta.perfRating > VEHICLE_SHOWCASE.alto.perfRating);
    assert.ok(meta.customizationRating > VEHICLE_SHOWCASE.alto.customizationRating);
    assert.equal(maxIntegrityForBuild(build), 130);
    const tunedSpec = applyUpgrades('alto', VEHICLE_SPECS.alto, build);
    assert.ok(tunedSpec.damageRes < VEHICLE_SPECS.alto.damageRes);
  });
});
