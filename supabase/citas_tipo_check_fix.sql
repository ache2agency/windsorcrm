-- Amplía la restricción citas_tipo_check para incluir los tipos que la app
-- ya usa (inscripcion, asesoria, examen_ubicacion) pero la restricción rechazaba,
-- lo que impedía crear cualquier cita de esos 3 tipos (tabla citas quedaba en 0 filas).
-- Ejecutar en Supabase Dashboard → SQL Editor

alter table public.citas drop constraint if exists citas_tipo_check;

alter table public.citas add constraint citas_tipo_check
  check (tipo in ('clase_prueba', 'llamada', 'reunion', 'inscripcion', 'asesoria', 'examen_ubicacion'));
