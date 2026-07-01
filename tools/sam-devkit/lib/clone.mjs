function dropEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export async function cloneProposal({ client, account, source, month, year, log = () => {} }) {
  log(`login as ${account.email}`);
  const { token } = await client.login(account);

  log(`create clone of ${source.requestNo} v${source.version}`);
  const created = await client.post('/requests', token, {
    createMode: 0,
    requestNo: source.requestNo,
    version: source.version,
    salesOrgId: source.salesOrgId,
    proposalGroupId: source.proposalGroupId,
    customerGroupId: source.customerGroupId,
    month,
    year,
  });
  const proposalId = created.id;

  log('save general-info (assigns RequestNo, Temp -> Draft)');
  const gi = await client.patch(`/proposals/${proposalId}/general-info`, token, {
    proposalGroupId: source.proposalGroupId,
    customerGroupId: source.customerGroupId,
    customers: [],
    products: [],
    proposalFiles: [],
    month,
    year,
  });

  log('fetch cloned details (PM-injected from source)');
  const detail = await client.get(`/requests/${proposalId}/proposal-details`, token);

  log('save details');
  await client.post(`/requests/${proposalId}/proposal-details`, token, dropEmpty({
    proposalId,
    rebatePayload: detail.rebatePayload,
    specialPayload: detail.specialPayload,
    accumPayload: detail.accumPayload,
  }));

  log('submit');
  await client.put(`/requests/${proposalId}/submit`, token);

  return { proposalId, requestNo: gi.requestNo };
}
