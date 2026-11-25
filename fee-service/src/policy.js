export const POLICY_VERSION = 'mulch-2026-11-24-280-150-50';
export const TIERS = Object.freeze([
  Object.freeze({ name: 'Launch', thresholdMinor: '0', basisPoints: 280, rate: '2.8%' }),
  Object.freeze({ name: 'Growth', thresholdMinor: '5000000', basisPoints: 150, rate: '1.5%' }),
  Object.freeze({ name: 'Scale', thresholdMinor: '25000000', basisPoints: 50, rate: '0.5%' })
]);
export class FeeError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function minor(value, label = 'amount') {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) {
    throw new FeeError('invalid_minor', `${label} must be a nonnegative integer-cent string.`);
  }
  const result = BigInt(value);
  if (result > 9223372036854775807n) throw new FeeError('amount_too_large', `${label} exceeds the ledger range.`);
  return result;
}
export function decimalMinor(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/.test(value)) {
    throw new FeeError('invalid_money', 'Provider USD money must be an exact nonnegative decimal string.');
  }
  const [whole, fraction = ''] = value.split('.');
  return minor((BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString());
}
export function moneyMinor(value) {
  if (!value || value.currency !== 'usd' || value.decimals !== 2) {
    throw new FeeError('unsupported_currency', 'Only USD with two decimal places is supported in this release.');
  }
  return decimalMinor(value.amount);
}
export function major(value) {
  const cents = minor(value);
  if (cents > 1000000000000n) throw new FeeError('amount_too_large', 'Individual payments above $10 billion are unsupported.');
  return Number(cents) / 100;
}
export function tierFor(volumeMinor) {
  const volume = minor(volumeMinor, 'lifetime volume');
  return [...TIERS].reverse().find(tier => volume >= BigInt(tier.thresholdMinor));
}
export function feeFor({ lifetimeMinor, grossMinor, earnedBasisPoints = 280 }) {
  const lifetime = minor(lifetimeMinor, 'lifetime volume');
  const gross = minor(grossMinor, 'gross payment');
  if (gross === 0n) throw new FeeError('free_payment', 'A zero-value payment has no per-sale fee.');
  if (![280, 150, 50].includes(earnedBasisPoints)) throw new FeeError('invalid_tier', 'Stored tier must be a supported earned rate.');
  const after = lifetime + gross;
  minor(after.toString(), 'projected lifetime volume');
  const selected = tierFor(after.toString());
  const basisPoints = Math.min(selected.basisPoints, earnedBasisPoints);
  const fee = (gross * BigInt(basisPoints) + 5000n) / 10000n;
  if (fee <= 0n || fee >= gross) {
    throw new FeeError('fee_not_collectible', 'This payment is too small for a positive rounded per-sale application fee.');
  }
  return {
    policyVersion: POLICY_VERSION, currency: 'usd', basis: 'customer_amount_including_tax_before_processing_fees',
    lifetimeBeforeMinor: lifetime.toString(), lifetimeAfterMinor: after.toString(),
    grossMinor: gross.toString(), feeMinor: fee.toString(), basisPoints,
    rate: TIERS.find(tier => tier.basisPoints === basisPoints).rate,
    tier: TIERS.find(tier => tier.basisPoints === basisPoints).name,
    thresholdCrossed: selected.basisPoints < tierFor(lifetime.toString()).basisPoints
  };
}
