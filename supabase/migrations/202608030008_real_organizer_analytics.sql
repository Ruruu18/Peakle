-- Feed the organizer web chart from venue bookings instead of UI sample values.
create or replace function public.get_venue_pickleball_analytics(p_venue_id text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.can_manage_venue(p_venue_id) then
    raise exception 'Venue management permission required';
  end if;

  select jsonb_build_object(
    'from',p_from,
    'to',p_to,
    'bookings',count(*) filter (where b.status <> 'cancelled'),
    'cancelledBookings',count(*) filter (where b.status = 'cancelled'),
    'grossRevenue',coalesce(sum(b.amount) filter (where b.status <> 'cancelled'),0),
    'bookedCourtHours',coalesce(round(sum(extract(epoch from (b.ends_at-b.starts_at)))/3600,1),0),
    'uniquePlayers',count(distinct b.user_id) filter (where b.status <> 'cancelled'),
    'cancellationRate',case when count(*)=0 then 0 else round((count(*) filter (where b.status='cancelled'))::numeric*100/count(*),1) end,
    'courtUtilization',coalesce(round(sum(extract(epoch from (b.ends_at-b.starts_at))) filter (where b.status<>'cancelled')/3600*100/nullif((select count(*) from public.courts c where c.venue_id=p_venue_id and c.active)*greatest(1,p_to-p_from+1)*14,0),1),0),
    'peakHour',coalesce((select to_char(date_trunc('hour',x.starts_at at time zone 'Asia/Manila'),'HH12 AM') from public.bookings x where x.venue_id=p_venue_id and x.status<>'cancelled' and x.starts_at::date between p_from and p_to group by 1 order by count(*) desc limit 1),'—'),
    'returningPlayers',(select count(*) from (select x.user_id from public.bookings x where x.venue_id=p_venue_id and x.status<>'cancelled' and x.starts_at::date between p_from and p_to group by x.user_id having count(*)>1) repeat_players)
  ) into result
  from public.bookings b
  where b.venue_id=p_venue_id and b.starts_at::date between p_from and p_to;

  return result || jsonb_build_object(
    'openPlaySessions',(select count(*) from public.open_play_sessions s where s.venue_id=p_venue_id and s.started_at::date between p_from and p_to),
    'openPlayAttendance',(select count(*) from public.open_play_players p join public.open_play_sessions s on s.id=p.session_id where s.venue_id=p_venue_id and s.started_at::date between p_from and p_to and p.checked_in_at is not null),
    'programRegistrations',(select count(*) from public.program_registrations r join public.venue_programs v on v.id=r.program_id where v.venue_id=p_venue_id and v.starts_at::date between p_from and p_to and r.status in ('registered','attended')),
    'dailyUtilization',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'date',to_char(series.day,'YYYY-MM-DD'),
        'utilization',coalesce(round(
          (select sum(extract(epoch from (booking.ends_at-booking.starts_at))) / 3600
           from public.bookings booking
           where booking.venue_id=p_venue_id
             and booking.status<>'cancelled'
             and (booking.starts_at at time zone 'Asia/Manila')::date=series.day::date)
          * 100 / nullif((select count(*) from public.courts court where court.venue_id=p_venue_id and court.active)*14,0),
          1
        ),0)
      ) order by series.day),'[]'::jsonb)
      from generate_series(greatest(p_from,p_to-6),p_to,'1 day'::interval) as series(day)
    )
  );
end $$;

