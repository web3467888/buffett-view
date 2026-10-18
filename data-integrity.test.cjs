const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8').replace(/\r/g,'');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/\bsrc=|application\/ld\+json/.test(match[1])&&match[2].trim())new vm.Script(match[2]);
}
const ctx={module:{exports:{}},URLSearchParams,fetch:()=>{},scrFin:{},scrQuotes:{},scrConds:{},BOND_YIELD_CN:1.7,BOND_YIELD_US:4.3};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('data-integrity.js','utf8'),ctx);
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('半年报不能被选成年报',()=>{assert.equal(ctx.selectAnnual([{REPORTDATE:'2026-06-30',DATATYPE:'2026年 半年报'},{REPORTDATE:'2025-12-31',DATATYPE:'2025年 年报'}]).REPORTDATE,'2025-12-31');});
check('分红仅计已实施、过去12个月、去重、每10股转每股',()=>{
  const r=(d,v,p='实施分配')=>({EX_DIVIDEND_DATE:d,PRETAX_BONUS_RMB:v,ASSIGN_PROGRESS:p,REPORT_DATE:d});
  const a=r('2026-06-26',280.2423),b=r('2025-12-19',239.57);
  assert.ok(Math.abs(ctx.sumTrailingDividends([a,a,b,r('2025-06-26',276.73),r('2026-12-01',300),r('2026-07-01',100,'预案')],'2026-10-18')-51.98123)<1e-8);
});
check('缺失值及静态备用值均不通过筛选',()=>{const s={code:'x',market:'A股',roe:33,gm:90,pe:20,fcf:true,moat:'品牌'};for(const id of ['roe','gm','pe','fcf','moat','div']){ctx.scrConds[id]={val:15};assert.equal(ctx.condTest(s,{id}),false);}});
check('真实年度ROE参与筛选而非静态值',()=>{const s={code:'x',market:'A股',roe:33};ctx.scrFin.x={source:'real',roe:6.89};assert.equal(ctx.condTest(s,{id:'roe'}),false);ctx.scrFin.x.roe=32.53;assert.equal(ctx.condTest(s,{id:'roe'}),true);});
check('股息率随现价计算且禁止静态回退',()=>{const s={code:'x',market:'A股',dy:2.1};ctx.scrFin.x={source:'real',dps:51.98123,dividendVerified:true};ctx.scrQuotes.x={price:1329};assert.ok(Math.abs(ctx.scrMetric(s,'dy')-3.911304)<0.00001);ctx.scrFin.x.dividendVerified=false;assert.equal(ctx.scrMetric(s,'dy'),null);});
check('不再发布伪历史分位和买点',()=>{assert.equal(ctx.getValPercentile({pe:20}),null);assert.equal(ctx.getValLabel({val:'低估'}),'待核验');assert.ok(!ctx.renderSignal({}).includes('逆向买点'));});
check('ROE持续要求3个连续年度',()=>{const s={code:'x'};ctx.scrFin.x={source:'real',reportDate:'2025-12-31',annualHistory:[{year:2025,roe:30},{year:2023,roe:30}]};assert.ok(!ctx.renderConsistency(s).includes('近3个连续年度ROE均'));ctx.scrFin.x.annualHistory.push({year:2024,roe:30});assert.ok(ctx.renderConsistency(s).includes('近3个连续年度ROE均'));});
check('ETF不套用企业ROE筛选',()=>{const s={code:'VOO',market:'美股'};ctx.scrFin.VOO={source:'real',roe:30};assert.equal(ctx.scrMetric(s,'roe'),null);});
check('复利名义年利率月末投入及倍数标注',()=>{const source=html.match(/function series\([\s\S]*?\n}\n/)[0];vm.runInContext(source,ctx);const v=ctx.series(100000,5000,.09,35,12);assert.ok(Math.abs(v.a[35]-17015260.7230183)<.01);assert.equal(v.inv[35],2200000);assert.ok(html.includes('总资产为本金的'));});
console.log(`${checks} checks passed; inline script syntax valid.`);

