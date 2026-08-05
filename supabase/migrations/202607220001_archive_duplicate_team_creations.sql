-- Recover from the former create-team double-submit bug without deleting data.
-- Only matching, forming, owner-only copies created within two minutes are archived.
with duplicate_team_creations as (
  select newer.id
  from public.teams newer
  where newer.status = 'forming'
    and newer.member_count <= 1
    and exists (
      select 1
      from public.teams older
      where older.creator_id = newer.creator_id
        and older.status <> 'archived'
        and older.member_count <= 1
        and lower(btrim(older.name)) = lower(btrim(newer.name))
        and older.tag is not distinct from newer.tag
        and older.motto is not distinct from newer.motto
        and older.about is not distinct from newer.about
        and lower(btrim(coalesce(older.location, ''))) = lower(btrim(coalesce(newer.location, '')))
        and older.skill_level is not distinct from newer.skill_level
        and older.capacity = newer.capacity
        and older.color is not distinct from newer.color
        and older.is_discoverable = newer.is_discoverable
        and (
          older.created_at < newer.created_at
          or (older.created_at = newer.created_at and older.id < newer.id)
        )
        and newer.created_at <= older.created_at + interval '2 minutes'
    )
)
update public.teams team
set status = 'archived'
from duplicate_team_creations duplicate
where team.id = duplicate.id;
