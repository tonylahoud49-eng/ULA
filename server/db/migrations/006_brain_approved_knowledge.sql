begin;

-- Existing prototypes remain unverified and cannot become knowledge implicitly.
alter table ula.brain_reports add column if not exists owner_id text;
update ula.brain_reports set owner_id = coalesce(data->>'uploaded_by', 'legacy-unassigned') where owner_id is null;
alter table ula.brain_reports alter column owner_id set not null;
create index if not exists brain_reports_owner_idx on ula.brain_reports(owner_id);

drop policy if exists brain_admin on ula.brain_reports;
create policy brain_read on ula.brain_reports for select using (
  ula.current_actor_is_admin() or owner_id = ula.current_actor_id()
);
create policy brain_submit on ula.brain_reports for insert with check (
  owner_id = ula.current_actor_id() and data->>'uploaded_by' = ula.current_actor_id()
  and data->>'approval_status' = 'submitted' and data->>'report_status' = 'final'
  and not (data ? 'knowledge_manifest')
);
create policy brain_review on ula.brain_reports for update using (ula.current_actor_is_admin()) with check (ula.current_actor_is_admin());
-- Intentionally no DELETE policy: removing knowledge must preserve the original.

create or replace function ula.protect_brain_original() returns trigger language plpgsql as $$
begin
  if new.original is distinct from old.original or new.owner_id is distinct from old.owner_id
     or new.id is distinct from old.id or new.created_at is distinct from old.created_at
     or (new.data - array['status','approval_status','revision','updated_at','verified_by','verified_at','verification_note','rejected_by','rejected_at','rejection_reason','style_notes','learned_at','model','usage','extracted_text','error','learning_started_at','learning_attempt','knowledge_manifest','activated_by','activated_at','removed_by','removed_at'])
        is distinct from
        (old.data - array['status','approval_status','revision','updated_at','verified_by','verified_at','verification_note','rejected_by','rejected_at','rejection_reason','style_notes','learned_at','model','usage','extracted_text','error','learning_started_at','learning_attempt','knowledge_manifest','activated_by','activated_at','removed_by','removed_at']) then
    raise exception 'Approved report originals and source metadata are immutable';
  end if;
  return new;
end $$;
create trigger brain_original_immutable before update on ula.brain_reports for each row execute function ula.protect_brain_original();

-- Staff retrieve only the explicitly approved, de-identified projection.
create table if not exists ula.brain_knowledge (
  report_id text primary key references ula.brain_reports(id),
  manifest jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists brain_knowledge_line_idx on ula.brain_knowledge ((lower(manifest #>> '{applies_to,business_lines,0}')));
alter table ula.brain_knowledge enable row level security;
alter table ula.brain_knowledge force row level security;
create policy brain_knowledge_read on ula.brain_knowledge for select using (ula.current_actor_id() is not null);
create policy brain_knowledge_admin on ula.brain_knowledge for all using (ula.current_actor_is_admin()) with check (ula.current_actor_is_admin());

commit;
