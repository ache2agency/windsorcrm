import { fetchApprovedTemplateBody } from './provider'

export function sustituirParametrosTemplate(body: string, parameters: string[]): string | null {
  let faltan = false
  const texto = body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, indice: string) => {
    const valor = parameters[Number(indice) - 1]
    if (valor === undefined) { faltan = true; return '' }
    return valor
  })
  return faltan ? null : texto
}

export async function textoTemplateEnviado(nombre: string, parametros: string[], obtener = fetchApprovedTemplateBody) {
  const body = await obtener(nombre)
  return body ? sustituirParametrosTemplate(body, parametros) : null
}
