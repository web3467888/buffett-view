/* Rule scores are distinct from quality gates and manual research opinions. */
var researchSnapshot={stocks:{}},researchLoading=false,researchError='',scrRefreshPromise=null;
var scrExpanded=new Set();
var BOND_YIELD_HK=null;
var bondInputErrors={};
function escapeResearch(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function todayCN(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});}
function daysOld(date){var n=date?Math.floor((Date.parse(todayCN()+'T00:00:00Z')-Date.parse(String(date).slice(0,10)+'T00:00:00Z'))/86400000):Infinity;return Number.isFinite(n)?n:Infinity;}
function researchRecord(s){return researchSnapshot.stocks[s.code]||{};}
function researchField(s,key){var f=researchRecord(s)[key];if(!f||f.value===null||f.value===undefined)return null;var limit=['history','dps'].includes(key)?7:45;if(daysOld(f.observedAt)>limit||daysOld(f.observedAt)<-1)return null;if(['roe','gm','debt','fcf','annualRoe'].includes(key)&&daysOld(f.period)>550)return null;return f;}
function quoteUsable(q){return !!q&&finiteMetric(q.price)!==null&&q.price>0&&daysOld(q.date)<=4&&daysOld(q.date)>=-1;}
function scrMetric(s,key){if(isFund(s)&&['roe','gm','debt','fcf'].includes(key))return null;var f=researchField(s,key==='dy'?'dps':key);if(!f)return null;if(key==='dy'){var q=scrQuotes[s.code];return quoteUsable(q)&&q.price>0?f.value/q.price*100:null;}return finiteMetric(f.value);}
function livePeVerified(s){var q=scrQuotes[s.code];return quoteUsable(q)&&q.pe>0?finiteMetric(q.pe):null;}
function getValPercentile(s){
  if(isFund(s))return null;var h=researchField(s,'history');if(!h||!Array.isArray(h.value)||h.frequency!=='monthly-last-available'||!h.latestObservationDate||h.latestObservationDate!==h.end||daysOld(h.end)>7||daysOld(h.end)<-1)return null;
  var pe=finiteMetric(h.latestPE);if(!(pe>0))return null;var a=h.value.filter(v=>finiteMetric(v)!==null&&v>0);if(a.length<24)return null;var less=a.filter(v=>v<pe).length,equal=a.filter(v=>v===pe).length;
  return {pct:(less+equal*.5)/a.length*100,pe:pe,start:h.start,end:h.end,count:a.length,source:h.source};
}
function renderValPercentile(s){var p=getValPercentile(s);return '<div class="scr-val-pct">'+(p?'历史PE(TTM)位置 '+p.pct.toFixed(1)+'% · 同源PE '+p.pe.toFixed(2)+' · '+p.start+'—'+p.end+' · '+p.count+'个月度末次样本（各月等权，非内在价值）':'历史PE位置：'+(isFund(s)?'不适用公司PE模型':'数据不足或过期，未使用经验区间替代'))+'</div>';}
function moatReview(s){var r=kvGet('scr_moat_reviews',{})[s.code];return r&&daysOld(r.date)<=365&&/^https:\/\//.test(r.source||'')?r:null;}
function saveMoatReview(code){var url=($('moat-source-'+code)?.value||'').trim();try{if(new URL(url).protocol!=='https:')throw Error();}catch(e){alert('请填写可核查的HTTPS证据链接');return;}var all=kvGet('scr_moat_reviews',{});all[code]={date:todayCN(),source:url};kvSet('scr_moat_reviews',all);renderStocks();}
function qualityStatus(s){
  if(isFund(s))return {state:'na',text:'基金需独立评估，不适用企业质量门槛'};if(s.bank||['BRK.B','01299'].includes(s.code))return {state:'unknown',text:'金融业需另核验资本、资产质量及偿付能力'};
  var h=researchField(s,'annualRoe'),cash=researchField(s,'fcf'),fcf=scrMetric(s,'fcf'),missing=[],failed=[];
  if(typeof getCircleCheck==='function'&&getCircleCheck(s.code)==='no')failed.push('你已标记不理解该生意');
  if(!h||!Array.isArray(h.value))missing.push('连续年度ROE');else{var year=+h.period.slice(0,4),m=new Map(h.value.map(x=>[x.year,x.roe])),v=[0,1,2].map(n=>finiteMetric(m.get(year-n)));if(v.some(x=>x===null))missing.push('连续3年ROE');else if(v.some(x=>x<15))failed.push('近3年ROE并非每年≥15%');}
  if(fcf===null)missing.push('年度自由现金流');else if(!h||cash.period!==h.period)missing.push('自由现金流与最新年度ROE报告期不一致，待同年度数据');else if(fcf<=0)failed.push('年度自由现金流不为正');
  if(!s.moat||s.moat==='弱')failed.push('护城河标签为弱或未标记');
  return failed.length?{state:'fail',text:failed.join('；')}:missing.length?{state:'unknown',text:missing.join('；')}:{state:'pass',text:'近3年ROE≥15%、同年度FCF为正、原站护城河标签达标'};
}
function getBondCmpData(s){var dy=scrMetric(s,'dy');if(dy===null)return null;var us=s.market==='美股'||(isFund(s)&&!/^\d{6}$/.test(s.code)),hk=s.market==='港股',rate=hk?BOND_YIELD_HK:us?BOND_YIELD_US:BOND_YIELD_CN;return finiteMetric(rate)!==null?{dy:dy,bondRate:rate,win:dy>=rate,spread:dy-rate,market:hk?'香港':us?'美国':'中国',assumption:true}:null;}
function updateBondAssumption(market,value){var text=String(value??'').trim(),rate=text===''?null:Number(text),valid=rate!==null&&Number.isFinite(rate)&&rate>=0&&rate<=10;bondInputErrors[market]=text!==''&&!valid?'请输入0—10之间的数值；当前未设置，不参与评分。':'';rate=valid?rate:null;if(market==='CN')BOND_YIELD_CN=rate;else if(market==='US')BOND_YIELD_US=rate;else BOND_YIELD_HK=rate;renderStocks();}
function updateBondCN(value){updateBondAssumption('CN',value);}
function updateBondUS(value){updateBondAssumption('US',value);}
function updateBondHK(value){updateBondAssumption('HK',value);}
function renderBondInput(market,label,value){return label+' <input aria-label="'+label+'国债手动假设" aria-describedby="bond-error-'+market+'" type="number" min="0" max="10" step="0.1" value="'+(value===null?'':value)+'" placeholder="未设置" onchange="updateBond'+market+'(this.value)">%<span id="bond-error-'+market+'" role="alert">'+escapeResearch(bondInputErrors[market]||'')+'</span>';}
function signalDetails(s){
  if(isFund(s))return {score:null,missing:['基金不适用此公司评分']};var p=getValPercentile(s),b=getBondCmpData(s),roe=scrMetric(s,'roe'),missing=[];
  if(!p){var h=researchField(s,'history');missing.push(h?.latestObservationDate&&!(finiteMetric(h.latestPE)>0)?'最新同源PE非正或缺失（PE模型不适用）':'历史PE');}if(!b)missing.push(s.market==='港股'?'港币国债基准或股息':'股息/价格或国债基准');if(roe===null)missing.push('年度ROE');if(missing.length)return {score:null,missing:missing};
  var v=p.pct<30?50:p.pct<50?25:p.pct>70?-20:5,d=b.win?30:-10,m=s.moat&&s.moat!=='弱'?15:0,r=roe>=15?5:0;
  return {score:Math.max(0,Math.min(100,v+d+m+r)),factors:[['历史PE位置',v],['股息vs手动国债假设',d],['原站人工护城河标签',m],['年度ROE',r]],pct:p.pct};
}
function calcSignalScore(s){return signalDetails(s).score;}
function getValLabel(s){var p=getValPercentile(s);return !p?'待核验':p.pct<30?'历史低位':p.pct>70?'历史高位':'历史中段';}
function signalPresentation(score){return score===null?{cls:'wait',icon:'',title:'数据待更新'}:score>=60?{cls:'buy',icon:'🎯',title:'逆向买点'}:score>=30?{cls:'wait',icon:'⏸',title:'耐心等待'}:{cls:'avoid',icon:'🚫',title:'估值偏高'};}
function renderSignal(s){var d=signalDetails(s),p=signalPresentation(d.score);return '<div class="scr-signal '+p.cls+'"><span class="scr-signal-icon">'+p.icon+'</span><div class="scr-signal-body"><b>'+p.title+'</b><div>'+(d.factors?d.factors.map(x=>escapeResearch(x[0])+' '+(x[1]>=0?'+':'')+x[1]).join('；'):escapeResearch(d.missing.join('、')))+'</div><small>原四因子0—100分，财务提示另列，不改变信号灯。分数用于排序，分红与价格会变化。</small></div><b class="scr-signal-score">'+(d.score===null?'—':d.score)+'</b></div>';}
function renderSignalCompact(s){var d=signalDetails(s),p=signalPresentation(d.score);return '<div class="scr-signal-compact"><span class="scr-sig-chip '+p.cls+'">'+p.icon+' '+p.title+' · 逆向买点分 '+(d.score===null?'待数据':d.score+'/100')+'</span></div>';}
function dividendStatus(s){var f=researchField(s,'dividendContinuity'),expected=+todayCN().slice(0,4)-1;if(!f||!Array.isArray(f.years)||f.years.length!==3||!f.years.every((year,i)=>year===expected-2+i)||!Array.isArray(f.paidYears))return 'unknown';if(f.value===true&&f.years.every(year=>f.paidYears.includes(year)))return 'pass';return f.value===false?'fail':'unknown';}
function renderDividendContinuity(s){var f=researchField(s,'dividendContinuity'),state=dividendStatus(s);return '<div class="scr-consistency">连续分红：'+(state==='unknown'?'记录待更新':(state==='pass'?'✓ 最近3个完整年度均有现金分红':'未满足最近3年连续现金分红')+'（'+f.years.join('、')+'）')+' · 按除息日期核验</div>';}
function renderConsistency(s){return '<div class="scr-consistency">财务提示：'+escapeResearch(qualityStatus(s).text)+'</div>'+renderDividendContinuity(s);}
function renderBondCmp(s){var b=getBondCmpData(s);return '<div class="scr-bond-cmp">'+(b?'税前TTM股息率 '+b.dy.toFixed(2)+'% · '+b.market+'10年国债手动假设 '+b.bondRate.toFixed(1)+'%（非自动更新；风险不同）':'股息或同币种基准缺失，不作比较')+'</div>';}
function condResult(s,id){var c=scrConds[id],v;if(!c?.on)return 'off';if(id==='div')return dividendStatus(s);if(id==='moat')return s.moat&&s.moat!=='弱'?'pass':'fail';if(isFund(s)||(['debt','gm','fcf'].includes(id)&&s.bank))return 'na';v=id==='pe'?livePeVerified(s):scrMetric(s,id);if(v===null)return 'unknown';return (id==='fcf'?v>0:['debt','pe'].includes(id)?v>=0&&v<=c.val:v>=c.val)?'pass':'fail';}
function condTest(s,c){return ['pass','na','off'].includes(condResult(s,c.id));}
function filterState(s){var a=COND_DEFS.map(c=>({id:c.id,state:condResult(s,c.id)}));return {failed:a.filter(x=>x.state==='fail'),missing:a.filter(x=>x.state==='unknown'),na:a.filter(x=>x.state==='na')};}
function scrTest(s){var f=filterState(s);return !f.failed.length&&!f.missing.length;}
function sortStocks(list){function v(s){if(scrSort==='val')return getValPercentile(s)?.pct??null;if(scrSort==='signal')return calcSignalScore(s);if(scrSort==='pe')return livePeVerified(s);return scrMetric(s,scrSort==='dy'?'dy':'roe');}return list.slice().sort((a,b)=>{var x=v(a),y=v(b);return x===null&&y===null?0:x===null?1:y===null?-1:['val','pe'].includes(scrSort)?x-y:y-x;});}
function toggleCard(code){var open=!scrExpanded.has(code);if(open)scrExpanded.add(code);else scrExpanded.delete(code);var el=$('card-'+code);if(!el)return;el.classList.toggle('expanded',open);var button=el.querySelector('.scr-stock-head button'),s=stocks.find(x=>x.code===code);if(button&&s){button.setAttribute('aria-expanded',String(open));button.lastChild.textContent=' '+s.market+' '+code+' · '+(open?'收起':'展开');}}
function screenerExplanation(c){var note=c.id==='div'?'当前筛选口径：最近3个完整自然年每年均有已发生现金分红，按除息日期核验；只有回购不计入。':c.id==='roe'?'当前滑块筛选最近完整年报ROE，连续年度表现另列于卡片财务提示。':c.id==='fcf'?'当前使用年度经营现金流减资本开支的统一测算值，来源与报告期见标的卡片。':c.id==='moat'?'当前沿用原站护城河标签和简评。':'';return c.explain+(note?'<p class="scr-help-note">'+note+'</p>':'');}
function syncScrHelp(id,open){var button=$('scr-help-button-'+id);if(button)button.setAttribute('aria-expanded',String(open));}
function toggleScrHelp(id,button,event){event.preventDefault();event.stopPropagation();var pop=$('scr-help-'+id);if(pop.matches(':popover-open')){pop.hidePopover();return;}pop.showPopover();var rect=button.getBoundingClientRect(),box=pop.getBoundingClientRect(),gap=10,left=Math.max(12,Math.min(rect.left,window.innerWidth-box.width-12)),top=rect.bottom+gap;if(top+box.height>window.innerHeight-12)top=Math.max(12,rect.top-box.height-gap);pop.style.left=left+'px';pop.style.top=top+'px';}
function renderScreener(){
  $('scrMarketTabs').innerHTML=MARKETS.map(m=>'<button type="button" class="scr-market-tab'+(m===scrMarket?' on':'')+'" onclick="scrSetMarket(\''+escapeResearch(m)+'\')">'+escapeResearch(m)+'</button>').join('');
  $('scrConds').innerHTML=COND_DEFS.map(c=>{
    var a=scrConds[c.id],desc=c.id==='div'?'打开后仅显示近3年每年现金分红的标的':c.desc;
    var help='<button type="button" class="scr-help-button" id="scr-help-button-'+c.id+'" aria-label="'+escapeResearch(c.name)+'指标说明" aria-controls="scr-help-'+c.id+'" aria-expanded="false" onclick="toggleScrHelp(\''+c.id+'\',this,event)">i</button>';
    var pop='<div class="scr-help-pop" id="scr-help-'+c.id+'" popover="auto" role="region" aria-label="'+escapeResearch(c.name)+'说明" ontoggle="syncScrHelp(\''+c.id+'\',event.newState===\'open\')"><b>'+escapeResearch(c.name)+'指标说明</b><div>'+screenerExplanation(c)+'</div></div>';
    return '<div class="scr-cond'+(a.on?' on':'')+'" id="scrCond-'+c.id+'"><div class="scr-cond-head" onclick="scrToggleCond(\''+c.id+'\')"><div class="scr-cond-info"><span class="scr-cond-name">'+escapeResearch(c.name)+'<span id="scrCondVal-'+c.id+'">'+(c.type==='range'?a.val+(c.id==='pe'?'':'%'):'')+'</span>'+help+'</span><span class="scr-cond-desc">'+escapeResearch(desc)+'</span></div><button type="button" class="scr-toggle-button" role="switch" aria-label="'+escapeResearch(c.name)+'筛选" aria-checked="'+!!a.on+'" onclick="event.stopPropagation();scrToggleCond(\''+c.id+'\')"><span class="scr-cond-toggle'+(a.on?' on':'')+'"></span></button></div>'+pop+(c.type==='range'?'<input aria-label="'+escapeResearch(c.name)+'阈值" type="range" min="'+c.min+'" max="'+c.max+'" step="'+c.step+'" value="'+a.val+'" oninput="scrCondVal(\''+c.id+'\',this.value)">':'')+'</div>';
  }).join('');renderStocks();updateScrUIBtns();
}
function scrCondVal(id,value){scrConds[id].val=+value;var label=$('scrCondVal-'+id);if(label)label.textContent=value+(id==='pe'?'':'%');renderStocks();}
function toggleAllConds(){var on=!COND_DEFS.some(c=>scrConds[c.id].on);COND_DEFS.forEach(c=>scrConds[c.id].on=on);renderScreener();}
function resetScreener(){scrMarket='全部';scrQuery='';scrSort='val';$('scrQ').value='';$('scrFavOnly').checked=false;COND_DEFS.forEach(c=>scrConds[c.id]={on:['roe','debt','gm','pe'].includes(c.id),val:c.def});document.querySelectorAll('.scr-sort-item').forEach(el=>el.classList.toggle('on',el.dataset.sort==='val'));hideScrHistory();renderScreener();}
function toggleFav(code){var a=getFavs(),i=a.indexOf(code);if(i>=0)a.splice(i,1);else a.push(code);saveFavs(a);renderStocks();}
function renderScrHistory(){var el=$('scrHistory');el.replaceChildren();getSearchHist().forEach(q=>{var row=document.createElement('div'),button=document.createElement('button'),del=document.createElement('button');row.className='scr-history-item';button.textContent=q;button.onclick=()=>scrSearchCommit(q);del.textContent='删除';del.onclick=()=>scrDelHist(q);row.append(button,del);el.append(row);});}
function visibleScreenerStocks(list){
  return list.filter(s=>!scrConds.div?.on||dividendStatus(s)==='pass').filter(s=>scrQuery||!filterState(s).failed.length);
}
function renderStocks(){
  var favs=getFavs(),favOnly=$('scrFavOnly')?.checked;
  var list=stocks.filter(s=>(scrMarket==='全部'||s.market===scrMarket)&&(!favOnly||favs.includes(s.code))&&(!scrQuery||(s.name+' '+s.code+' '+s.py+' '+(s.al||[]).join(' ')).toLowerCase().includes(scrQuery.toLowerCase())));
  var shown=visibleScreenerStocks(list),passed=shown.filter(scrTest),pending=shown.filter(s=>filterState(s).missing.length);
  if($('scrMobileCount'))$('scrMobileCount').textContent=shown.length;
  $('scrCount').textContent='研究池 '+list.length+' · 条件满足 '+passed.length+' · 待数据 '+pending.length+' · 显示 '+shown.length;
  $('scrSortLbl').textContent=({val:'历史PE位置',roe:'年度ROE',pe:'当前PE',dy:'TTM股息率',signal:'逆向买点分'})[scrSort];
  $('scrStockList').innerHTML=sortStocks(shown).map(s=>{
    var q=scrQuotes[s.code],record=researchRecord(s);
    var metrics=[['roe','ROE'],['debt','负债率'],['gm','毛利率'],['pe','PE'],['dy','股息率']].map(([key,title])=>{
      var v=key==='pe'?livePeVerified(s):scrMetric(s,key),f=researchField(s,key==='dy'?'dps':key);
      return '<div class="scr-metric"><div class="k">'+title+'</div><b>'+(v===null?'—':v.toFixed(key==='dy'?2:1)+(key==='pe'?'':'%'))+'</b><div class="k">'+escapeResearch(key==='pe'?q?.date||'':f?.period||'')+'</div></div>';
    }).join('');
    var sources=Object.entries(record).filter(([k,v])=>v&&typeof v==='object'&&v.source).map(([k,v])=>'<a href="'+escapeResearch(v.source)+'" target="_blank" rel="noopener">'+escapeResearch(k)+' · '+escapeResearch(v.period||v.observedAt)+'</a>').join(' · ');
    return '<div class="scr-stock expanded" id="card-'+s.code+'">'+
      '<div class="scr-stock-head"><div><b>'+escapeResearch(s.name)+'</b> <span class="scr-market-tag">'+escapeResearch(s.market)+'</span> <small>'+s.code+'</small></div><button class="scr-fav" title="'+(favs.includes(s.code)?'取消收藏':'收藏')+'" onclick="toggleFav(\''+s.code+'\')">'+(favs.includes(s.code)?'★':'☆')+'</button></div>'+
      (q?'<div class="scr-quote-bar">'+fmtPrice(q.price,s.market,s.code)+' · PE '+(q.pe>0?q.pe.toFixed(2):'—')+' · '+escapeResearch(q.time||'')+(quoteUsable(q)?'':' · 已过期')+'</div>':'<div>行情'+(researchLoading?'加载中':'待更新')+'</div>')+
      renderSignalCompact(s)+'<div class="scr-stock-detail">'+
      '<p><b>护城河简评：</b>'+escapeResearch(s.moatBrief)+' <span class="scr-market-tag">'+escapeResearch(s.moat)+'</span></p>'+
      '<div class="scr-metrics">'+metrics+'</div>'+renderValPercentile(s)+renderBondCmp(s)+renderSignal(s)+renderConsistency(s)+renderCircleCheck(s)+
      '<details><summary>数据来源与报告期</summary>'+sources+'<p>FCF：'+escapeResearch(record.fcf?.definition||'未取得')+'。金额按来源报表币种，不能跨币种比较。</p></details></div></div>';
  }).join('')||'<div class="scr-empty">'+(researchLoading?'正在加载分红与财报记录…':scrConds.div?.on?'当前范围内没有同时满足条件且已核实近3年连续分红的标的。关闭连续分红条件可查看其他标的。':'没有符合当前条件的标的。')+'<br><button class="scr-btn" onclick="resetScreener()">重置筛选条件</button></div>';
  updateScanBanner();
}
function updateScanBanner(){
  var el=$('scrScanBanner');if(!el)return;
  var counts={buy:0,wait:0,avoid:0};stocks.forEach(s=>{var score=calcSignalScore(s);if(score!==null)counts[score>=60?'buy':score>=30?'wait':'avoid']++;});
  el.style.display='';el.innerHTML='<div class="scr-scan-body"><b>🎯 逆向机会扫描</b><p>逆向买点 <b>'+counts.buy+'</b> · 耐心等待 <b>'+counts.wait+'</b> · 估值偏高 <b>'+counts.avoid+'</b>。固定研究池'+stocks.length+'只，按原四因子计算逆向买点分，财务提示独立展示。</p><small>'+escapeResearch(researchLoading?'正在更新数据…':researchError||'研究数据：'+(researchSnapshot.asOf||'加载中'))+'</small><div>国债手动假设：'+renderBondInput('CN','中国',BOND_YIELD_CN)+' '+renderBondInput('US','美国',BOND_YIELD_US)+'；'+renderBondInput('HK','香港',BOND_YIELD_HK)+'。空值不计分；历史PE使用真实观测，分数用于研究排序。</div></div>';
  var toast=$('scrSignalToast');if(toast)toast.classList.remove('show');
}
async function timedFetch(url){var c=new AbortController(),t=setTimeout(()=>c.abort(),18000);try{var r=await fetch(url,{signal:c.signal,cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r;}finally{clearTimeout(t);}}
async function readResearchSnapshot(){var r=await timedFetch('research-data.json'),data=await r.json();if(data.schema!==2||!data.stocks)throw Error('研究快照格式错误');researchSnapshot=data;Object.entries(data.stocks).forEach(([code,v])=>scrFin[code]={source:'real',roe:v.roe?.value??null,gm:v.gm?.value??null,debt:v.debt?.value??null,reportDate:v.roe?.period||''});}
function parseQuoteResponse(text){var out={},re=/v_(\S+?)="([^"]*)"/g,m;while((m=re.exec(text))!==null){var s=stocks.find(x=>qtCode(x)===m[1]);if(!s)continue;var f=m[2].split('~'),price=Number(f[3]),raw=f[30]||'',date=/^\d{14}$/.test(raw)?raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8):raw.slice(0,10).replace(/\//g,'-');if(!f[3]||!Number.isFinite(price)||price<=0)continue;out[s.code]={price:price,pe:f[39]&&Number(f[39])>0?Number(f[39]):null,chg:price-Number(f[4]),chgPct:finiteMetric(Number(f[32])),time:fmtQtTime(raw),date:date,receivedAt:new Date().toISOString()};}return out;}
function fetchQuotes(){if(scrRefreshPromise)return scrRefreshPromise;researchLoading=true;researchError='';scrQuoteLoading=true;var btn=$('scrRefreshBtn');if(btn)btn.disabled=true;renderStocks();scrRefreshPromise=(async()=>{var results=await Promise.allSettled([readResearchSnapshot(),(async()=>{var r=await timedFetch('https://qt.gtimg.cn/q='+stocks.map(qtCode).join(',')),text=new TextDecoder('gbk').decode(await r.arrayBuffer()),next=parseQuoteResponse(text);if(!Object.keys(next).length)throw Error('报价响应无有效标的');Object.entries(next).forEach(([k,v])=>scrQuotes[k]=v);})()]);researchError=results.map((r,i)=>r.status==='rejected'?(i?'行情':'研究快照')+'获取失败，保留上次成功值（请检查日期）':'').filter(Boolean).join('；');researchLoading=false;scrQuoteLoading=false;scrRefreshPromise=null;if(btn)btn.disabled=false;var st=$('scrQuoteStatus');if(st)st.textContent=researchError?'部分失败':'已检查 '+new Date().toLocaleTimeString('zh-CN');renderStocks();})();return scrRefreshPromise;}
function fetchFinData(){return fetchQuotes();}
function qtCode(s){if(/^\d{6}$/.test(s.code))return (/^[56]/.test(s.code)?'sh':'sz')+s.code;if(s.market==='港股')return 'hk'+s.code;return 'us'+s.code;}
function fmtPrice(v,market,code){if(finiteMetric(v)===null)return '—';return (market==='A股'||/^\d{6}$/.test(code||'')?'¥':market==='港股'?'HK$':'$')+v.toFixed(2);}
function maybeFetchHoldQuotes(){if(holdQuotesFetched)return;var codes=userLoad('holds','[]').map(h=>findStock(h.code)).filter(Boolean).map(qtCode);if(!codes.length)return;holdQuotesFetched=true;timedFetch('https://qt.gtimg.cn/q='+codes.join(',')).then(r=>r.arrayBuffer()).then(buf=>{var parsed=parseQuoteResponse(new TextDecoder('gbk').decode(buf));Object.entries(parsed).forEach(([k,v])=>scrQuotes[k]={...scrQuotes[k],...v});renderHoldBoard();}).catch(()=>{holdQuotesFetched=false;});}
function initResearch(){resetScreener();var menu=$('scrSortMenu');if(menu){menu.querySelector('[data-sort="val"]').textContent='历史PE位置（低到高）';menu.querySelector('[data-sort="signal"]').textContent='逆向买点分（高到低）';}fetchQuotes();}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initResearch);else initResearch();}
