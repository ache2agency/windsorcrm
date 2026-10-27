-- SOLO BASE LOCAL FICTICIA. Nunca ejecutar contra un proyecto Supabase real.
DO $$ BEGIN IF current_database() NOT LIKE 'kanban_test_%' THEN RAISE EXCEPTION 'Solo DB kanban_test_*'; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE profiles(id uuid PRIMARY KEY,nombre text,email text,rol text);
CREATE TABLE leads(id uuid PRIMARY KEY,nombre text,curso text,stage text DEFAULT 'contactado',asignado_a uuid REFERENCES profiles(id),tipo_contacto text DEFAULT 'prospecto',created_at timestamptz DEFAULT now(),CONSTRAINT old_stage_check CHECK(stage IN ('contactado','interesado','promocion_enviada','clase_muestra','examen_ubicacion','inscripcion_pendiente','inscrito','cerrado','perdido','archivado','primer_contacto','segundo_contacto','tercer_contacto')));
CREATE TABLE whatsapp_conversaciones(id uuid PRIMARY KEY,lead_id uuid REFERENCES leads(id),fase text,ultimo_mensaje_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
CREATE TABLE whatsapp_mensajes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversacion_id uuid REFERENCES whatsapp_conversaciones(id),rol text,contenido text,created_at timestamptz DEFAULT now());
CREATE TABLE lead_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads(id),actor_id uuid REFERENCES profiles(id),event_type text,title text,detail text,meta jsonb,created_at timestamptz DEFAULT now());
INSERT INTO profiles VALUES('11111111-1111-4111-a111-111111111111','Ana Demo','ana@example.test','vendedor'),('22222222-2222-4222-a222-222222222222','Bruno Demo','bruno@example.test','vendedor'),('33333333-3333-4333-a333-333333333333','Admin Demo','admin@example.test','admin');
CREATE FUNCTION es_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND rol='admin')$$;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON profiles FOR SELECT TO authenticated USING(id=auth.uid() OR es_admin());
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_leads ON leads FOR ALL TO authenticated USING(asignado_a=auth.uid() OR es_admin()) WITH CHECK(asignado_a=auth.uid() OR es_admin());
ALTER TABLE whatsapp_conversaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_convs ON whatsapp_conversaciones FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM leads WHERE id=lead_id AND (asignado_a=auth.uid() OR es_admin())));
ALTER TABLE whatsapp_mensajes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_msgs ON whatsapp_mensajes FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM whatsapp_conversaciones c JOIN leads l ON l.id=c.lead_id WHERE c.id=conversacion_id AND (l.asignado_a=auth.uid() OR es_admin())));
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_acts ON lead_activities FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM leads WHERE id=lead_id AND (asignado_a=auth.uid() OR es_admin())));
GRANT SELECT ON profiles TO authenticated; GRANT ALL ON leads,whatsapp_conversaciones,whatsapp_mensajes,lead_activities TO authenticated;
GRANT ALL ON profiles,leads,whatsapp_conversaciones,whatsapp_mensajes,lead_activities TO service_role;
INSERT INTO leads(id,nombre,curso,stage,asignado_a) SELECT ('00000000-0000-4000-a000-'||lpad(n::text,12,'0'))::uuid,'Ficticio '||n,
 CASE WHEN n=5 THEN 'Psicología' ELSE 'Inglés para niños' END,
 CASE n WHEN 1 THEN 'contactado' WHEN 2 THEN 'inscripcion_pendiente' WHEN 3 THEN 'inscrito' WHEN 4 THEN 'cerrado' WHEN 5 THEN 'clase_muestra' WHEN 6 THEN 'promocion_enviada' WHEN 7 THEN 'perdido' WHEN 8 THEN 'clase_muestra' ELSE NULL END,
 CASE WHEN n=6 THEN '22222222-2222-4222-a222-222222222222' ELSE '11111111-1111-4111-a111-111111111111' END::uuid FROM generate_series(1,9) n;
INSERT INTO whatsapp_conversaciones(id,lead_id,fase) SELECT id,id,CASE right(id::text,1) WHEN '1' THEN 'accion' WHEN '2' THEN 'dudas' WHEN '3' THEN 'perdido' WHEN '4' THEN 'cerrado' WHEN '5' THEN 'clase_prueba' WHEN '7' THEN 'accion' WHEN '8' THEN 'clase_prueba' ELSE 'correo' END FROM leads;
INSERT INTO whatsapp_mensajes(conversacion_id,rol,contenido) VALUES('00000000-0000-4000-a000-000000000006','agente','Histórico ficticio sin autor');
