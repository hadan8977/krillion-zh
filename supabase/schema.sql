-- Run once in this game's Supabase project. All application data is private.
begin;
create table if not exists public.kr_banks (
  version text primary key,
  base_version text not null,
  body jsonb not null,
  changes jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists public.kr_channels (
  base_version text primary key,
  current_version text not null references public.kr_banks(version),
  refreshed_on date,
  updated_at timestamptz not null default now()
);
create table if not exists public.kr_sessions (
  id uuid primary key,
  visitor_id uuid not null,
  base_version text not null,
  bank_version text not null references public.kr_banks(version),
  created_at timestamptz not null default now()
);
create table if not exists public.kr_attempts (
  session_id uuid not null references public.kr_sessions(id),
  round_index smallint not null check (round_index between 0 and 6),
  attempt_index smallint not null check (attempt_index between 0 and 30),
  visitor_id uuid not null,
  network_key text not null,
  base_version text not null,
  bank_version text not null,
  question_id text not null,
  raw text not null check (length(raw) <= 80),
  normalized text not null check (length(normalized) <= 80),
  outcome text not null check (outcome in ('matched','unknown','timeout')),
  elapsed_ms integer not null check (elapsed_ms between 0 and 25000),
  spoiled boolean not null,
  created_at timestamptz not null default now(),
  primary key (session_id, round_index, attempt_index)
);
create index if not exists kr_attempts_samples on public.kr_attempts (base_version, created_at, question_id, visitor_id);
create index if not exists kr_attempts_candidates on public.kr_attempts (base_version, question_id, normalized, visitor_id);
create table if not exists public.kr_candidates (
  base_version text not null,
  question_id text not null,
  normalized text not null,
  label text not null,
  created_at timestamptz not null default now(),
  primary key (base_version, question_id, normalized)
);
create table if not exists public.kr_votes (
  base_version text not null,
  question_id text not null,
  normalized text not null,
  visitor_id uuid not null,
  network_key text not null,
  agrees boolean not null,
  created_at timestamptz not null default now(),
  primary key (base_version, question_id, normalized, visitor_id),
  unique (base_version, question_id, normalized, network_key)
);
create table if not exists public.kr_review_tickets (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  base_version text not null,
  question_id text not null,
  normalized text not null,
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz
);
create table if not exists public.kr_feedback (
  id uuid primary key,
  visitor_id uuid not null,
  network_key text not null,
  base_version text not null,
  bank_version text not null,
  question_id text,
  kind text not null check (kind in ('missing','incorrect','score','general')),
  answer text not null default '' check (length(answer) <= 80),
  normalized text not null default '',
  note text not null check (length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.kr_limits (
  key text not null,
  bucket bigint not null,
  count integer not null,
  primary key (key, bucket)
);

create or replace function public.kr_seed(p_bank jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.kr_banks(version, base_version, body)
    values(p_bank->>'version',p_bank->>'baseVersion',p_bank) on conflict do nothing;
  insert into public.kr_channels(base_version,current_version)
    values(p_bank->>'baseVersion',p_bank->>'version') on conflict do nothing;
  return (select b.body from public.kr_banks b join public.kr_channels c on c.current_version=b.version
    where c.base_version=p_bank->>'baseVersion');
end $$;

create or replace function public.kr_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; slot bigint := floor(extract(epoch from now()) / p_seconds) * p_seconds;
begin
  insert into public.kr_limits(key,bucket,count) values(p_key,slot,1)
    on conflict (key,bucket) do update set count=public.kr_limits.count+1 returning count into n;
  delete from public.kr_limits where bucket < extract(epoch from now())-172800;
  return n <= p_limit;
end $$;

create or replace function public.kr_ingest(p_session uuid, p_visitor uuid, p_network text, p_events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare s public.kr_sessions; item jsonb; inserted integer; total integer := 0;
begin
  select * into s from public.kr_sessions where id=p_session and visitor_id=p_visitor
    and created_at>now()-interval '2 days';
  if not found then raise exception 'invalid_session'; end if;
  if jsonb_array_length(p_events)>20 then raise exception 'too_many_events'; end if;
  for item in select value from jsonb_array_elements(p_events) loop
    insert into public.kr_attempts(session_id,round_index,attempt_index,visitor_id,network_key,base_version,
      bank_version,question_id,raw,normalized,outcome,elapsed_ms,spoiled)
      values(s.id,(item->>'round')::smallint,(item->>'attempt')::smallint,p_visitor,p_network,s.base_version,
      s.bank_version,item->>'questionId',item->>'raw',item->>'normalized',item->>'outcome',
      (item->>'elapsedMs')::integer,(item->>'spoiled')::boolean) on conflict do nothing;
    get diagnostics inserted = row_count;
    total := total + inserted;
    if inserted=1 and item->>'candidate' is not null then
      insert into public.kr_candidates(base_version,question_id,normalized,label)
        values(s.base_version,item->>'questionId',item->>'normalized',item->>'candidate') on conflict do nothing;
    end if;
  end loop;
  return total;
end $$;

create or replace function public.kr_automation_data(p_base text) returns jsonb
language sql security definer set search_path = '' as $$
  with first_answers as (
    select distinct on (question_id,visitor_id) question_id,visitor_id,normalized
    from public.kr_attempts
    where base_version=p_base and created_at>now()-interval '30 days'
      and attempt_index=0 and not spoiled and outcome<>'timeout' and normalized<>''
    order by question_id,visitor_id,created_at,session_id
  ), samples as (
    select question_id,normalized,count(*)::integer as n from first_answers group by question_id,normalized
  ), submitted as (
    select question_id,normalized,visitor_id,created_at from public.kr_attempts
      where base_version=p_base and outcome='unknown' and not spoiled
    union all
    select question_id,normalized,visitor_id,created_at from public.kr_feedback
      where base_version=p_base and kind='missing' and normalized<>''
  ), submissions as (
    select question_id,normalized,count(distinct visitor_id)::integer as visitors,
      count(distinct (created_at at time zone 'Asia/Shanghai')::date)::integer as days
    from submitted where created_at>now()-interval '30 days'
    group by question_id,normalized
  ), reviews as (
    select question_id,normalized,count(*) filter(where agrees)::integer as yes,
      count(*) filter(where not agrees)::integer as no
    from public.kr_votes where base_version=p_base group by question_id,normalized
  )
  select jsonb_build_object(
    'observations',coalesce((select jsonb_agg(jsonb_build_object('questionId',question_id,'normalized',normalized,'count',n)) from samples),'[]'),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('questionId',c.question_id,'normalized',c.normalized,
      'label',c.label,'submitters',s.visitors,'days',s.days,'yes',coalesce(r.yes,0),'no',coalesce(r.no,0)))
      from public.kr_candidates c join submissions s using(question_id,normalized)
      left join reviews r using(question_id,normalized) where c.base_version=p_base),'[]')
  );
$$;

create or replace function public.kr_issue_review(p_base text, p_visitor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare candidate public.kr_candidates; ticket uuid;
begin
  if (select count(distinct question_id) from public.kr_attempts
      where visitor_id=p_visitor and base_version=p_base and outcome='matched' and not spoiled)<3 then return null; end if;
  select c.* into candidate from public.kr_candidates c
    where c.base_version=p_base
    and (select count(distinct submitted.visitor_id) from (
      select a.visitor_id from public.kr_attempts a where a.base_version=p_base
        and a.question_id=c.question_id and a.normalized=c.normalized and a.outcome='unknown'
        and not a.spoiled and a.created_at>now()-interval '30 days'
      union all select f.visitor_id from public.kr_feedback f where f.base_version=p_base
        and f.question_id=c.question_id and f.normalized=c.normalized and f.kind='missing'
        and f.created_at>now()-interval '30 days') submitted)>=3
    and not exists(select 1 from public.kr_attempts a where a.base_version=p_base
      and a.question_id=c.question_id and a.normalized=c.normalized and a.visitor_id=p_visitor)
    and not exists(select 1 from public.kr_votes v where v.base_version=p_base
      and v.question_id=c.question_id and v.normalized=c.normalized and v.visitor_id=p_visitor)
    and not exists(select 1 from public.kr_feedback f where f.base_version=p_base
      and f.question_id=c.question_id and f.normalized=c.normalized and f.visitor_id=p_visitor)
    and not exists(select 1 from public.kr_channels ch join public.kr_banks b on b.version=ch.current_version,
      jsonb_array_elements(b.body->'questions') q,jsonb_array_elements(q->'answers') a
      where ch.base_version=p_base and q->>'id'=c.question_id and (a->>'label'=c.label or (a->'aliases') ? c.label))
    order by random() limit 1;
  if not found then return null; end if;
  delete from public.kr_review_tickets where expires_at < now()-interval '1 day';
  insert into public.kr_review_tickets(visitor_id,base_version,question_id,normalized)
    values(p_visitor,p_base,candidate.question_id,candidate.normalized) returning id into ticket;
  return jsonb_build_object('ticket',ticket,'questionId',candidate.question_id,'label',candidate.label);
end $$;

create or replace function public.kr_cast_review(p_ticket uuid, p_visitor uuid, p_network text, p_agrees boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare t public.kr_review_tickets;
begin
  select * into t from public.kr_review_tickets where id=p_ticket and visitor_id=p_visitor for update;
  if not found or t.expires_at<now() then return false; end if;
  if t.used_at is not null then return true; end if;
  if exists(select 1 from public.kr_attempts where base_version=t.base_version and question_id=t.question_id
    and normalized=t.normalized and visitor_id=p_visitor) then return false; end if;
  if exists(select 1 from public.kr_feedback where base_version=t.base_version and question_id=t.question_id
    and normalized=t.normalized and visitor_id=p_visitor) then return false; end if;
  insert into public.kr_votes(base_version,question_id,normalized,visitor_id,network_key,agrees)
    values(t.base_version,t.question_id,t.normalized,p_visitor,p_network,p_agrees) on conflict do nothing;
  update public.kr_review_tickets set used_at=now() where id=t.id;
  return true;
end $$;

create or replace function public.kr_record_feedback(p_feedback jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.kr_feedback(id,visitor_id,network_key,base_version,bank_version,question_id,kind,answer,normalized,note)
    values((p_feedback->>'id')::uuid,(p_feedback->>'visitor_id')::uuid,p_feedback->>'network_key',
      p_feedback->>'base_version',p_feedback->>'bank_version',p_feedback->>'question_id',
      p_feedback->>'kind',p_feedback->>'answer',p_feedback->>'normalized',p_feedback->>'note') on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted=1 and p_feedback->>'candidate' is not null then
    insert into public.kr_candidates(base_version,question_id,normalized,label)
      values(p_feedback->>'base_version',p_feedback->>'question_id',p_feedback->>'normalized',p_feedback->>'candidate') on conflict do nothing;
  end if;
  return true;
end $$;

create or replace function public.kr_publish(p_expected text, p_bank jsonb, p_changes jsonb, p_day date)
returns boolean language plpgsql security definer set search_path = '' as $$
declare channel public.kr_channels;
begin
  select * into channel from public.kr_channels where base_version=p_bank->>'baseVersion' for update;
  if not found or channel.current_version<>p_expected or channel.refreshed_on>=p_day then return false; end if;
  if p_bank->>'version'<>p_expected then
    insert into public.kr_banks(version,base_version,body,changes)
      values(p_bank->>'version',p_bank->>'baseVersion',p_bank,p_changes);
  end if;
  update public.kr_channels set current_version=p_bank->>'version',refreshed_on=p_day,updated_at=now()
    where base_version=p_bank->>'baseVersion';
  return true;
end $$;

-- RLS and grants deliberately expose no raw submissions, visitors, or feedback
-- to browsers. Only the Vercel server's Supabase secret key may invoke these RPCs.
do $$
declare object record;
begin
  for object in select unnest(array['kr_banks','kr_channels','kr_sessions','kr_attempts','kr_candidates',
    'kr_votes','kr_review_tickets','kr_feedback','kr_limits']) as tablename loop
    execute format('alter table public.%I enable row level security',object.tablename);
    execute format('revoke all on public.%I from public, anon, authenticated',object.tablename);
    execute format('grant all on public.%I to service_role',object.tablename);
  end loop;
  for object in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('kr_seed','kr_rate_limit','kr_ingest','kr_automation_data',
      'kr_issue_review','kr_cast_review','kr_record_feedback','kr_publish') loop
    execute format('revoke all on function %s from public, anon, authenticated',object.signature);
    execute format('grant execute on function %s to service_role',object.signature);
  end loop;
end $$;

commit;
