// ============================================================
//  Cloudflare Worker · Supabase 反向代理
//  用途：把被墙的 Supabase 域名，通过 workers.dev 中转给国内访客
//  部署：Cloudflare 控制台 → Workers → 新建 → 粘贴本文件 → 部署
// ============================================================

// 👇 你的 Supabase 项目地址（从 Supabase 后台 Project Settings → API 复制）
const SUPABASE_URL = 'https://ewxviturcvymewykqlau.supabase.co';

// 👇 你的 anon/public key（同路径下 "Project API keys" 里的 anon key）
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eHZpdHVyY3Z5bWV3eWtxbGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MDEwNjMsImV4cCI6MjEwMTQ3NzA2M30.rMwlPkf772tj1w9no2p9ZP20j2HJPcq49GMMF8J570w';

export default {
  async fetch(request, env, ctx) {
    // —— 1. 处理浏览器 CORS 预检（Supabase 客户端会发 OPTIONS）——
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);

    // —— 2. 重构目标地址：worker 域名 → Supabase 域名，路径/参数原样保留 ——
    // 覆盖的范围：/rest/v1/（数据表）、/auth/v1/（登录注册）、/storage/v1/（文件）等全部转发
    const target = SUPABASE_URL + url.pathname + url.search;

    // —— 3. 复制并修正请求头 ——
    const headers = new Headers(request.headers);
    headers.set('host', new URL(SUPABASE_URL).host);
    headers.set('origin', SUPABASE_URL);
    // 兜底：客户端若漏带 apikey，这里补上（anon key 本就是公开的，无泄露风险）
    if (!headers.has('apikey')) headers.set('apikey', SUPABASE_ANON_KEY);

    // —— 4. 转发请求（保留 method 与 body）——
    const init = { method: request.method, headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half'; // 必须：流式转发请求体
    }

    try {
      const resp = await fetch(target, init);

      // —— 5. 回传响应，并补 CORS 头（让浏览器放行）——
      const out = new Headers(resp.headers);
      out.set('Access-Control-Allow-Origin', '*');
      out.set('Access-Control-Allow-Headers', '*');
      out.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: out,
      });
    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 502 });
    }
  },
};
