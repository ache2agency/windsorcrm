/**
 * InscripcionCRM.gs — recibe las solicitudes del formulario del CRM
 * (crm.windsor.edu.mx/inscripcion/...) y las mete al mismo Sheet que Google Forms.
 *
 * Archivo NUEVO dentro del mismo proyecto de Apps Script del Sheet
 * "SOLICITUD DE INSCRIPCIÓN LICENCIATURAS (respuestas)". No modifica onFormSubmit:
 * escribe la fila (con los documentos ya subidos a Drive) y luego llama a
 * onFormSubmit para que cree la carpeta del alumno, mueva los archivos, genere la
 * ficha PDF y escriba "Carpeta Drive" / "Ficha PDF", igual que con Google Forms.
 *
 * Reintentos del mismo folio no duplican: se busca en la columna "Folio CRM".
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   INSCRIPCION_SECRETO   — el mismo valor que INSCRIPCION_DRIVE_SECRETO en Vercel.
 *   DIPLOMADOS_FOLDER_ID  — ID de la carpeta de Drive de diplomados.
 *
 * Implementar → Nueva implementación → Aplicación web:
 *   Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 * La URL /exec va en INSCRIPCION_DRIVE_URL en Vercel.
 *
 * Versión ultra-compatible (Rhino & V8), igual que el script principal.
 */

var CRM_PESTANAS = {
  "licenciaturas": "Respuestas de formulario LIC",
  "cursos-libres": "Respuestas de formulario CL",
  "diplomados": "Respuestas de formulario DIPLOMADOS"
};

// Encabezado normalizado (sin acentos, minúsculas, espacios simples) → campo del CRM.
var CRM_COLUMNAS = {
  "marca temporal": "_marca",
  "direccion de correo electronico": "email",
  "correo electronico": "email",
  "apellido paterno": "apellido_paterno",
  "apellido materno": "apellido_materno",
  "nombre(s)": "nombres",
  "edad": "edad",
  "fecha de nacimiento": "fecha_nacimiento",
  "telefono de casa": "telefono_casa",
  "telefono de movil": "whatsapp",
  "curp": "curp",
  "direccion (calle y numero)": "direccion",
  "direccion (ciudad y municipio)": "ciudad",
  "tutor (nombre completo)": "tutor",
  "parentesco": "parentesco",
  "telefono de casa (tutor)": "tutor_casa",
  "telefono de movil (tutor)": "tutor_movil",
  "nombre de preparatoria": "preparatoria",
  "ciudad donde se curso": "preparatoria_ciudad",
  "carrera solicitada": "curso",
  "curso solicitado": "curso",
  "diplomado solicitado": "curso",
  "modalidad": "modalidad",
  "cuota de inscripcion": "cuota_inscripcion",
  "plan de pago": "plan_pago",
  "selecciona el medio por el que te enteraste de la escuela": "medio",
  "¿habla alguna lengua indigena?": "lengua_indigena",
  "ciudad de residencia": "ciudad",
  "pais de residencia": "pais",
  "estado de residencia": "estado"
};

// Documentos: los encabezados del Form traen instrucciones largas, se buscan por inicio.
var CRM_DOCUMENTOS = [
  ["acta de nacimiento", "acta"],
  ["certificado de bachillerato", "certificado"],
  ["comprobante de pago", "comprobante"],
  ["documento curp", "curp_documento"],
  ["ine", "ine"]
];
// Columnas que se agregan al final si la pestaña no las tiene.
var CRM_COLUMNAS_NUEVAS = { curp_documento: "Documento CURP", ine: "INE", _folio: "Folio CRM" };
var CRM_NOMBRE_DOC = {
  acta: "Acta de nacimiento", certificado: "Certificado de bachillerato", comprobante: "Comprobante de pago",
  curp_documento: "CURP", ine: "INE"
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var secreto = props.getProperty("INSCRIPCION_SECRETO");
    if (!secreto || body.secreto !== secreto) return crmRespuesta_({ ok: false, error: "No autorizado" });

    if (body.accion === "revisar") return crmRespuesta_(crmRevisarDocumentos_(body.pestana, body.fila));
    var nombrePestana = CRM_PESTANAS[body.programa];
    if (!nombrePestana) return crmRespuesta_({ ok: false, error: "Programa inválido" });
    if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) return crmRespuesta_({ ok: false, error: "Folio inválido" });

    lock.waitLock(60000);

    crmAsegurarDiplomados_(props);
    var config = FORM_CONFIGS[nombrePestana];
    if (!config) return crmRespuesta_({ ok: false, error: "Falta configurar la carpeta de " + body.programa });

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombrePestana);
    if (!sheet) return crmRespuesta_({ ok: false, error: "No existe la pestaña " + nombrePestana });

    var datos = body.datos || {};
    var archivos = body.archivos || [];

    // Columnas faltantes (documentos opcionales y folio) al final, antes de leer encabezados.
    var tipos = { _folio: true };
    for (var a = 0; a < archivos.length; a++) tipos[archivos[a].tipo] = true;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var clave in CRM_COLUMNAS_NUEVAS) {
      if (tipos[clave] && crmColumnaDe_(headers, clave) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(CRM_COLUMNAS_NUEVAS[clave]);
        headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      }
    }

    // Idempotencia: un reintento del mismo folio devuelve la fila ya creada.
    var colFolio = crmColumnaDe_(headers, "_folio");
    var encontrado = sheet.getRange(2, colFolio + 1, Math.max(sheet.getLastRow() - 1, 1), 1)
      .createTextFinder(body.id).matchEntireCell(true).findNext();
    if (encontrado) return crmRespuesta_(crmResultado_(sheet, encontrado.getRow(), nombrePestana));

    // Documentos a la carpeta del programa; onFormSubmit los mueve a la del alumno.
    var carpeta = DriveApp.getFolderById(config.parentFolderId);
    var nombreAlumno = [datos.nombres, datos.apellido_paterno, datos.apellido_materno]
      .join(" ").replace(/\s+/g, " ").trim().replace(/[\/\\?%*:|"<>]/g, "-");
    var urls = {};
    for (var i = 0; i < archivos.length; i++) {
      var arch = archivos[i];
      var nombre = (CRM_NOMBRE_DOC[arch.tipo] || arch.tipo) + " - " + nombreAlumno + "." + arch.extension;
      var blob = Utilities.newBlob(Utilities.base64Decode(arch.base64), arch.mimeType, nombre);
      var file = carpeta.createFile(blob);
      // Mismo formato que escribe Google Forms; extractFileId lo entiende.
      urls[arch.tipo] = "https://drive.google.com/open?id=" + file.getId();
    }

    var fila = [];
    for (var c = 0; c < headers.length; c++) {
      var campo = crmCampoDe_(headers[c]);
      var valor = "";
      if (campo === "_marca") valor = new Date();
      else if (campo === "_folio") valor = body.id;
      else if (campo && urls[campo]) valor = urls[campo];
      else if (campo) valor = crmValor_(campo, datos[campo]);
      fila.push(valor);
    }
    var numFila = sheet.getLastRow() + 1;
    sheet.getRange(numFila, 1, 1, fila.length).setValues([fila]);
    // Con hora, como las filas de Google Forms.
    var colMarca = crmColumnaDe_(headers, "_marca");
    if (colMarca !== -1) sheet.getRange(numFila, colMarca + 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    SpreadsheetApp.flush();

    // Mismo proceso que un envío de Google Forms (carpeta, ficha PDF, links).
    onFormSubmit({ range: sheet.getRange(numFila, 1) });

    return crmRespuesta_(crmResultado_(sheet, numFila, nombrePestana));
  } catch (err) {
    Logger.log("Error en doPost (InscripcionCRM): " + err);
    return crmRespuesta_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignorar) {}
  }
}

/** Lee "Carpeta Drive" y "Ficha PDF" de la fila; sin carpeta, onFormSubmit falló. */
function crmResultado_(sheet, numFila, nombrePestana) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colCarpeta = crmIndiceExacto_(headers, "Carpeta Drive");
  var colFicha = crmIndiceExacto_(headers, "Ficha PDF");
  var carpetaUrl = colCarpeta === -1 ? "" : String(sheet.getRange(numFila, colCarpeta + 1).getValue());
  var fichaUrl = colFicha === -1 ? "" : String(sheet.getRange(numFila, colFicha + 1).getValue());
  if (!carpetaUrl) return { ok: false, error: "No se generó la carpeta del alumno (" + nombrePestana + ", fila " + numFila + "). Revisar registros de onFormSubmit." };
  return { ok: true, pestana: nombrePestana, fila: numFila, carpeta: carpetaUrl, ficha: fichaUrl };
}

/** Diplomados no estaba en FORM_CONFIGS: se agrega en memoria con su carpeta. */
function crmAsegurarDiplomados_(props) {
  var pestana = CRM_PESTANAS["diplomados"];
  if (FORM_CONFIGS[pestana]) return;
  var carpetaId = props.getProperty("DIPLOMADOS_FOLDER_ID");
  if (!carpetaId) return;
  FORM_CONFIGS[pestana] = {
    parentFolderId: carpetaId,
    badgeText: "Inscripción Diplomado",
    folioPrefix: "IWD-",
    pdfNamePrefix: "Ficha_Inscripcion_Diplomado_"
  };
}

function crmNormalizar_(texto) {
  var t = String(texto || "").toLowerCase();
  var mapa = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u" };
  t = t.replace(/[áéíóúü]/g, function (ch) { return mapa[ch]; });
  return t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+/g, " ").trim();
}

function crmCampoDe_(header) {
  var h = crmNormalizar_(header);
  if (!h) return null;
  if (CRM_COLUMNAS.hasOwnProperty(h)) return CRM_COLUMNAS[h];
  if (h.indexOf("en caso de haber contestado") === 0) return "lengua_cual";
  for (var i = 0; i < CRM_DOCUMENTOS.length; i++) {
    var prefijo = CRM_DOCUMENTOS[i][0];
    if (h === prefijo || h.indexOf(prefijo + " ") === 0) return CRM_DOCUMENTOS[i][1];
  }
  if (h === "folio crm") return "_folio";
  return null;
}

function crmColumnaDe_(headers, campo) {
  for (var i = 0; i < headers.length; i++) if (crmCampoDe_(headers[i]) === campo) return i;
  return -1;
}

function crmIndiceExacto_(headers, nombre) {
  for (var i = 0; i < headers.length; i++) if (String(headers[i]).trim() === nombre) return i;
  return -1;
}

function crmValor_(campo, valor) {
  var v = String(valor == null ? "" : valor).trim();
  if (!v) return "";
  if (campo === "fecha_nacimiento" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    var p = v.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  // WhatsApp mexicano: 10 dígitos, como lo capturaban en Google Forms.
  if (campo === "whatsapp" && /^\+52\d{10}$/.test(v)) return v.slice(3);
  // Evita que Sheets lo interprete como fórmula o número con signo.
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function crmRespuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Instalar UN trigger de envío de formulario sobre crmAlRecibirGoogleForm.
 * Sustituye el trigger directo de onFormSubmit: primero conserva su trabajo, luego avisa al CRM.
 * No instalar ambos o se duplicaría el procesamiento de carpeta/PDF.
 */
function crmAlRecibirGoogleForm(e) {
  var sheet=e.range.getSheet(),fila=e.range.getRow();
  var clave="CRM_PENDIENTE_"+sheet.getSheetId()+"_"+fila;
  var props=PropertiesService.getScriptProperties();
  props.setProperty(clave,JSON.stringify({pestana:sheet.getName(),fila:fila}));
  crmAsegurarDiplomados_(props);
  try { onFormSubmit(e); } catch(err) { Logger.log("Procesamiento Drive pendiente: "+err); }
  crmNotificarFila_(sheet,fila);
  props.deleteProperty(clave);
}
function crmNotificarFila_(sheet, fila) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("CRM_EVENTO_URL");
  var secreto = props.getProperty("CRM_EVENTO_SECRETO");
  if (!url || !/^https:\/\//.test(url) || !secreto) throw new Error("Falta configurar evento CRM");
  var programa = null;
  for (var p in CRM_PESTANAS) if (CRM_PESTANAS[p] === sheet.getName()) programa = p;
  if (!programa) return;
  var headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(fila,1,1,headers.length).getValues()[0];
  var datos = {};
  for (var i=0;i<headers.length;i++) { var campo=crmCampoDe_(headers[i]); if(campo) datos[campo]=String(values[i]||""); }
  var resultado=crmResultado_(sheet,fila,sheet.getName());
  // La solicitud ya llegó aunque Drive todavía no tenga carpeta; el CRM conserva paso 14.
  var respuesta=UrlFetchApp.fetch(url,{method:"post",contentType:"application/json",headers:{Authorization:"Bearer "+secreto},
    payload:JSON.stringify({programa:programa,pestana:sheet.getName(),fila:fila,datos:datos,carpeta:resultado.carpeta||"",ficha:resultado.ficha||""}),muteHttpExceptions:true});
  if(respuesta.getResponseCode()!==200) throw new Error("Evento CRM no registrado: fila "+fila);
}
/** Reintentar una fila manualmente (también Karla CL 30-oct) o ejecutar por lote desde un cursor.
 * Guardar CRM_REINTENTO_PESTANA y CRM_REINTENTO_FILA; no busca alumnos por nombre.
 * Un fallo conserva el cursor para que el trigger temporal vuelva a intentarlo.
 */
function crmReintentarPendientes() {
  var props=PropertiesService.getScriptProperties();
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(props.getProperty("CRM_REINTENTO_PESTANA"));
  if(!sheet) return;
  var fila=Number(props.getProperty("CRM_REINTENTO_FILA")||2);
  for(var i=0;i<20 && fila<=sheet.getLastRow();i++,fila++) {
    crmNotificarFila_(sheet,fila);
    props.setProperty("CRM_REINTENTO_FILA",String(fila+1));
  }
}
/** Revisa los IDs de documentos indicados por la fila y verifica que existan EN la carpeta.
 * No considera la ficha PDF como documento del alumno ni confía en la lista de uploads del cliente.
 */
function crmRevisarDocumentos_(pestana, fila) {
  var permitido=false;
  for(var p in CRM_PESTANAS) if(CRM_PESTANAS[p]===pestana) permitido=true;
  if(!permitido || fila<2 || Math.floor(fila)!==fila) throw new Error("Fila inválida");
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(pestana);
  if(!sheet || fila>sheet.getLastRow()) throw new Error("Fila no existe");
  var resultado=crmResultado_(sheet,fila,pestana);
  if(!resultado.ok) throw new Error(resultado.error);
  var carpetaId=resultado.carpeta.match(/[-\w]{25,}/);
  if(!carpetaId) throw new Error("Carpeta inválida");
  var carpeta=DriveApp.getFolderById(carpetaId[0]);
  var files=carpeta.getFiles(); var existentes={};
  while(files.hasNext()) {var f=files.next();if(!f.isTrashed()) existentes[f.getId()]=true;}
  var headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  var values=sheet.getRange(fila,1,1,headers.length).getValues()[0];
  var tipos=[];
  for(var i=0;i<headers.length;i++) {
    var campo=crmCampoDe_(headers[i]);
    if(!CRM_NOMBRE_DOC[campo]) continue;
    var ids=String(values[i]||"").match(/[-\w]{25,}/g)||[];
    for(var j=0;j<ids.length;j++) if(existentes[ids[j]]) {tipos.push(campo);break;}
  }
  return {ok:true,tipos:tipos};
}

/** Trigger temporal cada 10 minutos; persiste fallos del callback aunque el CRM esté caído. */
function crmReintentarEventos() {
  var props=PropertiesService.getScriptProperties(),valores=props.getProperties(),n=0;
  for(var clave in valores) if(clave.indexOf("CRM_PENDIENTE_")===0 && n++<20) {
    try {
      var p=JSON.parse(valores[clave]);
      var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.pestana);
      crmNotificarFila_(sheet,p.fila);
      props.deleteProperty(clave);
    } catch(err) { Logger.log("Pendiente CRM: "+clave+" "+err); }
  }
}
