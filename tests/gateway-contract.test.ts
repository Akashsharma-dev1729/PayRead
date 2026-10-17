import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateway, PaymentError } from '../lib/server/razorpay';
import { PaymentService } from '../lib/server/payment-service';
import type { PaymentRepository } from '../lib/server/payment-repository';
import type { PaymentGateway } from '../lib/server/payment-gateway';

test('gateway rejects malformed JSON shapes with a controlled provider error', async () => {
  const original = globalThis.fetch;
  const oldId = process.env.RAZORPAY_KEY_ID;
  const oldSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_contract';
  process.env.RAZORPAY_KEY_SECRET = 'test-only';
  try {
    for (const body of [null, [], 'unexpected', 123, false]) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(gateway('orders'), error =>
        error instanceof PaymentError && error.status === 502);
    }
    globalThis.fetch = async () => Response.json({ id: 'order_valid' });
    assert.deepEqual(await gateway('orders'), { id: 'order_valid' });
  } finally {
    globalThis.fetch = original;
    if (oldId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = oldId;
    if (oldSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = oldSecret;
  }
});

test('invalid purchase and unsigned webhook never touch injected adapters', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Adapter must not be called'); } });
  const service = new PaymentService(
    forbidden as PaymentRepository, forbidden as PaymentGateway, () => 'test-secret',
  );
  await assert.rejects(service.createOrder({}), /Invalid purchase details/);
  await assert.rejects(service.verifyPayment({}), /Invalid payment verification/);
  await assert.rejects(service.processWebhook('{}', null), /Invalid webhook signature/);
});
