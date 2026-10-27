-- SOLO DB LOCAL VACÍA llamada kanban_test_*. psql -v ON_ERROR_STOP=1 -f este_archivo
\ir fixtures/kanban-schema.sql
\ir ../supabase/kanban_7_etapas_2026_10_27.sql
BEGIN;
DO $$ BEGIN
 IF (SELECT stage FROM leads WHERE nombre='Ficticio 1')<>'segundo_contacto' THEN RAISE EXCEPTION 'Fase informada no migrada'; END IF;
 IF (SELECT stage FROM leads WHERE nombre='Ficticio 2')<>'inscripcion_pendiente' THEN RAISE EXCEPTION 'Retroceso al migrar inscripción'; END IF;
 IF (SELECT stage FROM leads WHERE nombre='Ficticio 3')<>'inscrito' THEN RAISE EXCEPTION 'Inscrito no preservado'; END IF;
 IF (SELECT cerrado_por FROM leads WHERE nombre='Ficticio 3') IS NOT NULL THEN RAISE EXCEPTION 'No inventar cierre histórico'; END IF;
 IF (SELECT stage FROM leads WHERE nombre='Ficticio 4')<>'archivado' THEN RAISE EXCEPTION 'Cerrado no es Inscrito'; END IF;
 IF (SELECT stage FROM leads WHERE nombre='Ficticio 5')<>'segundo_contacto' THEN RAISE EXCEPTION 'Agendado no idiomas'; END IF;
 IF (SELECT stage FROM leads WHERE nombre='Ficticio 8')<>'examen_ubicacion' THEN RAISE EXCEPTION 'Agendado idiomas'; END IF;
 IF kanban_tras_bot('archivado','inscripcion_pendiente','Inglés para niños')<>'inscripcion_pendiente' THEN RAISE EXCEPTION 'Archivado no reabre inscripción'; END IF;
 IF kanban_tras_bot('archivado','segundo_contacto','Diplomado en Epidemiología')<>'segundo_contacto' THEN RAISE EXCEPTION 'Archivado no reabre Informado'; END IF;
 IF kanban_tras_bot('archivado','examen_ubicacion','Francés')<>'examen_ubicacion' THEN RAISE EXCEPTION 'Archivado no reabre Agendado'; END IF;
 IF kanban_tras_bot('archivado','examen_ubicacion','Psicología')<>'archivado' THEN RAISE EXCEPTION 'Agendado no debe abrirse para no idiomas'; END IF;
 IF kanban_etapa_migrada('archivado','inscribiendo','Inglés para niños')<>'inscripcion_pendiente' THEN RAISE EXCEPTION 'Backfill no reactiva etapa activa'; END IF;
END $$;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.sub','',false);
SELECT avanzar_etapa_bot('00000000-0000-4000-a000-000000000002','segundo_contacto');
SELECT avanzar_etapa_bot('00000000-0000-4000-a000-000000000004','inscripcion_pendiente');
DO $$ BEGIN IF (SELECT stage FROM leads WHERE nombre='Ficticio 4')<>'inscripcion_pendiente' THEN RAISE EXCEPTION 'RPC no reabre Archivado'; END IF; END $$;
UPDATE leads SET stage='inscrito',cerrado_por='22222222-2222-4222-a222-222222222222' WHERE nombre='Ficticio 2';
UPDATE leads SET stage='perdido' WHERE nombre='Ficticio 2';
DO $$ BEGIN IF (SELECT stage FROM leads WHERE nombre='Ficticio 2')<>'inscripcion_pendiente' THEN RAISE EXCEPTION 'Bot retrocedió/cerró inscripción'; END IF; END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-a111-111111111111',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM leads)<>9 THEN RAISE EXCEPTION 'Equipo no ve todas las tarjetas'; END IF;
 IF (SELECT count(*) FROM profiles)<>3 THEN RAISE EXCEPTION 'Faltan asesores en filtro'; END IF;
 IF (SELECT count(*) FROM whatsapp_mensajes)<>1 THEN RAISE EXCEPTION 'No puede leer historial ajeno'; END IF;
 UPDATE leads SET nombre='No permitido' WHERE nombre='Ficticio 6';
 IF FOUND THEN RAISE EXCEPTION 'La ampliación de lectura abrió escritura ajena'; END IF;
END $$;
UPDATE leads SET stage='inscrito' WHERE nombre='Ficticio 2';
DO $$ BEGIN
 IF (SELECT cerrado_por FROM leads WHERE nombre='Ficticio 2')<>'11111111-1111-4111-a111-111111111111'::uuid THEN RAISE EXCEPTION 'Cierre sin autor real'; END IF;
 IF NOT EXISTS(SELECT 1 FROM lead_activities WHERE event_type='inscrito_confirmado' AND detail='Cerró: Ana Demo') THEN RAISE EXCEPTION 'Sin actividad de comisión'; END IF;
END $$;
UPDATE leads SET cerrado_por='22222222-2222-4222-a222-222222222222',cerrado_por_nombre='Bruno inventado' WHERE nombre='Ficticio 2';
UPDATE leads SET stage='inscrito' WHERE nombre='Ficticio 2';
DO $$ DECLARE bloqueado boolean:=false; BEGIN
 IF (SELECT cerrado_por_nombre FROM leads WHERE nombre='Ficticio 2')<>'Ana Demo' THEN RAISE EXCEPTION 'Cierre falsificable'; END IF;
 IF (SELECT count(*) FROM lead_activities WHERE event_type='inscrito_confirmado')<>1 THEN RAISE EXCEPTION 'Comisión duplicada'; END IF;
 BEGIN INSERT INTO lead_activities(lead_id,actor_id,event_type,title,detail,meta) VALUES('00000000-0000-4000-a000-000000000002',auth.uid(),'inscrito_confirmado','Falso','Falso','{}');
 EXCEPTION WHEN raise_exception THEN bloqueado:=true; END;
 IF NOT bloqueado THEN RAISE EXCEPTION 'Actividad de cierre falsificable'; END IF;
END $$;
INSERT INTO whatsapp_mensajes(conversacion_id,rol,contenido,enviado_por,enviado_por_nombre) VALUES('00000000-0000-4000-a000-000000000002','agente','Nuevo ficticio','22222222-2222-4222-a222-222222222222','Bruno inventado');
UPDATE whatsapp_mensajes SET enviado_por='22222222-2222-4222-a222-222222222222',enviado_por_nombre='Otro' WHERE contenido='Nuevo ficticio';
DO $$ BEGIN IF (SELECT enviado_por_nombre FROM whatsapp_mensajes WHERE contenido='Nuevo ficticio')<>'Ana Demo' THEN RAISE EXCEPTION 'Autor del mensaje falsificado'; END IF; END $$;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.sub','',false);
SELECT avanzar_etapa_bot('00000000-0000-4000-a000-000000000002','primer_contacto');
DO $$ BEGIN IF (SELECT stage FROM leads WHERE nombre='Ficticio 2')<>'inscrito' THEN RAISE EXCEPTION 'Bot deshizo cierre humano'; END IF; END $$;
UPDATE profiles SET nombre='Ana Renombrada' WHERE id='11111111-1111-4111-a111-111111111111';
DO $$ BEGIN
 IF (SELECT enviado_por_nombre FROM whatsapp_mensajes WHERE contenido='Nuevo ficticio')<>'Ana Demo' THEN RAISE EXCEPTION 'Se perdió snapshot de autor'; END IF;
 IF (SELECT cerrado_por_nombre FROM leads WHERE nombre='Ficticio 2')<>'Ana Demo' THEN RAISE EXCEPTION 'Se perdió snapshot de cierre'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-a333-333333333333',false);
UPDATE leads SET stage='inscrito' WHERE nombre='Ficticio 6';
DO $$ BEGIN IF (SELECT cerrado_por_nombre FROM leads WHERE nombre='Ficticio 6')<>'Admin Demo' THEN RAISE EXCEPTION 'Cerró debe ser autor real, no asignado'; END IF; END $$;
RESET ROLE;
ROLLBACK; -- Retirar datos de prueba antes de ensayar reversa sobre el snapshot inicial.
\ir ../supabase/kanban_7_etapas_2026_10_27_reversa.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM leads l JOIN kanban_20261027_respaldo b ON b.id=l.id WHERE l.stage IS DISTINCT FROM b.stage_anterior) THEN RAISE EXCEPTION 'Reversa no exacta'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='old_stage_check') THEN RAISE EXCEPTION 'Constraint anterior no restaurado'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-a111-111111111111',false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM leads WHERE nombre='Ficticio 6') THEN RAISE EXCEPTION 'RLS original no restaurado'; END IF; END $$;
RESET ROLE;
