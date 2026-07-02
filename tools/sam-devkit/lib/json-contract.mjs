// Upsert a SAP contract number into a Type P RebatePayload's JSON.
//
// The stored RebatePayload is a DiscountDocumentTypeP. NOTE the inner page
// payload is DOUBLE-ENCODED — pages[].payload is a JSON *string*, not an object
// (the BE deserializes it via TypePPayloadConverter):
//   {"schemaVersion":2,"pages":[{"deleted":false,"disabled":true,
//      "payload":"{\"products\":[{\"colId\":\"col-1\",\"productId\":\"100048\"}],
//                   \"values\":{\"contract\":{\"col-1\":{\"new\":\"\"}}}}"}]}
// Products live per-page with an explicit `colId`; the contract cell is keyed by
// that colId under values.contract. Only `deleted:true` pages are skipped
// (disabled pages still carry products and are updated).
//
// For robustness these functions also accept a page payload that is already an
// object, or a single flat page-payload ({ products, values }).

// The product's explicit colId, falling back to its 1-based position.
function colIdFor(product, i) {
  return (product && typeof product.colId === 'string' && product.colId) ? product.colId : `col-${i + 1}`;
}

function setContractCell(pp, colId, contractNo) {
  pp.values ??= {};
  pp.values.contract ??= {};
  const cell = pp.values.contract[colId] ?? {};
  cell.new = contractNo ?? '';                 // preserve any existing value/disabled fields
  pp.values.contract[colId] = cell;
}

// Parse one page's payload into a Type P payload object. Returns { pp, isString }
// or null when the page should be skipped (deleted, unparseable, or not Type P).
function readPagePayload(page) {
  if (!page || page.deleted === true) return null;
  const isString = typeof page.payload === 'string';
  let pp;
  try {
    pp = isString ? JSON.parse(page.payload) : page.payload;
  } catch {
    return null;
  }
  if (!pp || Array.isArray(pp) || !Array.isArray(pp.products)) return null;
  return { pp, isString };
}

// Walk each Type P page, hand its parsed payload object to fn, and write the
// mutated payload back — re-stringifying when it was a JSON string. fn returns
// the number of products it touched. Mutates `doc` in place; returns the total.
// Also accepts a single flat page-payload ({ products, values }).
function eachTypePPage(doc, fn) {
  let count = 0;
  if (Array.isArray(doc?.pages)) {
    for (const page of doc.pages) {
      const parsed = readPagePayload(page);
      if (!parsed) continue;
      const n = fn(parsed.pp);
      count += n;
      if (parsed.isString && n > 0) page.payload = JSON.stringify(parsed.pp); // re-encode
    }
    return count;
  }
  if (Array.isArray(doc?.products)) count += fn(doc); // flat page-payload
  return count;
}

// Set the contract for a specific productId across all pages. Returns true if any matched.
export function upsertContractByProductId(doc, productId, contractNo) {
  if (!productId) return false;
  const key = String(productId).trim();
  let found = false;
  eachTypePPage(doc, (pp) => {
    let n = 0;
    pp.products.forEach((prod, i) => {
      if (String(prod?.productId ?? '').trim() === key) {
        setContractCell(pp, colIdFor(prod, i), contractNo);
        found = true;
        n += 1;
      }
    });
    return n;
  });
  return found;
}

// Set the contract on every product across all pages. Returns the number of products updated.
export function upsertContractForAllProducts(doc, contractNo) {
  return eachTypePPage(doc, (pp) => {
    pp.products.forEach((prod, i) => setContractCell(pp, colIdFor(prod, i), contractNo));
    return pp.products.length;
  });
}
