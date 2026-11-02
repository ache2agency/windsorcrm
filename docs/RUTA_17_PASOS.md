# Ruta del lead y conversión

Implementación de la tarea 11; sustituye el Kanban de PR #51. Código preparado para revisión, no desplegado. La tarea 10 queda pendiente y deberá usar la marca `persona`, sin crear otro paso.

## Fuente de verdad

`leads.ruta.pasos` guarda cumplido / saltado con motivo y fecha. La ausencia significa pendiente. `paso` y `bloque` son proyecciones validadas por PostgreSQL; `ruta_version` evita pisar cambios concurrentes. `lead_ruta_eventos` conserva cada versión y autor. El catálogo `lib/whatsapp/ruta.ts` alimenta bot, motor, tarjetas y embudo. El siguiente pendiente dirige las preguntas; la fase antigua se mantiene como compatibilidad de integraciones, no decide avances.

Los cinco bloques son Contacto, Información, Agenda, Inscripción e Inscrito. El prototipo tiene cuatro columnas porque junta Inscrito dentro de Inscripción; se separó el cierre como quinto bloque para mantener visibles los 17 pasos y distinguir el resultado humano de Canalizado. Los inscritos tienen su pestaña y salen del pipeline activo.

Se guarda información proporcionada anticipadamente, pero solo se acreditan los requisitos de contacto en orden. “Quiero inscribirme” conserva intención hasta tener los datos y entregar información. Las dudas se responden con los textos aprobados/RAG existentes, sin delegar decisiones de ruta a la IA. No se acredita info ni link antes de aceptar el envío. Las revisiones por incertidumbre conservan código y plazos 4/20 h existentes.

Una pregunta posterior a la info acredita 7; los temas se guardan también cuando pregunta antes de recibirla. 8 registra una respuesta de convenio, sin inventar descuentos. “No tengo dudas / no tengo convenio / lo voy a pensar” resuelve explícitamente los opcionales y llega a Decidiendo. Inscripción directa registra por qué no hubo interacción de dudas, convenio o agenda. Edad solo para cursos de inglés: 4–12 corresponde al curso infantil, desde 13 al de adultos, según el catálogo actual. No se pregunta en licenciaturas, maestrías ni diplomados.

Archivado conserva progreso y se reactiva al responder o recibir formulario. Perdido se confirma por una persona; un rechazo del prospecto detiene la venta como Archivado + marca para revisión. Vacantes salen de ventas. Despedirse no cierra la ruta. Tomar control guarda fecha de la marca; Volver a BOT la retira. Fechas concretas de canalización siguen en tarea 10.

## Inscripción y Google Forms

La migración añade un trigger a `inscripciones`: solicitud, paso 14 y trabajo de revisión se confirman juntos. Vinculación por teléfono normalizado (+52/+521). El folio del CRM se conserva; las filas antiguas tienen UUID determinista por pestaña/fila. No ordenar, borrar ni insertar filas históricas: el identificador de origen depende de esa fila.

`crmAlRecibirGoogleForm` reemplaza el trigger directo de `onFormSubmit`, conserva su procesamiento y notifica `/api/inscripcion/google-form`. Un fallo de Drive no borra la solicitud: permanece en 14. Las notificaciones fallidas quedan en propiedades del script y se reintentan con `crmReintentarEventos`. Cada respuesta del callback usa secreto compartido. No se conecta nada automáticamente desde este PR.

El cron de seguimiento existente procesa hasta 25 trabajos por corrida, sin cambiar frecuencia. Revisa IDs de archivos de la fila y comprueba que existan en la carpeta del alumno; no cuenta la ficha PDF ni confía en uploads declarados por el cliente. Acta + comprobante; licenciaturas también certificado. El faltante conserva 14; Drive completo acredita 15. El mensaje al alumno usa el texto de Harold dentro de ventana; fuera de ventana espera nueva interacción. El motor recuerda faltantes, no promociones. Confirmaciones respetan modo humano.

La UTILITY solo va a `ADMIN_WA_ALERTA` (Harold); jamás a coordinación ni grupos automáticamente. 16 requiere respuesta aceptada con ID. `aviso_estado=enviando` tras fallo ambiguo requiere comprobar entrega antes de reabrirlo, para no duplicar mensajes. Si Meta ya entregó y falló el registro de 16, el worker puede completarlo sin reenviar. La recepción del comprobante no valida el pago. Únicamente una persona confirma 17 o Perdido; queda actor en auditoría.

## Migración, conteo y reversa

1. Revisar y ejecutar **manualmente**, antes de desplegar código, `supabase/windsor_ruta_17_pasos.sql`. Una transacción; respaldo de primera ejecución de leads y conversaciones; backfill conserva cierres humanos, solicitudes y citas verificables. No infiere citas desde fases. Huecos históricos quedan saltados con motivo y fecha desconocida. No se aplica desde Next.js.
2. Hacer respaldo externo adicional antes de aplicarlo; no publicar tablas `ruta17_respaldo_*`. No tienen acceso anónimo ni de equipo.
3. Consultar el conteo agregado al final del SQL. `scripts/conteo-ruta-17.mts <ruta-env>` hace únicamente GET remoto y ejecuta la migración en PGlite en memoria, con salida agregada y sin guardar datos personales. No es evidencia de SQL aplicado remotamente.
4. Si se revierte: retirar código nuevo y aplicar manualmente `supabase/windsor_ruta_17_pasos_reversa.sql`. Retira triggers/policies de esta función; conserva historial, columnas, alumnos nuevos y documentos. No pisa cambios comerciales posteriores.

## Activación externa pendiente de Harold

- Publicar el Apps Script actualizado sin cambiar `onFormSubmit`. Sustituir su trigger de formulario por `crmAlRecibirGoogleForm` y añadir trigger cada 10 min para `crmReintentarEventos`.
- Propiedades Apps Script: `CRM_EVENTO_URL=https://crm.windsor.edu.mx/api/inscripcion/google-form`, `CRM_EVENTO_SECRETO`. Vercel: `INSCRIPCION_EVENTO_SECRETO` igual. Mantener `INSCRIPCION_DRIVE_URL`/`INSCRIPCION_DRIVE_SECRETO` existentes; actualizar la implementación `/exec` para habilitar `accion=revisar`.
- Recuperar filas antiguas LIC/CL/DIPLOMADOS usando `CRM_REINTENTO_PESTANA`, `CRM_REINTENTO_FILA` y `crmReintentarPendientes` (máximo 20/corrida, cursor persistente). Incluir CL del 30-oct de Karla, identificando por su teléfono; no buscarla por nombre. Este PR no modifica sus datos remotos ni sus filas.
- Revisar y someter manualmente el borrador UTILITY de abajo. **No se ha sometido**. Tras aprobación, configurar `INSCRIPCION_UTILITY_TEMPLATE`. Antes de eso 15 queda visible y 16 pendiente, sin intentar enviar la plantilla inexistente.
- Después de SQL y configuraciones, autorizar merge del PR explícitamente. Merge equivale a producción.

## Borrador Meta, sin someter

Nombre sugerido: `windsor_inscripcion_recibida_harold`. Idioma: `es_MX`. Categoría solicitada: UTILITY (Meta decide aprobación/categoría).

> Nuevo inscrito: {{1}} se inscribió a {{2}} ({{3}}). Revisa el pago y dale la bienvenida: {{4}}

Parámetros: nombre, programa, modalidad, enlace autenticado `/inscripciones/{id}`. Es el texto solicitado; “Nuevo inscrito” es una notificación operativa y **no** acredita 17. Ejemplo ficticio: Ana Ejemplo, Inglés para adultos, En línea, URL de revisión con UUID de prueba. Sin precios ni campañas en el texto.

## Mapa de seguimiento

Se conserva la cadencia real del código actual: Nuevo 3 h dato / 20 h ficha / día 2 plantilla / día 5 archivo; Informado 20 h / día 3 / día 7 / día 10 archivo; Agenda 20 h / día 2 / día 7 archivo; Inscripción 20 h / día 3; backlog y tope 40 plantillas/día vigentes. La frase abreviada 20 h/día3/día7 de la tarea describe Informado y no autoriza uniformar los demás plazos. Perdido automático se desactiva para la ruta nueva, conforme a “solo una persona”.

| Siguiente pendiente | Contenido |
|---|---|
| 2 Nombre | Nombre |
| 3 Correo | Correo; a 20 h la ficha puede resolverlo como saltado con motivo, conservando la excepción actual |
| 4 Oferta | Programa; inglés genérico pregunta edad |
| 5 Modalidad | Presencial/en línea/sabatino |
| 6 Info | Ficha del programa conocido |
| 7–9 Información | Duda/convenio/decisión; plantillas aprobadas según carril |
| 10–12 Agenda opcional | Instrucciones de examen o link Confirmafy actuales; solo cita registrada acredita 10/11 y asistencia completada acredita12 |
| 13–14 | Formulario del programa |
| 15 | Solo documentos faltantes; fuera de ventana no intenta texto libre |
| 16 | Cola UTILITY a Harold; espera aprobación/configuración |
| 17 | Confirmación humana; sin promociones de venta |

El motor consulta todas las conversaciones y decide por ruta, sin filtrar el universo por fases antiguas. Al vencer una revisión con código también retoma el siguiente paso de la ruta.

Los generadores antiguos de reactivación y seguimientos excluyen leads que ya tienen ruta, para que no compitan con el motor ni vuelvan a enviar ventas tras el formulario. No se cambian sus crons.

El bot mantiene las instrucciones del examen y Confirmafy ya aprobadas; no migra a otra agenda por esta tarea. Una reserva externa de Confirmafy no acredita 11 hasta existir en `citas`: no se agregó un webhook ajeno sin contrato confirmado.

## Métricas

Vista EMBUDO, mismos filtros de programa, origen y asesor. Todos los miembros del CRM pueden leer leads, conversaciones y mensajes; se conservan sus permisos de escritura. La tarjeta no permite arrastrar. Desde detalle solo se ofrecen confirmaciones Inscrito/Perdido. Mensajes de asesor nuevos guardan el usuario autenticado y muestran su nombre; los históricos sin autor conservan etiqueta Vendedor.

El numerador de cada paso incluye solo cumplidos, no saltados. Promedios usan pares de fechas comprobadas. Cohortes por lunes de México: se muestra inscripción dentro de 30/60 días, número de leads ya maduros y semanas incompletas. Los inscritos históricos sin fecha se identifican aparte y no se inventa una fecha de cierre; no son una tasa histórica exacta de 30/60 días.

Pruebas locales: `npm test`, `npx tsc --noEmit`, `npm run build -- --webpack`. Proveedores simulados, PGlite, sin SQL remoto ni envíos reales.

## Correcciones 11-bis (2-nov-2026, mismo PR #54)

Las menciones de asesor, Recursos Humanos o vacantes de un grupo no pausan ventas. Solo una petición explícita de persona abre revisión con código y sus plazos existentes de 4/20 h. Los rechazos completos archivan, conservan el progreso y permiten retomar al escribir otra vez; una pregunta o «no tengo dudas» prevalece ante un rechazo ambiguo. El registro de entrega no cuenta como una nueva entrada.

La construcción de respuesta recarga y reintenta hasta dos veces ante conflicto de versión, antes de enviar. Si falla RAG/GPT, se entrega la pregunta pendiente y se abre revisión con código para la duda. Los otros errores se registran en lead_activities y se intenta abrir la misma revisión; si falla la persistencia, se intenta avisar directamente a Harold y entregar el mensaje de espera. Un fallo de registro después de entregar no vuelve a enviar la respuesta al prospecto. Una caída del proveedor de WhatsApp puede impedir entregar; el código no puede garantizar recepción durante esa caída.

Nombre usa el catálogo compartido. Modalidad usa opciones confirmadas en programas.ts, respaldadas por reglasNegocio.ts: diplomados en línea, Psicología presencial y variantes online en línea. Para programas sin lista confirmada se pregunta modalidad sin inventar opciones. «Sabatino» sigue siendo una respuesta válida de horario/modalidad heredada.

Botones de inscripción conservan los procesos aprobados y los requisitos previos de la ruta. Diplomados usan el texto de PR #46 con PDF bancario y enlace prellenado; documentos usan mensajeDocumentosInscripcion; licenciaturas conservan A/B en línea/presencial. Las categorías, información, dudas, tiempo, reactivación y examen/clase se conectan a la ruta sin acreditar citas, documentos ni inscripción por intención. El inventario completo y conteos están en el reporte 11-bis de codex/historial de la carpeta madre.

Audio transcrito e imágenes descritas conservan el procesamiento anterior y los archivos siguen guardándose en CRM. La imagen descrita lleva acuse; los archivos no interpretados y ubicación llevan acuse más pregunta pendiente. Ubicación e interacciones button_reply/list_reply ahora se reconocen al recibir Meta. No se acredita ningún documento por haber recibido una foto o un PDF.

El SQL (solo archivo) evita crear persona histórica si no existe modo humano activo. No se alteran tiempos, cupo diario de 40 ni crons. `scripts/conteo-ruta-17.mts` solo hace GET y simula migración/motor en PGlite; el resultado depende del instante y cupo disponible al leer.

## Tarea 10-bis — canalización con fecha y correcciones del 2-nov

La marca `persona` acepta la fecha histórica de texto o un objeto `{desde,hasta,a,motivo,estado,ultimoAcuseDia,aviso24At}`. No se añade ningún paso: Canalizado 16 sigue siendo el aviso UTILITY de inscripción. Una canalización de atención puede existir en cualquier paso sin acreditar inscripción.

Desde la ficha de Conversaciones y el detalle del lead, «Editar paso o canalización» permite a administración o al asesor asignado confirmar un paso 1–16, programar destinatario/fecha o retirar la marca. Se exige motivo y versión vigente. No permite retrocesos, editar directamente ruta/paso desde el cliente ni confirmar 17; Inscrito/Perdido conservan sus controles. Los huecos se guardan como saltados con motivo; cada cambio registra `auth.uid()` y motivo en `lead_ruta_eventos`. Las etiquetas de Conversaciones de Claude permanecen idénticas.

Durante una canalización el bot devuelve un texto fijo con destinatario y fecha, máximo un acuse por día de México. La versión de la ruta reserva el acuse antes de enviar para evitar duplicados simultáneos. Los demás mensajes se registran y actualizan la bandeja. Si WhatsApp falla tras reservar un acuse, se conserva el evento y se aplica el flujo de error/revisión; no se reintenta ciegamente el mismo acuse. Modo humano activo sigue prevaleciendo. Retirar una marca no libera por sí mismo un modo humano activo.

El motor existente registra el vencimiento y deja `con_asesor` como compatibilidad, sin volver a ventas. A las 24 h sin mensajes de agente registra el pendiente y avisa a Harold y al asesor asignado si tienen teléfono y ventanas abiertas. Se exige ventana del prospecto y de cada destinatario, con el margen conservador de 23.5 h existente; fuera de ellas queda solo en CRM, sin crear ni intentar plantillas nuevas. Un intento se reserva una vez con versión; fallos y omisiones quedan en actividad para revisión. Fechas históricas desconocidas no se inventan. No se modifica la frecuencia del cron ni el cupo de 40 plantillas.

Certificaciones TOEFL/IELTS/B1/B2/comprensión lectora/constancia de inglés durante Contacto derivan por reglas a un asesor educativo, con texto fijo y aviso existente. Un menú de programas no se repite consecutivamente cuando la respuesta no elige programa. El historial que lee la ruta y el flujo heredado es de 12 mensajes; la IA no decide pasos o certificaciones.

Correo aislado después del nombre con Farmacología elegida produce ficha determinista y PDF del catálogo en el mismo mensaje. La ficha se acredita después del envío. Otros diplomados reconocidos reutilizan el mismo catálogo, precios/calendario y PDF aprobados. Conversación fase cerrado que escribe se reabre; se conservan Perdido y modo humano. El validador compartido evita saludar «Windsor», «Sabatinos» o «De»; textos libres omiten el nombre. En plantillas aprobadas cuyo BODY requiere un parámetro de nombre, se usa `😊` en ausencia de nombre válido, sin inventar una persona ni enviar un parámetro vacío.

`WINDSOR_DIAS_INHABILES` es una lista ISO separada por comas. Por defecto se proponen `2026-11-02,2026-11-16`; **Harold debe confirmar ambas fechas antes de publicar**. Una variable explícitamente vacía quita esas excepciones. Horario/visitas consultan esta lista con fecha de México, sin afirmar que hoy se atiende en inhábil. La ficha, las reglas y la respuesta de inicio de niños dicen inscripción abierta todo el año, regularización por el profesor y grupos nuevos a principios de año, sin inventar día exacto. `docs/RAG_10BIS_INGLES_NINOS.md` deja el texto e instrucciones para actualizar RAG manualmente con respaldo.

### Aplicación y reversa pendientes (solo archivos)

Revisar y aplicar manualmente `supabase/windsor_10bis.sql` **antes** del código. Requiere ruta17 y las tablas/campos de revisión de `revision_timeout_2026_10_24.sql`. No añade columnas ni cambia los 17 pasos: añade RPC manual autenticada y adapta controles/auditoría y compatibilidad de la marca. Una revisión antigua de 20 h no puede borrar la canalización nueva, incluso si ya había sido reclamada.

`supabase/windsor_10bis_reversa.sql` restaura las funciones anteriores y revoca edición manual, conservando datos/eventos. Impide revertir mientras existan marcas estructuradas: primero una persona debe resolverlas/retirarlas y conservar código compatible; no restaurar el cliente antiguo sobre objetos `persona`. No se ejecutó SQL remoto ni se configuró el calendario/RAG/cron desde esta tarea.

Validación local: suite completa, TypeScript, build con variables públicas ficticias, PGlite para permisos, actor real, versiones, límites de pasos, reejecución y bloqueo de reversa incompatible; mocks para aviso con/sin ventana y carreras. La comparación de hash de Conversaciones permite solo las dos líneas que añaden el editor y prueba que las etiquetas siguen intactas.
