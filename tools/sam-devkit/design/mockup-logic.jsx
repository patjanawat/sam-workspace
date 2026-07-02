// Extracted from Claude design export (sam-devkit.html) — mock logic, reference only.
// Real wiring lives in ../index.html (fetch /config + POST /run streaming).
class Component extends DCLogic {
  consoleRef = React.createRef();
  timers = [];

  state = {
    env: this.defaultConfig().defaultEnv,
    config: this.defaultConfig(),
    settingsOpen: false,
    settingsTab: this.defaultConfig().defaultEnv,
    action: 'approve-through',
    proposalId: '3f9a1c02-8d4e-4b17-9c6a-2b7f0e5d1a44',
    sapStatus: 'success',
    contractNumber: '',
    logs: [],
    result: null,
    running: false,
    history: [
      '3f9a1c02-8d4e-4b17-9c6a-2b7f0e5d1a44',
      'a71e5b90-2c3d-4f81-b6e2-9d0c4a1f7e35',
      'c04d7f18-6a92-4e3b-8f15-0b2e9c6d4a77',
      '5b8e2d41-7f0a-4c93-a1d6-3e9b0c7a2f18',
      'd92c3a06-1b4e-4f27-8c5a-6d0e9b3f1a42',
      '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
      'e47f9b12-3c5d-4e81-b2a6-9f0c4d1e7a35'
    ],
    recentFilter: '',
    executed: {
      '3f9a1c02-8d4e-4b17-9c6a-2b7f0e5d1a44': Date.now() - 2*3600e3,
      'c04d7f18-6a92-4e3b-8f15-0b2e9c6d4a77': Date.now() - 26*3600e3,
      'd92c3a06-1b4e-4f27-8c5a-6d0e9b3f1a42': Date.now() - 3*86400e3
    },
    consoleCopied: false,
    jobCopied: false,
    urlCopied: false
  };

  ENV_COLOR = { local:'#8b949e', develop:'#3fb950', qa:'#d29922', staging:'#d29922', production:'#f85149' };

  ACTIONS = [
    { key:'approve-through', label:'Approve-through', desc:'Run all role approvals', glyph:'\u2713' },
    { key:'sap-fixup', label:'SAP fixup', desc:'Reconcile SAP sync state', glyph:'\u27F3' }
  ];

  SAP = [
    { key:'success', label:'success', dot:'#3fb950' },
    { key:'pending', label:'pending', dot:'#d29922' },
    { key:'failed', label:'failed', dot:'#f85149' }
  ];

  ROLE = {
    srp:{ fg:'#fca5a5', bg:'rgba(252,165,165,0.16)' },
    sam:{ fg:'#a5b4fc', bg:'rgba(129,140,248,0.16)' },
    sdm:{ fg:'#5eead4', bg:'rgba(45,212,191,0.16)' },
    pte:{ fg:'#d8b4fe', bg:'rgba(192,132,252,0.16)' },
    cdr:{ fg:'#fcd34d', bg:'rgba(251,191,36,0.16)' },
    sap:{ fg:'#7dd3fc', bg:'rgba(56,189,248,0.16)' },
    kit:{ fg:'#93c5fd', bg:'rgba(147,197,253,0.16)' }
  };

  C = { muted:'#8b949e', text:'#c9d1d9', green:'#3fb950', amber:'#d29922', blue:'#58a6ff', red:'#f85149', dim:'#6e7681' };

  componentWillUnmount(){ this.clearTimers(); }
  componentDidUpdate(){ const el = this.consoleRef.current; if (el) el.scrollTop = el.scrollHeight; }

  clearTimers(){ this.timers.forEach(clearTimeout); this.timers = []; }

  defaultConfig(){
    const roles = {
      srp:{ email:'sale@ware.com', password:'11DDd*55' },
      sam:{ email:'asm@ware.com', password:'11DDd*55' },
      sdm:{ email:'sdm@ware.com', password:'11DDd*55' },
      pte:{ email:'pt@ware.com', password:'11DDd*55' },
      cdr:{ email:'cd@ware.com', password:'11DDd*55' }
    };
    const db = { server:'localhost', allowedServers:[], sam:{ database:'qa-01', user:'user', password:'xxx' }, sap:{ database:'sap-qa', user:'user', password:'yyy' } };
    const mk = (api, web)=>({ apiBaseUrl:api, web, roles:JSON.parse(JSON.stringify(roles)), db:JSON.parse(JSON.stringify(db)) });
    return { defaultEnv:'qa', environments:{ local:mk('http://localhost:5000','http://localhost:3000'), develop:mk('https://web-develop.com/api','https://web-develop.com'), qa:mk('https://web-qa.com/api','https://web-qa.com') } };
  }

  persist(config, env){ try { localStorage.setItem('sam-devkit-state', JSON.stringify({ config, env })); } catch(e){} }

  componentDidMount(){
    try { const raw = localStorage.getItem('sam-devkit-state'); if (raw){ const p = JSON.parse(raw); if (p && p.config){ this.setState({ config:p.config, env:p.env||p.config.defaultEnv, settingsTab:p.env||p.config.defaultEnv }); } } } catch(e){}
  }

  setCfg(pathArr, value){
    this.setState(st=>{
      const cfg = JSON.parse(JSON.stringify(st.config));
      let o = cfg;
      for (let i=0;i<pathArr.length-1;i++){ if (o[pathArr[i]]==null) o[pathArr[i]]={}; o=o[pathArr[i]]; }
      o[pathArr[pathArr.length-1]] = value;
      this.persist(cfg, st.env);
      return { config:cfg };
    });
  }

  resetConfig(){ const cfg = this.defaultConfig(); this.persist(cfg, cfg.defaultEnv); this.setState({ config:cfg, env:cfg.defaultEnv, settingsTab:cfg.defaultEnv }); }

  newContract(){ return 'CN-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random()*900000)+100000); }
  regenContract(){ this.setState({ contractNumber: this.newContract() }); }
  selectAction(key){ const patch = { action:key }; if (key==='sap-fixup' && !this.state.contractNumber) patch.contractNumber = this.newContract(); this.setState(patch); }

  fmtExecuted(ts){
    if (!ts) return '';
    const d = new Date(ts), diff = Date.now()-ts, mins = Math.floor(diff/60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins+'m ago';
    const hrs = Math.floor(mins/60); if (hrs < 24) return hrs+'h ago';
    const days = Math.floor(hrs/24); if (days < 7) return days+'d ago';
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mo[d.getMonth()]+' '+d.getDate();
  }

  hex(len){ let s=''; for(let i=0;i<len;i++) s += Math.floor(Math.random()*16).toString(16); return s; }
  newGuid(){ return this.hex(8)+'-'+this.hex(4)+'-4'+this.hex(3)+'-'+(8+Math.floor(Math.random()*4)).toString(16)+this.hex(3)+'-'+this.hex(12); }
  guidValid(v){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((v||'').trim()); }
  needsProposal(){ return this.state.action !== 'create-approve'; }
  proposalOk(){ return !this.needsProposal() || this.guidValid(this.state.proposalId); }

  fmtTime(){ const d=new Date(); const p=(n,l=2)=>String(n).padStart(l,'0'); return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())+'.'+p(d.getMilliseconds(),3); }

  buildLines(){
    const s = this.state, C = this.C;
    const envCfg = (s.config.environments||{})[s.env] || {};
    const roleEmail = (r)=> (envCfg.roles && envCfg.roles[r]) ? envCfg.roles[r].email : '';
    const lines = [];
    const seg = (text,color,bold)=>({ text, color, bold:!!bold });
    const L = (role, segments, raw)=> lines.push({ role, segments, raw });
    let rv = 0xD485;
    const rowV = ()=>{ const h = rv.toString(16).toUpperCase(); rv += 2; return '0'.repeat(16-h.length)+h; };
    const jobId = this.hex(32);
    let steps = [];
    let finalStatus = 2, statusLabel = 'Approved', statusColor = C.green;

    const approveSequence = ()=>{
      L('sam',[seg('login ',C.muted), seg('('+roleEmail('sam')+')',C.dim)], '[sam] login ('+roleEmail('sam')+')');
      L('sam',[seg("not this role\u2019s turn (canApprove=false) \u2014 skip",C.amber)], "[sam] not this role's turn (canApprove=false) \u2014 skip");
      steps.push({ role:'sam', action:'skipped', status:2, color:C.amber });
      ['sdm','pte','cdr'].forEach(r=>{
        L(r,[seg('login ',C.muted), seg('('+roleEmail(r)+')',C.dim)], '['+r+'] login ('+roleEmail(r)+')');
        const v = rowV();
        L(r,[seg('approve ',C.green), seg('(rowVersion='+v+')',C.dim)], '['+r+'] approve (rowVersion='+v+')');
        steps.push({ role:r, action:'approved', status:2, color:C.green });
      });
      L('cdr',[seg('approval enqueued ',C.blue), seg('\u2014 jobId='+jobId+' ',C.dim), seg('(SAP sync runs async)',C.muted)], '[cdr] approval enqueued \u2014 jobId='+jobId+' (SAP sync runs async)');
    };

    if (s.action === 'clone-approve'){
      L('srp',[seg('login ',C.muted), seg('('+roleEmail('srp')+')',C.dim)], '[srp] login ('+roleEmail('srp')+')');
      L('srp',[seg('clone proposal ',C.blue), seg(s.proposalId||'(source)',C.dim)], '[srp] clone proposal '+(s.proposalId||'(source)'));
      const nid = this.newGuid();
      L('srp',[seg('created ',C.green), seg(nid,C.dim)], '[srp] created '+nid);
      approveSequence();
    } else if (s.action === 'create-approve'){
      L('srp',[seg('login ',C.muted), seg('('+roleEmail('srp')+')',C.dim)], '[srp] login ('+roleEmail('srp')+')');
      const nid = this.newGuid();
      L('srp',[seg('create proposal',C.blue)], '[srp] create proposal');
      L('srp',[seg('created ',C.green), seg(nid,C.dim)], '[srp] created '+nid);
      approveSequence();
    } else if (s.action === 'sap-fixup'){
      const st = s.sapStatus;
      L('sap',[seg('connect ',C.muted), seg('(env='+s.env+')',C.dim)], '[sap] connect (env='+s.env+')');
      L('sap',[seg('fetch proposal ',C.muted), seg(s.proposalId||'(none)',C.dim)], '[sap] fetch proposal '+(s.proposalId||'(none)'));
      const stColor = st==='success'?C.green : st==='pending'?C.amber : C.red;
      L('sap',[seg('sap status = ',C.muted), seg(st,stColor)], '[sap] sap status = '+st);
      L('sap',[seg('apply contract ',C.muted), seg(s.contractNumber||'(none)',C.dim)], '[sap] apply contract '+(s.contractNumber||'(none)'));
      if (st === 'success'){
        L('sap',[seg('fixup complete ',C.green), seg('\u2014 jobId='+jobId,C.dim)], '[sap] fixup complete \u2014 jobId='+jobId);
        statusLabel='Reconciled'; statusColor=C.green; finalStatus=2; steps=[{ role:'sap', action:'reconciled', status:2, color:C.green }];
      } else if (st === 'pending'){
        L('sap',[seg('fixup queued ',C.amber), seg('\u2014 jobId='+jobId,C.dim)], '[sap] fixup queued \u2014 jobId='+jobId);
        statusLabel='Pending'; statusColor=C.amber; finalStatus=1; steps=[{ role:'sap', action:'queued', status:1, color:C.amber }];
      } else {
        L('sap',[seg('fixup failed ',C.red), seg('\u2014 SAP returned error 0x80070057',C.dim)], '[sap] fixup failed \u2014 SAP returned error 0x80070057');
        statusLabel='Failed'; statusColor=C.red; finalStatus=0; steps=[{ role:'sap', action:'failed', status:0, color:C.red }];
      }
    } else {
      approveSequence();
    }

    const resultObj = { finalStatus, steps: steps.map(x=>({ role:x.role, action:x.action, status:x.status })), cdrJobId: jobId };
    L(null,[seg('RESULT ',C.blue,true), seg(JSON.stringify(resultObj),C.text)], 'RESULT '+JSON.stringify(resultObj));

    return { lines, result:{ statusLabel, statusColor, finalStatus, steps, jobId, obj: resultObj } };
  }

  run(){
    if (this.state.running || !this.proposalOk()) return;
    this.clearTimers();
    const built = this.buildLines();
    let hist = this.state.history;
    if (this.needsProposal() && this.guidValid(this.state.proposalId)){
      hist = [this.state.proposalId, ...this.state.history.filter(x=>x!==this.state.proposalId)].slice(0,20);
    }
    let executed = this.state.executed;
    if (this.needsProposal() && this.guidValid(this.state.proposalId)){
      executed = { ...executed, [this.state.proposalId]: Date.now() };
    }
    this.setState({ logs:[], result:null, running:true, history:hist, executed });
    const speed = this.props.streamSpeed ?? 320;
    built.lines.forEach((ln,i)=>{
      const id = setTimeout(()=>{
        this.setState(st=>({ logs:[...st.logs, { ...ln, ts:this.fmtTime() }] }));
        if (i === built.lines.length-1){
          const id2 = setTimeout(()=> this.setState({ running:false, result:built.result }), Math.min(speed,280));
          this.timers.push(id2);
        }
      }, 240 + i*speed);
      this.timers.push(id);
    });
  }

  clearConsole(){ this.clearTimers(); this.setState({ logs:[], result:null, running:false }); }

  copyText(txt, key){
    try { navigator.clipboard.writeText(txt); } catch(e){}
    this.setState({ [key]:true });
    setTimeout(()=> this.setState({ [key]:false }), 1300);
  }

  renderJson(obj){
    const json = JSON.stringify(obj, null, 2);
    const re = /("(?:\\.|[^"\\])*"\s*:?|-?\d+\.?\d*|\btrue\b|\bfalse\b|\bnull\b)/g;
    const parts = []; let last = 0, m, i = 0;
    while ((m = re.exec(json))){
      if (m.index > last) parts.push(React.createElement('span',{ key:i++, style:{ color:'#57606a' } }, json.slice(last, m.index)));
      const t = m[0]; let color = '#953800';
      if (t[0] === '"') color = /:\s*$/.test(t) ? '#0550ae' : '#0a7d33';
      else if (/^(true|false|null)$/.test(t)) color = '#8250df';
      parts.push(React.createElement('span',{ key:i++, style:{ color } }, t));
      last = re.lastIndex;
    }
    if (last < json.length) parts.push(React.createElement('span',{ key:i++, style:{ color:'#57606a' } }, json.slice(last)));
    return React.createElement('pre',{ style:{ margin:0, fontFamily:"'IBM Plex Mono',monospace", fontSize:'12px', lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-word' } }, parts);
  }

  renderVals(){
    const s = this.state;
    const accent = this.props.accent ?? '#4f46e5';
    const showTimestamps = this.props.showTimestamps ?? true;
    const envKeys = Object.keys(s.config.environments || {});
    const dotOf = (k)=> this.ENV_COLOR[k] || '#667085';
    const apiBaseUrl = ((s.config.environments||{})[s.env] || {}).apiBaseUrl || '';

    const envOptions = envKeys.map(k=>{
      const active = k===s.env;
      return { label:k, dot:dotOf(k), onClick:()=>this.setState({ env:k }),
        bg: active?'#ffffff':'transparent', fg: active?'#1a1d23':'#667085',
        shadow: active?'0 1px 2px rgba(16,24,40,.10)':'none' };
    });

    // --- settings ---
    const setField = (path, transform)=> (e)=> this.setCfg(path, transform ? transform(e.target.value) : e.target.value);
    const defaultEnvOptions = envKeys.map(k=>{
      const active = s.config.defaultEnv===k;
      return { label:k, onClick:()=>this.setCfg(['defaultEnv'], k),
        bg: active?'#ffffff':'transparent', fg: active?'#1a1d23':'#667085',
        shadow: active?'0 1px 2px rgba(16,24,40,.10)':'none' };
    });
    const settingsTabs = envKeys.map(k=>{
      const active = s.settingsTab===k;
      return { label:k, dot:dotOf(k), onClick:()=>this.setState({ settingsTab:k }),
        bg: active?'color-mix(in srgb, var(--accent,#4f46e5) 7%, #fff)':'#ffffff',
        border: active?'var(--accent,#4f46e5)':'#e7e9ee',
        fg: active?'#1a1d23':'#667085' };
    });
    const te = s.config.environments[s.settingsTab] || {};
    const teRoles = te.roles || {};
    const roleOrder = ['srp','sam','sdm','pte','cdr'];
    const settingsRoles = roleOrder.filter(r=>teRoles[r]).map(r=>{
      const rc = this.ROLE[r] || { fg:'#667085', bg:'#f1f3f5' };
      return { key:r, label:r.toUpperCase(), badgeFg:rc.fg, badgeBg:rc.bg,
        email: teRoles[r].email||'', emailChange: setField(['environments',s.settingsTab,'roles',r,'email']),
        password: teRoles[r].password||'', pwChange: setField(['environments',s.settingsTab,'roles',r,'password']) };
    });
    const dbc = te.db || {};
    const dbGet = (grp, key)=> ((dbc[grp]||{})[key]) || '';
    const settingsDb = {
      server: dbc.server||'', serverChange: setField(['environments',s.settingsTab,'db','server']),
      allowedServers: (dbc.allowedServers||[]).join(', '), allowedChange: setField(['environments',s.settingsTab,'db','allowedServers'], v=>v.split(',').map(x=>x.trim()).filter(Boolean)),
      sam: { database:dbGet('sam','database'), dbChange:setField(['environments',s.settingsTab,'db','sam','database']),
        user:dbGet('sam','user'), userChange:setField(['environments',s.settingsTab,'db','sam','user']),
        password:dbGet('sam','password'), pwChange:setField(['environments',s.settingsTab,'db','sam','password']) },
      sap: { database:dbGet('sap','database'), dbChange:setField(['environments',s.settingsTab,'db','sap','database']),
        user:dbGet('sap','user'), userChange:setField(['environments',s.settingsTab,'db','sap','user']),
        password:dbGet('sap','password'), pwChange:setField(['environments',s.settingsTab,'db','sap','password']) }
    };

    const actions = this.ACTIONS.map(a=>{
      const active = a.key===s.action;
      return { label:a.label, desc:a.desc, glyph:a.glyph,
        onClick:()=>this.selectAction(a.key),
        bg: active?'color-mix(in srgb, var(--accent,#4f46e5) 7%, #fff)':'#ffffff',
        border: active?'var(--accent,#4f46e5)':'#e7e9ee',
        fg:'#1a1d23',
        descColor: active?'#667085':'#98a2b3',
        glyphBg: active?'var(--accent,#4f46e5)':'#f1f3f5',
        glyphFg: active?'#ffffff':'#667085' };
    });

    const sapOptions = this.SAP.map(o=>{
      const active = o.key===s.sapStatus;
      return { label:o.label, dot:o.dot, onClick:()=>this.setState({ sapStatus:o.key }),
        bg: active?'#ffffff':'transparent', fg: active?'#1a1d23':'#667085',
        shadow: active?'0 1px 2px rgba(16,24,40,.10)':'none' };
    });

    const webUrl = ((s.config.environments||{})[s.env] || {}).web || '';
    const rf = (s.recentFilter||'').trim().toLowerCase();
    const recentList = s.history.filter(id=> !rf || id.toLowerCase().includes(rf)).map(id=>{
      const active = id===s.proposalId;
      const ts = s.executed[id];
      return { id, short: id.slice(0,8)+'\u2026'+id.slice(-4), onClick:()=>this.setState({ proposalId:id }),
        bg: active ? 'color-mix(in srgb, var(--accent,#4f46e5) 9%, #fff)' : 'transparent',
        fg: active ? 'var(--accent,#4f46e5)' : '#475467',
        dot: active ? 'var(--accent,#4f46e5)' : '#d0d5dd',
        executed: ts ? this.fmtExecuted(ts) : '\u2014',
        executedColor: ts ? '#475467' : '#c5cbd4',
        viewUrl: webUrl ? (webUrl.replace(/\/$/,'') + '/proposals/' + id) : '' };
    });
    const createMode = !this.needsProposal();

    const filled = (s.proposalId||'').trim().length>0;
    const valid = this.guidValid(s.proposalId);
    const showProposalError = this.needsProposal() && filled && !valid;
    const proposalIcon = !filled ? '' : valid ? '\u2713' : '\u2715';
    const proposalIconColor = valid ? '#3fb950' : '#d92d20';
    const proposalBorder = showProposalError ? '#f0a3a0' : '#e0e3ea';

    const runLabelMap = {
      'approve-through':'Run approve-through',
      'clone-approve':'Run clone \u2192 approve',
      'create-approve':'Run create \u2192 approve',
      'sap-fixup':'Run SAP fixup'
    };
    const canRun = !s.running && this.proposalOk();

    const logs = s.logs.map(l=>{
      const rc = l.role ? this.ROLE[l.role] : null;
      return { ts:l.ts, role:l.role, roleLabel: l.role?l.role.toUpperCase():'', roleFg: rc?rc.fg:'', roleBg: rc?rc.bg:'',
        segments: l.segments.map(sg=>({ text:sg.text, color:sg.color, weight: sg.bold?'600':'400' })) };
    });

    let result = null;
    if (s.result){
      const r = s.result;
      const statusBgMap = { '#3fb950':'rgba(63,185,80,.12)', '#d29922':'rgba(210,153,34,.14)', '#f85149':'rgba(248,81,73,.12)' };
      result = {
        statusLabel:r.statusLabel, statusColor:r.statusColor, statusBg: statusBgMap[r.statusColor]||'rgba(63,185,80,.12)',
        finalStatus:r.finalStatus, jobShort: r.jobId.slice(0,12)+'\u2026'+r.jobId.slice(-4),
        steps: r.steps.map(st=>{ const rc=this.ROLE[st.role]; return { roleLabel:st.role.toUpperCase(), roleFg:rc?rc.fg:'#667085', roleBg:rc?rc.bg:'#f1f3f5', action:st.action, color:st.color }; }),
        jsonEl: this.renderJson(r.obj)
      };
    }

    return {
      accent, showTimestamps,
      apiBaseUrl,
      copyUrl:()=>this.copyText(apiBaseUrl,'urlCopied'),
      settingsOpen: s.settingsOpen,
      openSettings:()=>this.setState({ settingsOpen:true, settingsTab:s.env }),
      closeSettings:()=>this.setState({ settingsOpen:false }),
      defaultEnvOptions, settingsTabs, settingsRoles, settingsDb,
      settingsApiBaseUrl: te.apiBaseUrl||'', apiChange: setField(['environments',s.settingsTab,'apiBaseUrl']),
      settingsWeb: te.web||'', webChange: setField(['environments',s.settingsTab,'web']),
      resetConfig:()=>this.resetConfig(),
      urlCopyLabel: s.urlCopied?'copied':'copy',
      envOptions, actions, sapOptions,
      showProposal: this.needsProposal(),
      proposalLabel: s.action==='clone-approve' ? 'Source proposal ID' : 'Proposal ID (guid)',
      proposalId: s.proposalId,
      setProposal:(e)=>this.setState({ proposalId:e.target.value }),
      fillNew:()=>this.setState({ proposalId:this.newGuid() }),
      proposalIcon, proposalIconColor, proposalBorder, showProposalError,
      recentList, createMode,
      recentEmpty: recentList.length===0,
      recentFilter: s.recentFilter,
      setRecentFilter:(e)=>this.setState({ recentFilter:e.target.value }),
      showSap: s.action==='sap-fixup',
      showContract: s.action==='sap-fixup',
      contractNumber: s.contractNumber,
      setContract:(e)=>this.setState({ contractNumber:e.target.value }),
      regenContract:()=>this.regenContract(),
      run:()=>this.run(),
      runDisabled: !canRun,
      runLabel: s.running ? 'Running\u2026' : runLabelMap[s.action],
      runBg: canRun ? 'var(--accent,#4f46e5)' : '#e4e7ec',
      runFg: canRun ? '#ffffff' : '#98a2b3',
      runCursor: canRun ? 'pointer' : 'not-allowed',
      runShadow: canRun ? '0 4px 14px color-mix(in srgb, var(--accent,#4f46e5) 34%, transparent)' : 'none',
      running: s.running,
      logs, hasLogs: logs.length>0, isEmpty: logs.length===0,
      logCountLabel: logs.length>0 ? (logs.length+' lines') : '',
      clearConsole:()=>this.clearConsole(),
      copyConsole:()=>this.copyText(s.logs.map(l=>l.raw).join('\n'),'consoleCopied'),
      consoleCopyLabel: s.consoleCopied?'copied':'copy',
      consoleRef: this.consoleRef,
      result,
      copyJob:()=> s.result && this.copyText(s.result.jobId,'jobCopied'),
      jobCopyLabel: s.jobCopied?'copied':'copy'
    };
  }
}
