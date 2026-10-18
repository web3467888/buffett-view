/* Verified financial data only. Missing evidence must remain unknown. */
'use strict';
function finiteMetric(v){ return typeof v==='number'&&Number.isFinite(v)?v:null; }
function isFund(s){ return s.market==='ETF'||s.market==='指数'||['VOO','SPY','VTI','QQQ','TLT','BND'].includes(s.code); }
function scrMetric(s,key){
  var f=scrFin[s.code];
  if(isFund(s)&&['roe','gm','debt'].includes(key)) return null;
  if(!f||f.source!=='real') return null;
  if(key==='dy'){
    var price=finiteMetric(scrQuotes[s.code]&&scrQuotes[s.code].price);
    return f.dividendVerified&&price>0?f.dps/price*100:null;
  }
  return finiteMetric(f[key]);
}
function livePeVerified(s){ return finiteMetric(scrQuotes[s.code]&&scrQuotes[s.code].pe); }
function selectAnnual(rows){ return rows.filter(r=>String(r.REPORTDATE||'').slice(5,10)==='12-31'&&/年报/.test(r.DATATYPE||'')&&!/半年/.test(r.DATATYPE||'')).sort((a,b)=>String(b.REPORTDATE).localeCompare(String(a.REPORTDATE)))[0]||null; }
function sumTrailingDividends(rows,asOf){
  var end=new Date(asOf+'T00:00:00Z'),start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-1);
  var seen=new Set(),sum=0;
  rows.forEach(r=>{
    var date=String(r.EX_DIVIDEND_DATE||'').slice(0,10),t=new Date(date+'T00:00:00Z');
    if(r.ASSIGN_PROGRESS!=='实施分配'||!Number.isFinite(t.getTime())||t<=start||t>end) return;
    if([r.BONUS_IT_RATIO,r.BONUS_RATIO,r.IT_RATIO].some(v=>finiteMetric(v)!==null&&v>0))throw new Error('存在送转，需核验每股单位调整');
    var amount=finiteMetric(r.PRETAX_BONUS_RMB),key=date+'|'+String(r.REPORT_DATE);
    if(amount===null||amount<0)throw new Error('已实施分红金额不完整');
    if(seen.has(key))return;
    seen.add(key);sum+=amount/10;
  });
  return sum;
}
async function finRows(report,code,size,sort){
  var query=new URLSearchParams({reportName:report,columns:'ALL',filter:'(SECURITY_CODE="'+code+'")',pageSize:String(size),pageNumber:'1',sortColumns:sort,sortTypes:'-1'});
  var response=await fetch('https://datacenter-web.eastmoney.com/api/data/v1/get?'+query);
  if(!response.ok) throw new Error('财报接口请求失败');
  var data=await response.json();
  if(!data.success||!data.result||!Array.isArray(data.result.data)) throw new Error('财报数据不可用');
  if(data.result.pages>1&&report==='RPT_SHAREBONUS_DET') throw new Error('分红事件未完整返回');
  return data.result.data;
}
async function fetchOneFin(s){
  var f={source:'real',roe:null,gm:null,debt:null,dy:null,dps:null,reportDate:'',dividendVerified:false,annualHistory:[]};
  // Independent requests: failure of one field does not erase another verified field.
  await Promise.allSettled([
    (async()=>{var rows=await finRows('RPT_LICO_FN_CPD',s.code,100,'REPORTDATE'),a=selectAnnual(rows);if(!a)return;f.roe=finiteMetric(a.WEIGHTAVG_ROE);f.gm=finiteMetric(a.XSMLL);f.reportDate=a.REPORTDATE.slice(0,10);f.annualHistory=rows.filter(r=>/12-31/.test(r.REPORTDATE||'')).map(r=>({year:+r.REPORTDATE.slice(0,4),roe:finiteMetric(r.WEIGHTAVG_ROE)}));})(),
    (async()=>{var rows=await finRows('RPT_DMSK_FN_BALANCE',s.code,100,'REPORT_DATE');if(rows[0]){f.debt=finiteMetric(rows[0].DEBT_ASSET_RATIO);f.balanceDate=String(rows[0].REPORT_DATE).slice(0,10);}})(),
    (async()=>{var rows=await finRows('RPT_SHAREBONUS_DET',s.code,100,'EX_DIVIDEND_DATE');var today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});f.dps=sumTrailingDividends(rows,today);f.dividendVerified=true;f.dividendDate=today;})()
  ]);
  scrFin[s.code]=f;
}
async function fetchFinData(){
  var list=stocks.filter(s=>s.market==='A股');
  for(var i=0;i<list.length;i+=4){await Promise.allSettled(list.slice(i,i+4).map(fetchOneFin));renderStocks();}
}
function getValPercentile(){return null;}
function renderValPercentile(){return '<div class="scr-val-pct">历史估值分位：待核验（尚未接入历史 PE 序列）</div>';}
function getValLabel(){return '待核验';}
function calcSignalScore(){return 0;}
function renderSignal(){return '<div class="scr-signal wait"><div class="scr-signal-body"><b>待研究 · 证据不足</b><div>缺少经核验的历史估值及完整基本面证据，暂不生成买点或综合评分。</div></div></div>';}
function renderSignalCompact(s){
  var roe=scrMetric(s,'roe'),dy=scrMetric(s,'dy'),pe=livePeVerified(s);
  return '<div class="scr-signal-compact"><span class="scr-sig-chip wait">待核验 · 无评分</span><div class="scr-sig-quick">ROE '+(roe===null?'—':roe.toFixed(1)+'%')+' · PE '+(pe>0?pe.toFixed(1):'—')+' · 股息率(TTM) '+(dy===null?'—':dy.toFixed(2)+'%')+'</div></div>';
}
function renderConsistency(s){
  var f=scrFin[s.code],a=f&&f.annualHistory||[],years=new Map(a.map(r=>[r.year,r.roe])),latest=f&&f.reportDate?+f.reportDate.slice(0,4):null;
  var consistent=latest!==null&&[0,1,2].every(n=>finiteMetric(years.get(latest-n))!==null&&years.get(latest-n)>=15);
  return '<div class="scr-consistency">'+(consistent?'近3个连续年度ROE均≥15%':'连续年度ROE：未确认达标')+' · 自由现金流：待核验 · 护城河简评：人工研究观点</div>';
}
function getBondCmpData(s){
  var dy=scrMetric(s,'dy');if(dy===null)return null;
  var us=s.market==='美股'||s.market==='ETF'||s.market==='指数',rate=us?BOND_YIELD_US:BOND_YIELD_CN;
  if(s.market==='港股')return null; // No verified HKD benchmark available.
  return {dy:dy,bondRate:rate,win:dy>=rate,spread:dy-rate,market:us?'美国':'中国'};
}
function renderBondCmp(s){var bc=getBondCmpData(s);return bc?'<div class="scr-bond-cmp">税前股息率(TTM) '+bc.dy.toFixed(2)+'% · '+bc.market+'10年国债手动参考值 '+bc.bondRate.toFixed(1)+'%（无自动更新时间；风险不同，不代表等价收益）</div>':'<div class="scr-bond-cmp">股息或同币种国债数据未核验，暂不比较</div>';}
function updateScanBanner(){var el=$('scrScanBanner');if(el){el.style.display='';el.innerHTML='<div class="scr-scan-body"><b>研究数据状态</b><div>历史估值分位与综合买点评分暂未启用。财报按报告期展示；股息率按过去12个月已实施除息记录计算。缺失值不视为通过筛选。</div></div>';}var toast=$('scrSignalToast');if(toast)toast.classList.remove('show');}
function showSignalToast(){}
function resetScreener(){scrMarket='全部';scrQuery='';scrSort='val';$('scrQ').value='';COND_DEFS.forEach(c=>{scrConds[c.id]={on:!['fcf','moat','div'].includes(c.id),val:c.def};});hideScrHistory();renderScreener();}
function condTest(s,cd){
  var c=scrConds[cd.id],v;
  switch(cd.id){
    case 'roe':v=scrMetric(s,'roe');return v!==null&&v>=c.val;
    case 'gm':v=scrMetric(s,'gm');return v!==null&&v>=c.val;
    case 'debt':v=scrMetric(s,'debt');return !s.bank&&v!==null&&v<=c.val;
    case 'pe':v=livePeVerified(s);return !isFund(s)&&v!==null&&v>0&&v<=c.val;
    // No audited FCF, moat or multi-year distributions dataset is connected.
    case 'fcf':case 'moat':case 'div':return false;
    default:return false;
  }
}
function sortStocks(list){
  function value(s){if(scrSort==='roe')return scrMetric(s,'roe');if(scrSort==='dy')return scrMetric(s,'dy');if(scrSort==='pe')return livePeVerified(s);return null;}
  return list.slice().sort((a,b)=>{var x=value(a),y=value(b);if(x===null&&y===null)return 0;if(x===null)return 1;if(y===null)return -1;return scrSort==='pe'?x-y:y-x;});
}
function runBacktest(){var box=$('btResult');if(box){box.style.display='block';box.innerHTML='<div class="bt-munger"><b>历史回测暂不可用</b><p>原演示价格及分红加总不能代表真实历史回报。待接入除权、分红事件和再投资价格后，再提供可核验的回测结果。</p></div>';}}
if(typeof module!=='undefined')module.exports={selectAnnual,sumTrailingDividends,finiteMetric};
if(typeof document!=='undefined'){
  // Unsupported evidence conditions remain available, but are never silently
  // enabled for the initial view or represented as verified facts.
  ['fcf','moat','div'].forEach(id=>{if(scrConds[id])scrConds[id].on=false;});
  function integrityReady(){renderScreener();if($('view-deposit')&&$('view-deposit').classList.contains('active'))calcCompound();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',integrityReady);else integrityReady();
}
