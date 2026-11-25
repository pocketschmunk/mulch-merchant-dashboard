import { randomUUID } from 'node:crypto';
import { FeeError, POLICY_VERSION, minor } from './policy.js';
const REPLAY_MS = 5 * 60 * 1000;
const LEASE_MS = 30 * 1000;
export class Repository {
  constructor(pool) { this.pool = pool; }
  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await work(client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async getStore(id, client = this.pool) {
    const result = await client.query('SELECT * FROM mulch_fee_stores WHERE id=$1', [id]);
    if (!result.rows[0]) throw new FeeError('store_not_found', 'Store is not registered.', 404);
    return result.rows[0];
  }
  async register(input) {
    const { id, merchant_id, shop_domain, login_email, country } = input;
    await this.pool.query(`INSERT INTO mulch_fee_stores(id,merchant_id,shop_domain,login_email,country)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, [id, merchant_id, shop_domain, login_email, country]);
    const store = await this.getStore(id);
    if (store.merchant_id !== merchant_id || store.shop_domain !== shop_domain || store.login_email !== login_email || store.country !== country) {
      throw new FeeError('store_conflict', 'This store registration already exists with different verified ownership data.', 409);
    }
    return store;
  }
  async readiness(id, input) {
    if (input.consent_policy_version !== POLICY_VERSION) throw new FeeError('consent_version_mismatch','Merchant consent must cover the current fee policy.',409);
    return this.transaction(async client => {
      await client.query('SELECT id FROM mulch_fee_stores WHERE id=$1 FOR UPDATE', [id]);
      const store = await this.getStore(id, client);
      if (store.pending_attempt_id) throw new FeeError('store_busy', 'Readiness cannot change during an unresolved payment.', 409);
      await client.query(`UPDATE mulch_fee_stores SET access_verified=$2,shopify_verified=$3,
        store_review_approved=$4,consent_reference=$5,product_id=$6,consent_policy_version=$7,updated_at=now() WHERE id=$1`,
      [id,input.access_verified,input.shopify_verified,input.store_review_approved,input.consent_reference,input.product_id,input.consent_policy_version]);
      return this.getStore(id, client);
    });
  }
  async bindAccount(id, accountId) {
    return this.transaction(async client => {
      await client.query('SELECT id FROM mulch_fee_stores WHERE id=$1 FOR UPDATE', [id]);
      const store = await this.getStore(id, client);
      if (store.account_id && store.account_id !== accountId) throw new FeeError('account_conflict', 'An account is already bound. Support review is required.', 409);
      await client.query('UPDATE mulch_fee_stores SET account_id=$2,updated_at=now() WHERE id=$1', [id, accountId]);
      return this.getStore(id, client);
    });
  }
  async setProviderVerified(id, verified) {
    await this.pool.query('UPDATE mulch_fee_stores SET provider_verified=$2,updated_at=now() WHERE id=$1', [id, verified]);
    return this.getStore(id);
  }
  async getAttempt(id, client = this.pool, lock = false) {
    const result = await client.query(`SELECT * FROM mulch_fee_attempts WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!result.rows[0]) throw new FeeError('attempt_not_found', 'Payment command is not registered.', 404);
    return result.rows[0];
  }
  async lockedAttempt(id, client) {
    const original = await this.getAttempt(id,client);
    await client.query('SELECT id FROM mulch_fee_stores WHERE id=$1 FOR UPDATE',[original.store_id]);
    return this.getAttempt(id,client,true);
  }
  async start(id, key, hash, orderReference) {
    return this.transaction(async client => {
      await client.query('SELECT id FROM mulch_fee_stores WHERE id=$1 FOR UPDATE', [id]);
      const store = await this.getStore(id, client);
      const existing = (await client.query('SELECT * FROM mulch_fee_attempts WHERE store_id=$1 AND command_key=$2', [id,key])).rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new FeeError('idempotency_conflict', 'A command key cannot be reused for another purchase.', 409);
        return {store,attempt:existing,created:false};
      }
      const duplicate = await client.query("SELECT id FROM mulch_fee_attempts WHERE store_id=$1 AND order_reference=$2 AND status <> 'failed'",[id,orderReference]);
      if (duplicate.rows.length) throw new FeeError('duplicate_order','This order already has a payment command. Reconcile the original command.',409);
      if (store.pending_attempt_id) throw new FeeError('store_busy', 'Another payment is unresolved; reconcile it before starting a new one.', 409);
      if (!store.account_id || !store.product_id || !store.provider_verified || store.fee_review_required || !store.access_verified || !store.shopify_verified || !store.store_review_approved || !store.consent_reference || store.consent_policy_version !== POLICY_VERSION) {
        throw new FeeError('store_not_ready', 'Verified plan access, Shopify, store review, current fee consent, product and connected payments without an unresolved review are required.', 409);
      }
      const attemptId = randomUUID();
      await client.query(`INSERT INTO mulch_fee_attempts(id,store_id,command_key,request_hash,order_reference,policy_version,status)
        VALUES($1,$2,$3,$4,$5,$6,'quoting')`, [attemptId,id,key,hash,orderReference,POLICY_VERSION]);
      await client.query('UPDATE mulch_fee_stores SET pending_attempt_id=$2,updated_at=now() WHERE id=$1', [id,attemptId]);
      return {store,attempt:await this.getAttempt(attemptId,client),created:true};
    });
  }
  async prepare(id, quoteId, taxMinor, calculation, ciphertext, expiresAt) {
    await this.pool.query(`UPDATE mulch_fee_attempts SET quote_id=$2,tax_minor=$3,gross_minor=$4,
      fee_minor=$5,basis_points=$6,payload_ciphertext=$7,quote_expires_at=$8,status='prepared',updated_at=now()
      WHERE id=$1 AND status='quoting'`, [id,quoteId,taxMinor,calculation.grossMinor,calculation.feeMinor,calculation.basisPoints,ciphertext,expiresAt]);
    return this.getAttempt(id);
  }
  async claim(id) {
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      if (!['prepared','unknown','submitting'].includes(attempt.status) || attempt.payment_id) return null;
      const replayed = Boolean(attempt.first_submit_at);
      if (replayed && Date.now()-new Date(attempt.first_submit_at).getTime() > REPLAY_MS) {
        await client.query("UPDATE mulch_fee_attempts SET status='unknown',issue='manual_reconciliation_required',payload_ciphertext=NULL,updated_at=now() WHERE id=$1",[id]);
        return null; // Retain the store slot. Expiry never implies no charge.
      }
      if (attempt.status === 'submitting' && Date.now()-new Date(attempt.updated_at).getTime() < LEASE_MS) return null;
      if (!replayed && new Date(attempt.quote_expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE mulch_fee_attempts SET status='failed',issue='quote_expired_before_submission',payload_ciphertext=NULL,updated_at=now() WHERE id=$1",[id]);
        await client.query('UPDATE mulch_fee_stores SET pending_attempt_id=NULL,updated_at=now() WHERE id=$1 AND pending_attempt_id=$2',[attempt.store_id,id]);
        return null;
      }
      if (!attempt.payload_ciphertext) throw new FeeError('payload_unavailable','Manual provider reconciliation is required; do not create a replacement charge.',409);
      const result = await client.query("UPDATE mulch_fee_attempts SET status='submitting',first_submit_at=COALESCE(first_submit_at,now()),updated_at=now() WHERE id=$1 RETURNING *",[id]);
      return {...result.rows[0],replayed};
    });
  }
  async submitted(id, paymentId) {
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      if (attempt.payment_id) {
        if (attempt.payment_id !== paymentId) throw new FeeError('payment_binding_conflict','A command cannot bind a second payment.',409);
        return attempt;
      }
      if (!attempt.first_submit_at || !['submitting','unknown'].includes(attempt.status)) throw new FeeError('invalid_submission_phase','A provider payment cannot bind a command that was never submitted.',409);
      await client.query("UPDATE mulch_fee_attempts SET payment_id=$2,status='pending',issue=NULL,payload_ciphertext=NULL,updated_at=now() WHERE id=$1",[id,paymentId]);
      return this.getAttempt(id,client);
    });
  }
  async unknown(id) {
    await this.pool.query("UPDATE mulch_fee_attempts SET status='unknown',issue='provider_outcome_unknown',updated_at=now() WHERE id=$1 AND status='submitting'",[id]);
  }
  async expirePayload(id) {
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      if (attempt.payment_id || !attempt.first_submit_at || !['unknown','submitting'].includes(attempt.status) || Date.now()-new Date(attempt.first_submit_at).getTime() <= REPLAY_MS) return attempt;
      await client.query("UPDATE mulch_fee_attempts SET status='unknown',issue='manual_reconciliation_required',payload_ciphertext=NULL,updated_at=now() WHERE id=$1",[id]);
      return this.getAttempt(id,client); // Ledger and serialization slot deliberately survive payload expiration.
    });
  }
  async review(id, issue) {
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      await client.query('UPDATE mulch_fee_stores SET provider_verified=false,fee_review_required=true,updated_at=now() WHERE id=$1',[attempt.store_id]);
      await client.query("UPDATE mulch_fee_attempts SET status='review',issue=$2,payload_ciphertext=CASE WHEN payment_id IS NOT NULL THEN NULL ELSE payload_ciphertext END,updated_at=now() WHERE id=$1 AND status <> 'failed'",[id,issue]);
      return this.getAttempt(id,client);
    });
  }
  async fail(id, issue, providerTerminal = false) {
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      if (attempt.counted_at) return attempt;
      if (!providerTerminal && !['quoting','prepared'].includes(attempt.status)) throw new FeeError('unsafe_release', 'An unknown payment cannot be marked failed without provider evidence.', 409);
      await client.query("UPDATE mulch_fee_attempts SET status='failed',issue=$2,payload_ciphertext=NULL,updated_at=now() WHERE id=$1",[id,issue]);
      await client.query('UPDATE mulch_fee_stores SET pending_attempt_id=NULL,updated_at=now() WHERE id=$1 AND pending_attempt_id=$2',[attempt.store_id,id]);
      return this.getAttempt(id,client);
    });
  }
  async capture(id, refundedMinor) {
    minor(refundedMinor);
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      const store = await this.getStore(attempt.store_id,client);
      if (BigInt(refundedMinor) > BigInt(attempt.gross_minor)) throw new FeeError('refund_mismatch','Refund exceeds captured customer gross.',409);
      if (!attempt.counted_at) {
        if (store.pending_attempt_id !== id || attempt.status === 'failed') throw new FeeError('slot_mismatch','Capture does not own the store serialization slot.',409);
        const volume = minor((BigInt(store.lifetime_minor)+BigInt(attempt.gross_minor)).toString());
        await client.query('UPDATE mulch_fee_stores SET lifetime_minor=$2,earned_basis_points=LEAST(earned_basis_points,$3),updated_at=now() WHERE id=$1',[store.id,volume.toString(),attempt.basis_points]);
      }
      await client.query('UPDATE mulch_fee_attempts SET counted_at=COALESCE(counted_at,now()),refunded_minor=GREATEST(refunded_minor,$2),updated_at=now() WHERE id=$1',[id,refundedMinor]);
      return this.getAttempt(id,client); // Captured volume is independent of fee collection. Keep slot until exact fee reconciliation.
    });
  }
  async settle(id, actualFeeMinor, refundedMinor) {
    minor(actualFeeMinor); minor(refundedMinor);
    return this.transaction(async client => {
      const attempt = await this.lockedAttempt(id,client);
      if (!attempt.counted_at) throw new FeeError('capture_not_verified','Record verified captured gross before marking fee collection successful.',409);
      await client.query("UPDATE mulch_fee_attempts SET status='succeeded',actual_fee_minor=$2,refunded_minor=GREATEST(refunded_minor,$3),payload_ciphertext=NULL,issue=NULL,updated_at=now() WHERE id=$1",[id,actualFeeMinor,refundedMinor]);
      await client.query('UPDATE mulch_fee_stores SET pending_attempt_id=NULL,updated_at=now() WHERE id=$1 AND pending_attempt_id=$2',[attempt.store_id,id]);
      return this.getAttempt(id,client);
    });
  }
  async recordActualFee(id, amount) {
    minor(amount);
    await this.pool.query('UPDATE mulch_fee_attempts SET actual_fee_minor=$2,updated_at=now() WHERE id=$1',[id,amount]);
  }
  async findPayment(accountId, paymentId) {
    const result = await this.pool.query(`SELECT a.* FROM mulch_fee_attempts a JOIN mulch_fee_stores s ON s.id=a.store_id
      WHERE s.account_id=$1 AND a.payment_id=$2`, [accountId,paymentId]);
    return result.rows[0] || null;
  }
  async eventBegin(event) {
    await this.pool.query(`INSERT INTO mulch_fee_events(id,event_type,account_id,payment_id)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [event.id,event.type,event.account_id,event.data.id]);
    const saved = (await this.pool.query('SELECT * FROM mulch_fee_events WHERE id=$1',[event.id])).rows[0];
    if (saved.account_id !== event.account_id || saved.payment_id !== event.data.id || saved.event_type !== event.type) throw new FeeError('event_conflict','An event ID was reused with different contents.',409);
    return saved;
  }
  async eventDone(id) { await this.pool.query('UPDATE mulch_fee_events SET processed_at=now() WHERE id=$1',[id]); }
  async summary(id) {
    const store = await this.getStore(id);
    const totals = (await this.pool.query(`SELECT COALESCE(SUM(fee_minor),0)::text AS expected_fee_minor,
      COALESCE(SUM(actual_fee_minor),0)::text AS collected_fee_minor,
      COALESCE(SUM(refunded_minor),0)::text AS refunded_minor FROM mulch_fee_attempts WHERE store_id=$1 AND counted_at IS NOT NULL`,[id])).rows[0];
    return {storeId:id,currency:'usd',lifetimeGrossMinor:store.lifetime_minor,earnedBasisPoints:store.earned_basis_points,
      unresolvedAttemptId:store.pending_attempt_id,reviewRequired:store.fee_review_required,policyVersion:POLICY_VERSION,...totals};
  }
}
export function publicAttempt(attempt) {
  return Object.fromEntries(['id','store_id','order_reference','status','quote_id','payment_id','gross_minor','tax_minor',
    'fee_minor','actual_fee_minor','basis_points','refunded_minor','issue','counted_at'].map(key => [key,attempt[key] ?? null]));
}
