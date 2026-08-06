-- 巴芒投资指引 · Supabase 数据表 + 行级安全(RLS)
-- 用法：在 Supabase 后台 → SQL Editor 粘贴全部内容执行即可。
--
-- 表设计：单表 user_data 以 (user_id, data_key) 为主键，1:1 映射前端 userData(key)。
-- 前端五个数据桶：logs / holds / moods / mists / ops（外加 holdPnl 开关），均以 jsonb 存入 value。

create table if not exists public.user_data (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  data_key   text        not null,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);

-- 建索引，按用户查数据更快
create index if not exists idx_user_data_uid on public.user_data(user_id);

-- 开启行级安全：默认拒绝一切，下面逐条放行「仅本人」
alter table public.user_data enable row level security;

drop policy if exists "own_select" on public.user_data;
drop policy if exists "own_insert" on public.user_data;
drop policy if exists "own_update" on public.user_data;
drop policy if exists "own_delete" on public.user_data;

create policy "own_select" on public.user_data
  for select using (auth.uid() = user_id);

create policy "own_insert" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "own_update" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_delete" on public.user_data
  for delete using (auth.uid() = user_id);

-- 授予 anon / authenticated 角色对 user_data 的读写权限（Supabase REST API 以 anon 身份调用）
grant all on public.user_data to anon, authenticated;

-- ============================================================
-- 建议反馈表（站点级，不跟账户）：访客提交、站长在「小后台」查看
-- 前端小后台用 ADMIN_CODE 访问码保护入口；下表 RLS 设为宽松（匿名可读写），
-- 如要更严格，把 fb_select / fb_delete 的 using(true) 改为 using(auth.uid() = '<站长UUID>')。
-- ============================================================
create table if not exists public.feedback (
  id          text        primary key,
  type        text        not null default '其他',
  content     text        not null,
  contact     text,
  created_at  timestamptz not null default now(),
  done        boolean     not null default false
);

create index if not exists idx_feedback_created on public.feedback(created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "fb_insert" on public.feedback;
create policy "fb_insert" on public.feedback
  for insert with check (true);

drop policy if exists "fb_select" on public.feedback;
create policy "fb_select" on public.feedback
  for select using (true);

drop policy if exists "fb_delete" on public.feedback;
create policy "fb_delete" on public.feedback
  for delete using (true);

-- 授予 anon / authenticated 角色对 feedback 的读写权限（访客匿名提交反馈、站长查看）
grant all on public.feedback to anon, authenticated;
