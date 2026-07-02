// 1-based position of the product in payload.products, matched by productId (trimmed, exact). -1 if absent.
export function colIndexByProductId(payload, productId) {
  if (!productId) return -1;
  const key = String(productId).trim();
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const idx = products.findIndex((p) => String(p?.productId ?? '').trim() === key);
  return idx >= 0 ? idx + 1 : -1;
}

function setCell(payload, colIndex, contractNo) {
  payload.values ??= {};
  payload.values.contract ??= {};
  const colId = `col-${colIndex}`;
  const cell = payload.values.contract[colId] ?? {};
  cell.new = contractNo ?? '';
  payload.values.contract[colId] = cell;
}

export function upsertContractByProductId(payload, productId, contractNo) {
  const idx = colIndexByProductId(payload, productId);
  if (idx <= 0) return false;
  setCell(payload, idx, contractNo);
  return true;
}

export function upsertContractForAllProducts(payload, contractNo) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  products.forEach((_, i) => setCell(payload, i + 1, contractNo));
  return products.length;
}
