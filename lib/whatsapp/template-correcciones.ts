// No se aplica al registro de mensajes: debe mostrar lo que Meta envió realmente.
// Para un BODY fijo de Meta, la corrección debe hacerse en la definición de Meta.
export function corregirComillaSeguimiento(body: string) {
  const cierre = '¿Pudiste revisar la información que te compartimos sobre Instituto Windsor? Si tienes alguna duda, con gusto te ayudamos. 😊'
  const texto = body.trimEnd()
  return texto.endsWith(cierre + '"') || texto.endsWith(cierre + '”') ? texto.slice(0, -1) : body
}
