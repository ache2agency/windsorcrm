import assert from 'node:assert/strict'
const base = 'http://127.0.0.1:3187'
for (const programa of ['licenciaturas','cursos-libres','diplomados']) {
 const r = await fetch(`${base}/inscripcion/${programa}?wa=%2B527471234567&nombre=Ana`)
 assert.equal(r.status,200)
 assert.ok((await r.text()).includes('Enviar solicitud de inscripción'))
 console.log(programa,200)
}
for (const [path,status] of [['/inscripcion/invalido',404],['/inscripciones/00000000-0000-4000-8000-000000000000',307],['/api/inscripciones/00000000-0000-4000-8000-000000000000',401],['/api/leads/00000000-0000-4000-8000-000000000000/inscripciones',401]]) {
 const r=await fetch(base+path,{redirect:'manual'}); assert.equal(r.status,status); console.log(path,status)
}
let r=await fetch(base+'/api/inscripcion',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
assert.equal(r.status,415)
r=await fetch(base+'/api/inscripcion',{method:'POST',headers:{'origin':'https://otro.example','content-type':'application/json'},body:'{}'})
assert.equal(r.status,403)
r=await fetch(base+'/api/inscripcion',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=test'},body:'x'.repeat(4*1024*1024+1)})
assert.equal(r.status,413)
console.log('POST: formato 415; origen 403; tamaño 413. Sin conexión a Supabase.')
