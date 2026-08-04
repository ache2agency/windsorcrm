# Fix de raíz — alucinaciones y datos inconsistentes del bot

Diagnóstico hecho el 2026-07-29 revisando `app/api/whatsapp/webhook/route.ts` y
`lib/whatsapp/reglasNegocio.ts`, a raíz de que los bugs de datos inventados/inconsistentes
(CLABE falsa, precios distintos según fuente, programa asumido) siguen reapareciendo pese a
corregirse uno por uno.

## Diagnóstico

El bot ya tiene guardrails contra alucinación — pero viven **solo como texto en el prompt**
(`REGLAS_NEGOCIO`, 43 reglas, varias marcadas "CRÍTICO — NUNCA INVENTES..."). Cada vez que
aparece un bug nuevo de este tipo, la corrección ha sido agregar una regla más al prompt.
Eso es un parche válido pero no resuelve la causa: instrucciones en prompt son probabilísticas,
no garantizadas — con 43 reglas compitiendo por atención del modelo, siempre habrá un caso
límite donde no se sigue una.

La mitad de la solución de raíz ya existe y funciona: los `INFO_MSGS` (fichas de precio
hardcodeadas por programa, en `route.ts`) evitan que GPT toque el precio en programas
conocidos — ahí no hay alucinación porque no hay generación libre. El hueco está en el
**fallback**: programas sin ficha hardcodeada (maestrías, diplomados, francés, italiano) caen
a "RAG + GPT libre" (buscar `Fallback RAG+GPT` en `route.ts`), y ahí es donde el modelo
improvisa cifras o datos, pese a que el prompt le diga que no lo haga.

## Los 2 fixes de raíz (no agregar más reglas al prompt)

- [ ] **Validación post-generación en código.** Después de que GPT regresa el JSON de
      respuesta, escanear el campo `respuesta` con una función determinista (regex) que
      detecte: montos en pesos, secuencias tipo CLABE/cuenta (10-18 dígitos). Cruzar
      cualquier monto contra `VALOR_POR_PROGRAMA` / `INFO_MSGS` del programa identificado.
      Si no coincide con nada conocido → bloquear el envío, forzar `necesitaRevision: true`
      y escalar, en vez de confiar en que el modelo decidió no inventar.
- [ ] **Cerrar el hueco del fallback.** Ubicar qué programas caen hoy en "RAG+GPT libre"
      (maestrías, diplomados, francés, italiano — ver `RAG_INFO_PENDIENTE.md`, ya listados
      ahí como huecos de información) y darles ficha `INFO_MSG` hardcodeada igual que los
      demás programas, para reducir cuántos casos dependen de generación libre.

## Regla general al agregar futuras correcciones

Si un bug nuevo es "el bot inventó/mezcló un dato factual" (precio, fecha, cuenta, programa),
la pregunta antes de escribir una regla más en `reglasNegocio.ts` es: **¿este dato puede
hardcodearse o validarse en código en vez de pedírselo de nuevo al modelo?** Reservar
`reglasNegocio.ts` para reglas de tono/comportamiento, no para "no inventes X" repetido.
