// Mock-insert a valid SAP staging row for a proposal, stamped as already
// successful — for QA/dev environments that cannot reach real SAP (see
// EnvironmentHelper.IsClient / SapSyncServiceFallback in the BE). Reuses the
// exact source join (ProposalProductTypeP/RS + ProposalCustomer + Proposal)
// that SapGenerateService.cs uses, so field values are real/valid — only the
// SAP_RETURN outcome is mocked, never a real RFC call.
//
// Companion to SAP fixup (lib/sap-fixup.mjs): fixup sets Proposal.SAPStatus +
// contract no; this inserts the staging row those UPDATEs assume exists.

import { assertDevDbServer } from './guard.mjs';
import { runSql } from './db.mjs';
import { GROUP_LETTER, FLOW_BY_TYPE, SUCCESS_VALUE, TABLE_BY_FLOW } from './sap-inspector.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

const MOCK_CREATED_BY = '00000000-0000-0000-0000-000000000000';
const MOCK_MESSAGE = 'MOCKED by sam-devkit -- no real SAP call (QA cannot reach SAP)';

// MERGE, not plain INSERT: lets a re-run refresh a PREVIOUS mock row (matched
// by the same natural key) without ever touching a REAL staging row from an
// actual SAP attempt. Only a target row whose SAP_MESSAGE already carries our
// marker is eligible for UPDATE — anything else (real success, real failure,
// real pending) is left alone on purpose, so a real SAP error never gets
// silently papered over by a QA mock.

// Type P — mirrors SapGenerateService.CreateContractAsync (Shared/SAP/SapGenerateService.cs:216-297)
function contractSql({ sapDb, id, successReturn }) {
  return `SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000; SET NOCOUNT ON;
MERGE [${sapDb}].dbo.CreateContract AS tgt
USING (
    SELECT pp.PROPOSAL_ID,
           p.RequestNo AS DOCNO,
           p.[Version] AS DOCVER,
           p.SaleOrgCode AS ORGNO,
           RIGHT(REPLICATE('0',10) + ISNULL(c.SOLDTO_CODE,''), 10) AS SOLDTO,
           ISNULL(pp.SHIP_TO, '') AS SHIPTO,
           ISNULL(pp.BILL_TO, '') AS BILLTO,
           RIGHT(REPLICATE('0',18) + ISNULL(pp.PRODUCT_CODE,''), 18) AS MATERIAL_CODE,
           CAST(pp.VOLUME_TON AS varchar(50)) AS VOLUME,
           ISNULL(pp.SHIP_POINT, '') AS PLANT,
           ISNULL(pp.SHIP_CON, '') AS SHIPCON,
           CONVERT(char(8), vf.MaxValidFrom, 112) AS VALID_FROM,
           CONVERT(char(8), pp.TO_DATE, 112) AS VALID_TO,
           CAST(pp.RATE AS varchar(50)) AS RATE,
           CAST(pp.BIGBAG_CHARGE AS varchar(50)) AS BIG_BAG_PACK_CHARGE,
           pp.PAGE AS PAGE,
           p.[Year] * 100 + p.[Month] AS PERIOD
    FROM   dbo.ProposalProductTypeP pp
    JOIN   dbo.ProposalCustomer   c ON pp.PROPOSAL_ID = c.PROPOSAL_ID
    JOIN   dbo.Proposal           p ON pp.PROPOSAL_ID = p.Id
    CROSS APPLY (
        SELECT CASE
                 WHEN ISNULL(p.BackDate, pp.FROM_DATE) > pp.FROM_DATE
                      THEN ISNULL(p.BackDate, pp.FROM_DATE)
                 ELSE pp.FROM_DATE
               END AS MaxValidFrom
    ) vf
    WHERE  pp.PROPOSAL_ID = '${id}'
) AS src
ON  tgt.PROPOSAL_ID   = src.PROPOSAL_ID
AND tgt.SOLDTO        = src.SOLDTO
AND tgt.MATERIAL_CODE = src.MATERIAL_CODE
AND tgt.VALID_FROM    = src.VALID_FROM
AND tgt.VALID_TO      = src.VALID_TO
WHEN MATCHED AND tgt.SAP_MESSAGE = '${esc(MOCK_MESSAGE)}' THEN
  UPDATE SET SAP_RETURN = '${esc(successReturn)}', SAP_MESSAGE = '${esc(MOCK_MESSAGE)}', PROCESSED_AT = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (ID, PROPOSAL_ID, DOCNO, DOCVER, ORGNO, SOLDTO, SHIPTO, BILLTO, MATERIAL_CODE,
          VOLUME, PLANT, SHIPCON, VALID_FROM, VALID_TO, RATE, BIG_BAG_PACK_CHARGE, PAGE, PERIOD, CREATED_BY,
          SAP_RETURN, SAP_MESSAGE, PROCESSED_AT)
  VALUES (NEWID(), src.PROPOSAL_ID, src.DOCNO, src.DOCVER, src.ORGNO, src.SOLDTO, src.SHIPTO, src.BILLTO, src.MATERIAL_CODE,
          src.VOLUME, src.PLANT, src.SHIPCON, src.VALID_FROM, src.VALID_TO, src.RATE, src.BIG_BAG_PACK_CHARGE, src.PAGE, src.PERIOD, '${MOCK_CREATED_BY}',
          '${esc(successReturn)}', '${esc(MOCK_MESSAGE)}', SYSUTCDATETIME())
OPTION (RECOMPILE);
SELECT @@ROWCOUNT;`;
}

// Type R — mirrors the ProposalGroupId=2 branch of SapGenerateService.CreateDiscountAsync (SapGenerateService.cs:135-180)
function discountSql({ sapDb, id, successReturn }) {
  return `SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000; SET NOCOUNT ON;
MERGE [${sapDb}].dbo.CreateDiscount AS tgt
USING (
    SELECT rs.PROPOSAL_ID,
           p.RequestNo AS DOCNO,
           p.[Version] AS DOCVER,
           pg.CODE AS DOCTYPE,
           p.SaleOrgCode AS ORGNO,
           RIGHT(REPLICATE('0',10) + ISNULL(c.SOLDTO_CODE,''), 10) AS SOLDTO,
           RIGHT(REPLICATE('0',18) + ISNULL(rs.PRODUCT_CODE,''), 18) AS MATERIAL_CODE,
           CAST(rs.RATE AS varchar(50)) AS RATE,
           CONVERT(char(8), vf.MaxValidFrom, 112) AS VALID_FROM,
           CONVERT(char(8), rs.TO_DATE, 112) AS VALID_TO,
           p.[Year] * 100 + p.[Month] AS PERIOD,
           rs.PAGE AS PAGE
    FROM   dbo.ProposalProductTypeRS rs
    JOIN   dbo.ProposalCustomer     c ON rs.PROPOSAL_ID = c.PROPOSAL_ID
    JOIN   dbo.Proposal             p ON rs.PROPOSAL_ID = p.Id
    JOIN   core.ProposalGroup       pg ON p.ProposalGroupId = pg.ID
    CROSS APPLY (
        SELECT CASE
                 WHEN ISNULL(p.BackDate, rs.FROM_DATE) > rs.FROM_DATE
                      THEN ISNULL(p.BackDate, rs.FROM_DATE)
                 ELSE rs.FROM_DATE
               END AS MaxValidFrom
    ) vf
    WHERE  rs.PROPOSAL_ID = '${id}'
      AND  rs.RATE_TYPE   = 'Discount'
      AND  rs.PAGE = 1
) AS src
ON  tgt.PROPOSAL_ID   = src.PROPOSAL_ID
AND tgt.SOLDTO        = src.SOLDTO
AND tgt.MATERIAL_CODE = src.MATERIAL_CODE
AND tgt.VALID_FROM    = src.VALID_FROM
AND tgt.VALID_TO      = src.VALID_TO
WHEN MATCHED AND tgt.SAP_MESSAGE = '${esc(MOCK_MESSAGE)}' THEN
  UPDATE SET SAP_RETURN = '${esc(successReturn)}', SAP_MESSAGE = '${esc(MOCK_MESSAGE)}', PROCESSED_AT = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (ID, PROPOSAL_ID, DOCNO, DOCVER, DOCTYPE, ORGNO, SOLDTO, MATERIAL_CODE, RATE, VALID_FROM, VALID_TO, PERIOD, CREATED_BY, PAGE,
          SAP_RETURN, SAP_MESSAGE, PROCESSED_AT)
  VALUES (NEWID(), src.PROPOSAL_ID, src.DOCNO, src.DOCVER, src.DOCTYPE, src.ORGNO, src.SOLDTO, src.MATERIAL_CODE, src.RATE, src.VALID_FROM, src.VALID_TO, src.PERIOD, '${MOCK_CREATED_BY}', src.PAGE,
          '${esc(successReturn)}', '${esc(MOCK_MESSAGE)}', SYSUTCDATETIME())
OPTION (RECOMPILE);
SELECT @@ROWCOUNT;`;
}

// Type S — mirrors SapGenerateService.ChangeContractAsync (SapGenerateService.cs:301-372)
function changeContractSql({ sapDb, id, successReturn }) {
  return `SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000; SET NOCOUNT ON;
MERGE [${sapDb}].dbo.ChangeContract AS tgt
USING (
    SELECT pp.PROPOSAL_ID,
           p.RequestNo AS DOCNO,
           p.[Version] AS DOCVER,
           ISNULL(pp.CONTRACT, '') AS CONTRACT_NO,
           pp.PRODUCT_CODE AS MATERIAL_CODE,
           CAST(pp.VOLUME_TON AS varchar(50)) AS VOLUME,
           CONVERT(char(8), vf.MaxValidFrom, 112) AS VALID_FROM,
           CONVERT(char(8), pp.TO_DATE, 112) AS VALID_TO,
           pp.PAGE AS PAGE,
           p.[Year] * 100 + p.[Month] AS PERIOD
    FROM   dbo.ProposalProductTypeP pp
    JOIN   dbo.Proposal           p ON pp.PROPOSAL_ID = p.Id
    CROSS APPLY (
        SELECT CASE
                 WHEN ISNULL(p.BackDate, pp.FROM_DATE) > pp.FROM_DATE
                      THEN ISNULL(p.BackDate, pp.FROM_DATE)
                 ELSE pp.FROM_DATE
               END AS MaxValidFrom
    ) vf
    WHERE  pp.PROPOSAL_ID = '${id}'
) AS src
ON  tgt.PROPOSAL_ID = src.PROPOSAL_ID
AND tgt.CONTRACT_NO = src.CONTRACT_NO
AND tgt.VALID_FROM  = src.VALID_FROM
AND tgt.VALID_TO    = src.VALID_TO
WHEN MATCHED AND tgt.SAP_MESSAGE = '${esc(MOCK_MESSAGE)}' THEN
  UPDATE SET SAP_RETURN = '${esc(successReturn)}', SAP_MESSAGE = '${esc(MOCK_MESSAGE)}', PROCESSED_AT = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (ID, PROPOSAL_ID, DOCNO, DOCVER, CONTRACT_NO, MATERIAL_CODE, VOLUME, VALID_FROM, VALID_TO, PAGE, PERIOD, CREATED_BY,
          SAP_RETURN, SAP_MESSAGE, PROCESSED_AT)
  VALUES (NEWID(), src.PROPOSAL_ID, src.DOCNO, src.DOCVER, src.CONTRACT_NO, src.MATERIAL_CODE, src.VOLUME, src.VALID_FROM, src.VALID_TO, src.PAGE, src.PERIOD, '${MOCK_CREATED_BY}',
          '${esc(successReturn)}', '${esc(MOCK_MESSAGE)}', SYSUTCDATETIME())
OPTION (RECOMPILE);
SELECT @@ROWCOUNT;`;
}

const SQL_BY_TABLE = {
  CreateContract: contractSql,
  CreateDiscount: discountSql,
  ChangeContract: changeContractSql,
};

export async function mockStagingRow({ db, proposalId, run = runSql, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);

  const groupOut = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT ProposalGroupId FROM dbo.Proposal WHERE Id='${id}';` });
  const groupId = Number(String(groupOut).trim());
  const type = GROUP_LETTER[groupId];
  if (!type) throw new Error(`Proposal not found or unknown ProposalGroupId=${groupOut}`.trim());

  const flow = FLOW_BY_TYPE[type];
  const table = TABLE_BY_FLOW[flow];
  const successReturn = SUCCESS_VALUE[flow];
  const build = SQL_BY_TABLE[table];

  log(`[kit] mock staging: Type ${type} -> ${flow} -> ${table} (SAP_RETURN='${successReturn}')`);
  const sql = build({ sapDb: db.sap.database, id, successReturn });
  const out = await run({ ...sam, sql });
  const rowsInserted = Number(String(out).trim()) || 0;
  log(`[kit] mock staging rows inserted/refreshed: ${rowsInserted}`);
  if (rowsInserted === 0) {
    log('[kit] warn: 0 rows affected -- source data (ProposalProductTypeP/RS + ProposalCustomer) may be missing, or a REAL (non-mock) row already occupies that key and was left untouched on purpose');
  }

  return { type, flow, table, successReturn, rowsInserted };
}
