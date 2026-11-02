-- Reversa MANUAL después de retirar el código nuevo. Conserva columnas, eventos y leads nuevos.
-- No revierte identidad ni documentos ni inscripciones realizadas después del despliegue.
begin;
drop trigger if exists ruta17_conversacion on public.whatsapp_conversaciones;
drop trigger if exists ruta17_citas on public.citas;
drop trigger if exists ruta17_formularios on public.inscripciones;
drop trigger if exists ruta17_control on public.leads;
drop trigger if exists ruta17_auditoria on public.leads;
drop policy if exists ruta17_equipo_lee on public.leads;
drop policy if exists ruta17_equipo_eventos on public.lead_ruta_eventos;
drop policy if exists ruta17_equipo_convs on public.whatsapp_conversaciones;
drop policy if exists ruta17_equipo_mensajes on public.whatsapp_mensajes;
update public.leads l set stage=b.stage from public.ruta17_respaldo_leads b
 where l.id=b.id and l.ruta_version=0;
update public.whatsapp_conversaciones c set fase=b.fase,estado=b.estado from public.ruta17_respaldo_convs b
 where c.id=b.id and b.fase='cerrado' and c.fase='accion'
 and c.ultimo_mensaje_at is not distinct from b.ultimo_mensaje_at;
revoke execute on function public.guardar_ruta_lead(uuid,integer,jsonb,jsonb,text,integer,text) from service_role;
commit;
