import test from 'node:test';
import assert from 'node:assert/strict';
import { feeFor, decimalMinor, moneyMinor, major, minor, tierFor } from '../src/policy.js';
const calculate = (lifetimeMinor,grossMinor,earnedBasisPoints=280) => feeFor({lifetimeMinor,grossMinor,earnedBasisPoints});
for (const [name,before,gross,bps,fee] of [
  ['tax-inclusive Launch example','0','10800',280,'302'],
  ['tax-inclusive Growth example','5000000','10800',150,'162'],
  ['tax-inclusive Scale example','25000000','10800',50,'54'],
  ['just below first threshold','4999800','100',280,'3'],
  ['exact first threshold crossing','4999900','100',150,'2'],
  ['crossing first threshold uses whole charge','4995000','10800',150,'162'],
  ['just below second threshold','24999800','100',150,'2'],
  ['exact second threshold crossing','24999900','100',50,'1'],
  ['crossing both thresholds uses Scale on whole charge','0','25000000',50,'125000'],
  ['earned Growth never returns to Launch','0','10800',150,'162'],
  ['earned Scale never returns to Growth','5000000','10800',50,'54']
]) test(name,() => { const result=calculate(before,gross,name.startsWith('earned') ? bps : 280); assert.equal(result.basisPoints,bps); assert.equal(result.feeMinor,fee); assert.equal(BigInt(result.lifetimeAfterMinor),BigInt(before)+BigInt(gross)); });
test('money parsing preserves exact cents',() => { assert.equal(decimalMinor('108.00'),10800n); assert.equal(decimalMinor('0.54'),54n); assert.equal(major('302'),3.02); assert.equal(tierFor('25000000').rate,'0.5%'); });
for (const bad of ['-1','1.1','01',1,NaN,'9223372036854775808']) test(`minor validation rejects ${String(bad)}`,() => assert.throws(() => minor(bad)));
for (const bad of ['1e3','10.001','-1.00',108]) test(`exact decimal validation rejects ${String(bad)}`,() => assert.throws(() => decimalMinor(bad)));
test('unsupported currency fails closed',() => assert.throws(() => moneyMinor({currency:'eur',decimals:2,amount:'108.00'})));
test('zero and uncollectibly small payments cannot charge a fabricated minimum',() => { assert.throws(() => calculate('0','0')); assert.throws(() => calculate('25000000','1')); });
test('unsupported stored rate is not accepted',() => assert.throws(() => calculate('0','10800',100)));
test('deterministic boundary properties use exact projected volume and half-up cents',() => {
  for (const boundary of [0n,5000000n,25000000n]) for (const offset of [-500n,-1n,0n,1n,500n]) for (const gross of [100n,10800n,100000n]) {
    const before=boundary+offset;if(before<0n)continue;
    const result=calculate(before.toString(),gross.toString());const after=before+gross;
    const expected=after>=25000000n ? 50n : after>=5000000n ? 150n : 280n;
    assert.equal(result.basisPoints,Number(expected));assert.equal(result.feeMinor,((gross*expected+5000n)/10000n).toString());
  }
});
