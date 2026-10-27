export function diasInactividadHumana(env: Record<string, string | undefined> = process.env) {
  const dias = Number(env.MODO_HUMANO_INACTIVO_DIAS || 7)
  return Number.isFinite(dias) && dias >= 1 && dias <= 3650 ? dias : 7
}
