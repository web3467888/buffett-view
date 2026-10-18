"""Refresh public research snapshots. No credentials, no synthetic fallbacks.
Run manually or from an explicitly configured scheduled job. Failures preserve
the previous successful field with its original observation date.
"""
import datetime as dt,json,math,pathlib,re,time,urllib.request,urllib.parse,sys
ROOT=pathlib.Path(__file__).parent
TODAY=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
BASE='https://datacenter-web.eastmoney.com/api/data/v1/get'
SEC='https://datacenter.eastmoney.com/securities/api/data/v1/get'
OUT=ROOT/'research-data.json'
def finite(v): return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def request(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 AwenResearch/1.0'}),timeout=12) as r:return json.load(r)
def rows(report,code,columns='ALL',sort='REPORT_DATE',size=100,extra='',sec=False):
    base=SEC if sec else BASE
    condition=('(SECUCODE="'+code+'")') if code.endswith('.HK') else '(SECURITY_CODE="'+code+'")'
    params=dict(reportName=report,columns=columns,filter=condition+extra,sortColumns=sort,sortTypes='-1',pageSize=size,pageNumber=1,source='WEB',client='WEB')
    url=base+'?'+urllib.parse.urlencode(params); data=request(url)
    if not data.get('success') or not isinstance(data.get('result'),dict):raise ValueError(data.get('message','empty response'))
    result=data['result']
    if result.get('pages',1)>1:raise ValueError('incomplete response')
    return result.get('data',[]),url
def field(value,source,period=None,**kwargs):return dict(value=value,source=source,period=period,observedAt=str(TODAY),**kwargs)
def annual(rows):return [r for r in rows if r.get('DATE_TYPE_CODE')=='001' or (str(r.get('REPORTDATE',''))[5:10]=='12-31' and '半年' not in str(r.get('DATATYPE','')))]
def cash_value(items,code):
    matches=[x.get('AMOUNT') for x in items if x.get('STD_ITEM_CODE')==code]
    if not matches or any(not finite(v) for v in matches):return None
    if len(set(matches))!=1:raise ValueError('conflicting cashflow rows')
    return matches[0]
def history_record(entries,url):
    unique={}
    for date,pe in entries:
        if isinstance(date,str) and str(TODAY.replace(year=TODAY.year-10))<=date[:10]<=str(TODAY):
            # Keep the newest observation even when PE is not meaningful.
            unique[date[:10]]=pe if finite(pe) else None
    if not unique:raise ValueError('no dated PE observations')
    dates=sorted(unique);monthly={}
    for date in dates:monthly[date[:7]]=date
    chosen=sorted(date for date in monthly.values() if finite(unique[date]) and unique[date]>0)
    if len(chosen)<24:raise ValueError('history shorter than 24 monthly observations')
    return field(sorted(unique[d] for d in chosen),url,dates[-1],start=chosen[0],end=dates[-1],sampleEnd=chosen[-1],count=len(chosen),rawCount=len(dates),frequency='monthly-last-available',latestObservationDate=dates[-1],latestPE=unique[dates[-1]])
def get_history(s):
    code=s['code']
    if s['market']=='A股':
        data,url=rows('RPT_VALUEANALYSIS_DET',code,'TRADE_DATE,PE_TTM,SECURITY_CODE',sort='TRADE_DATE',size=5000)
        return history_record([(r.get('TRADE_DATE'),r.get('PE_TTM')) for r in data],url)
    market='hk' if s['market']=='港股' else 'us'
    url='https://gushitong.baidu.com/opendata?'+urllib.parse.urlencode(dict(openapi=1,dspName='iphone',tn='tangram',client='app',query='市盈率(TTM)',code=code,word='',resource_id=51171,market=market,tag='市盈率(TTM)',chart_select='全部',industry_select='',skip_industry=1,finClientType='pc'))
    d=request(url)['Result'][0]['DisplayData']['resultData']['tplData']['result']['chartInfo'][0]['body']
    points=[]
    for r in d:
        vals=list(r.values()) if isinstance(r,dict) else r
        if not isinstance(vals,(list,tuple)) or len(vals)<2:continue
        try: pe=float(vals[1])
        except (TypeError,ValueError):pe=None
        points.append((str(vals[0]),pe))
    return history_record(points,url)
def get_fundamentals(s):
    code=s['code'];market=s['market'];out={}
    if code in ['JPM','BAC','BRK.B']:
        report='RPT_USF10_FN_IMAININDICATOR' if code=='BRK.B' else 'RPT_USF10_FN_BMAININDICATOR'
        data,url=rows(report,'BRK_B' if code=='BRK.B' else code,size=100,extra='(DATE_TYPE_CODE="001")',sec=True)
        if not data:raise ValueError('no financial-sector annual data')
        a=data[0];period=a['REPORT_DATE'][:10]
        if finite(a.get('ROE')):out['roe']=field(a['ROE'],url,period)
        if finite(a.get('DEBT_RATIO')):out['debt']=field(a['DEBT_RATIO'],url,period)
        out['annualRoe']=field([{'year':int(r['REPORT_DATE'][:4]),'roe':r.get('ROE')} for r in data[:6]],url,period)
        return out
    if market=='A股':
        data,url=rows('RPT_LICO_FN_CPD',code,sort='REPORTDATE',size=200)
        yearly=annual(data)
        if not yearly:raise ValueError('no annual statement')
        a=yearly[0];period=a['REPORTDATE'][:10]
        for key,col in [('roe','WEIGHTAVG_ROE'),('gm','XSMLL')]:
            if finite(a.get(col)):out[key]=field(a[col],url,period)
        out['annualRoe']=field([{'year':int(r['REPORTDATE'][:4]),'roe':r.get('WEIGHTAVG_ROE')} for r in yearly[:6]],url,period)
        data,burl=rows('RPT_DMSK_FN_BALANCE',code,size=200)
        if data and finite(data[0].get('DEBT_ASSET_RATIO')):out['debt']=field(data[0]['DEBT_ASSET_RATIO'],burl,data[0]['REPORT_DATE'][:10])
        data,curl=rows('RPT_DMSK_FN_CASHFLOW',code,size=200)
        a=next((r for r in data if str(r.get('REPORT_DATE',''))[:10]==period),None)
        if a and finite(a.get('NETCASH_OPERATE')) and finite(a.get('CONSTRUCT_LONG_ASSET')):out['fcf']=field(a['NETCASH_OPERATE']-abs(a['CONSTRUCT_LONG_ASSET']),curl,period,currency='CNY',definition='统一测算：经营现金流净额-购建长期资产现金支出；非公司自报FCF')
    else:
        hk=market=='港股';c=code+'.HK' if hk else code
        data,url=rows('RPT_HKF10_FN_MAININDICATOR' if hk else 'RPT_USF10_FN_GMAININDICATOR',c,'HKF10_FN_MAININDICATOR' if hk else 'USF10_FN_GMAININDICATOR',size=100,extra='(DATE_TYPE_CODE="001")',sec=True)
        if not data:raise ValueError('no annual indicator')
        a=data[0];period=a['REPORT_DATE'][:10]
        for key,col in [('roe','ROE_AVG'),('gm','GROSS_PROFIT_RATIO'),('debt','DEBT_ASSET_RATIO')]:
            if finite(a.get(col)):out[key]=field(a[col],url,period)
        out['annualRoe']=field([{'year':int(r['REPORT_DATE'][:4]),'roe':r.get('ROE_AVG')} for r in data[:6]],url,period)
        data,curl=rows('RPT_HKF10_FN_CASHFLOW_PC' if hk else 'RPT_USSK_FN_CASHFLOW',c,size=200,extra='(REPORT_DATE=\''+period+'\')(DATE_TYPE_CODE="001")',sec=True)
        op=cash_value(data,'003999')
        capex=cash_value(data,'005005' if hk else '005002')
        intangible=cash_value(data,'005007') if hk else 0
        if finite(op) and finite(capex) and finite(intangible):out['fcf']=field(op-abs(capex)-abs(intangible),curl,period,definition='统一测算：年度经营现金流-固定资产购置'+('-无形资产购置' if hk else '')+'；非公司自报FCF')
    return out
def get_dividends(s):
    if s['market']=='A股':
        data,url=rows('RPT_SHAREBONUS_DET',s['code'],size=200,sort='EX_DIVIDEND_DATE')
        amounts={};events=[];start=TODAY.replace(year=TODAY.year-1)
        for r in data:
            date=str(r.get('EX_DIVIDEND_DATE',''))[:10]
            if r.get('ASSIGN_PROGRESS')!='实施分配' or not str(start)<date<=str(TODAY):continue
            if any(finite(r.get(k)) and r[k]>0 for k in ['BONUS_RATIO','IT_RATIO','BONUS_IT_RATIO']):raise ValueError('share distribution requires per-share adjustment')
            v=r.get('PRETAX_BONUS_RMB')
            if not finite(v) or v<0:raise ValueError('missing distribution amount')
            key=date+'|'+str(r.get('REPORT_DATE'))
            if key in amounts and amounts[key]!=v/10:raise ValueError('conflicting distribution event')
            amounts[key]=v/10
        return field(sum(amounts.values()),url,str(TODAY),currency='CNY',definition='TTM已实施税前每股现金分红')
    symbol=(s['code']+('.SS' if s['code'][0] in '56' else '.SZ')) if re.fullmatch(r'\d{6}',s['code']) else (s['code'].lstrip('0').zfill(4)+'.HK') if s['market']=='港股' else s['code'].replace('.','-')
    url='https://query1.finance.yahoo.com/v8/finance/chart/'+symbol+'?range=1y&interval=1d&events=div%2Csplits'
    d=request(url)['chart']['result'][0];meta=d['meta'];events=d.get('events',{})
    if events.get('splits'):raise ValueError('share split requires dividend adjustment')
    if meta.get('currency') not in ['USD','HKD']:raise ValueError('currency mismatch')
    values=[v['amount'] for v in events.get('dividends',{}).values() if str(TODAY.replace(year=TODAY.year-1))<dt.datetime.fromtimestamp(v['date'],dt.timezone.utc).date().isoformat()<=str(TODAY)]
    if any(not finite(v) or v<0 for v in values):raise ValueError('missing dividend amount')
    return field(sum(values),url,str(TODAY),currency=meta['currency'],definition='Yahoo已发生现金分红事件TTM')

def dividend_continuity(events,url):
    years=list(range(TODAY.year-3,TODAY.year));paid={year:False for year in years}
    for date,amount in events:
        try:date=dt.date.fromisoformat(str(date)[:10])
        except (TypeError,ValueError):raise ValueError('invalid dividend event date')
        if date.year not in paid:continue
        if not finite(amount) or amount<0:raise ValueError('missing dividend amount')
        if amount>0:paid[date.year]=True
    return field(all(paid.values()),url,str(TODAY),years=years,paidYears=[year for year in years if paid[year]],definition='最近3个完整自然年，每年均有已发生现金分红（按除息日期）；不以回购或分红预案代替')

def get_dividend_continuity(s):
    if s['market']=='A股':
        data,url=rows('RPT_SHAREBONUS_DET',s['code'],size=200,sort='EX_DIVIDEND_DATE')
        events=[(r.get('EX_DIVIDEND_DATE'),r.get('PRETAX_BONUS_RMB')) for r in data if r.get('ASSIGN_PROGRESS')=='实施分配' and r.get('EX_DIVIDEND_DATE')]
        return dividend_continuity(events,url)
    code=s['code'];symbol=(code+('.SS' if code[0] in '56' else '.SZ')) if re.fullmatch(r'\d{6}',code) else (code.lstrip('0').zfill(4)+'.HK') if s['market']=='港股' else code.replace('.','-')
    url='https://query1.finance.yahoo.com/v8/finance/chart/'+symbol+'?range=5y&interval=1mo&events=div%2Csplits'
    data=request(url)['chart']['result'][0];start=dt.date(TODAY.year-3,1,1)
    stamps=data.get('timestamp') or []
    if not stamps or dt.datetime.fromtimestamp(stamps[0],dt.timezone.utc).date()>start+dt.timedelta(days=10):raise ValueError('dividend history does not cover all 3 years')
    dividends=data.get('events',{}).get('dividends',{})
    events=[(dt.datetime.fromtimestamp(v['date'],dt.timezone.utc).date().isoformat(),v.get('amount')) for v in dividends.values()]
    return dividend_continuity(events,url)
def main():
    text=(ROOT/'index.html').read_text(encoding='utf-8');block=text.split('const stocks=[',1)[1].split('\n];',1)[0]
    stocks=[dict(zip(['code','name','market'],m)) for m in re.findall(r"\{code:'([^']+)',name:'([^']+)'.*?market:'([^']+)'",block)]
    data=json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'schema':2,'stocks':{}}
    history_only='--history-only' in sys.argv;dividends_only='--dividends-only' in sys.argv;subset=set(x for x in sys.argv[1:] if not x.startswith('--'));targets=[s for s in stocks if not subset or s['code'] in subset]
    for s in targets:
        record=data['stocks'].setdefault(s['code'],{});record.update(name=s['name'],market=s['market']);errors={}
        if dividends_only:tasks=[('dividendContinuity',get_dividend_continuity)]
        elif history_only:tasks=[] if s['market'] in ['ETF','指数'] or s['code']=='VOO' else [('history',get_history)]
        elif s['market'] in ['ETF','指数'] or s['code']=='VOO':tasks=[('dps',get_dividends),('dividendContinuity',get_dividend_continuity)]
        else:tasks=[('fundamentals',get_fundamentals),('history',get_history),('dps',get_dividends),('dividendContinuity',get_dividend_continuity)]
        for key,fn in tasks:
            try:
                result=fn(s)
                if key=='fundamentals':record.update(result)
                else:record[key]=result
            except Exception as e:errors[key]=str(e)[:160]
            time.sleep(.12)
        if history_only or dividends_only:record.setdefault('errors',{}).pop('dividendContinuity' if dividends_only else 'history',None);record['errors'].update(errors)
        else:record['errors']=errors
        data['generatedAt']=dt.datetime.now(dt.timezone.utc).isoformat();data['asOf']=str(TODAY)
        tmp=OUT.with_suffix('.json.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8');tmp.replace(OUT)
        print(s['code'],'fields',','.join(k for k in record if k not in ['name','market','errors']),'missing',','.join(errors),flush=True)
if __name__=='__main__':main()
