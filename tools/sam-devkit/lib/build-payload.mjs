import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_FILE = { R: 'type-r.json', S: 'type-s.json', P: 'type-p.json' };

async function loadTemplate(type, productId, from, to) {
  const file = TEMPLATE_FILE[type];
  if (!file) throw new Error(`Unknown type "${type}"`);
  let txt = await readFile(join(HERE, '..', 'templates', file), 'utf8');
  txt = txt.split('__PRODUCT_ID__').join(productId)
           .split('__FROM__').join(from)
           .split('__TO__').join(to);
  return txt; // already a JSON string
}

function amountPayload(productId, from, to) {
  return JSON.stringify({
    sections: [
      { productIds: [productId], method: '1', validFrom: from, validTo: to, ranges: [{ from: 0, to: 999, amount: 50 }] },
    ],
  });
}

export async function buildPayload({ type, productIds, from, to }) {
  const productId = productIds && productIds[0];
  if (!productId) throw new Error('buildPayload requires at least one productId');

  const rebatePayload = await loadTemplate(type, productId, from, to);
  if (type === 'S') {
    return { rebatePayload, specialPayload: amountPayload(productId, from, to), accumPayload: amountPayload(productId, from, to) };
  }
  return { rebatePayload };
}
