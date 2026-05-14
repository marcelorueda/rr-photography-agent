const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rr_photography_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || "rr2024";

const conversaciones = {};
const metaDatos = {};

const SYSTEM_PROMPT = `Eres el asistente virtual de RR Photography, un negocio de fotografia para eventos en San Luis Potosi y Matehuala, Mexico. Tu lema es "Del momento al recuerdo".

Tu nombre es "Roro" y representas a la empresa con un tono amable, profesional y calido.

## PAQUETES FOTOGRAFICOS

### Paquete Digital - $2,350 MXN
- 50 fotos digitales editadas
- Entrega por WhatsApp
- Opcion USB personalizado (+$350)
- Ideal para eventos pequeÃ±os

### Paquete Impresiones - $3,400 MXN
- 50 fotografias digitales
- 20 fotografias impresas en tamaÃ±o 6x8
- Opcion de incluir USB (+$350)

### Paquete Memorable - $4,500 MXN
- 16 fotos en album personalizado
- 15 impresiones 6x8
- 1 impresion 10x15 (poster)
- Entrega en USB

### EXTRAS
- USB personalizado: $350
- Album adicional: desde $1,200

## INFORMACION DEL NEGOCIO
- Cobertura: San Luis Potosi y Matehuala
- Tipos de eventos: infantiles, XV aÃ±os, bodas, corporativos, graduaciones, y todo tipo de eventos
- Anticipacion minima: 1 dia (aunque se recomienda reservar con mas tiempo)
- Formas de pago: Efectivo, transferencia bancaria y tarjeta
- Anticipo: 50% para confirmar la reserva, el resto el dia del evento
- Numero de fotografos: 1 fotografo cubre el evento. Si el cliente necesita mas cobertura, transferir al dueno.

## POLITICA DE NEGOCIACION
- NO puedes ofrecer descuentos en los precios establecidos
- SI puedes ajustar el trabajo proporcionalmente al presupuesto del cliente
- Puedes combinar elementos de diferentes paquetes para adaptarte al presupuesto

## DATOS DE PAGO
Cuando el cliente confirme que quiere apartar la fecha y pagar el anticipo por transferencia:
- Banco: Nu Mexico
- CLABE interbancaria: 638180010168846336
- Monto: 50% del paquete elegido

## REDES SOCIALES
- Instagram: @rr_photography_ig
- IMPORTANTE: Solo comparte el Instagram si el cliente lo pide explicitamente.

## PROCESO DE CONTRATACION
1. Confirma fecha, lugar y tipo de evento
2. Confirma el paquete elegido
3. Informa que se requiere 50% de anticipo para apartar la fecha
4. Pregunta si pagara en efectivo, tarjeta o transferencia
5. Si elige transferencia, proporciona la CLABE
6. Una vez confirmado el pago, dile que Marce lo contactara para finalizar el contrato

## CUANDO TRANSFERIR AL DUENO
Transfiere en estos casos:
- El cliente pregunta algo muy especifico que no esta en tu informacion
- Hay un conflicto o queja
- El cliente insiste en hablar con una persona
- Necesitas confirmar disponibilidad de fecha especifica
- El cliente quiere cerrar el contrato formalmente

IMPORTANTE: Cuando necesites transferir, escribe tu respuesta normal al cliente y al final agrega exactamente esta palabra en una linea nueva sin nada mas:
TRANSFERIR_DUENO

## REGLAS GENERALES
- Responde siempre en espaÃ±ol
- Se amable, profesional y entusiasta
- No uses emojis`;

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (!body.object) return;
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return;

    const message = messages[0];
    const from = message.from;
    const messageType = message.type;
    let textoCliente = "";

    if (messageType === "text") {
      textoCliente = message.text.body;
    } else if (messageType === "interactive") {
      textoCliente = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
    } else {
      await enviarMensaje(from, "Por el momento solo puedo responder mensajes de texto. En que te puedo ayudar?");
      return;
    }

    if (!conversaciones[from]) conversaciones[from] = [];
    if (!metaDatos[from]) metaDatos[from] = { mensajes: [], ultimaActividad: null };

    conversaciones[from].push({ role: "user", content: textoCliente });
    metaDatos[from].mensajes.push({ tipo: "cliente", texto: textoCliente, hora: new Date().toLocaleString("es-MX") });
    metaDatos[from].ultimaActividad = new Date().toLocaleString("es-MX");

    if (conversaciones[from].length > 20) conversaciones[from] = conversaciones[from].slice(-20);

    const respuestaCompleta = await obtenerRespuestaIA(conversaciones[from]);

    const necesitaTransferir = respuestaCompleta.includes("TRANSFERIR_DUENO");
    const respuestaLimpia = respuestaCompleta.replace("TRANSFERIR_DUENO", "").trim();

    await enviarMensaje(from, respuestaLimpia);

    conversaciones[from].push({ role: "assistant", content: respuestaLimpia });
    metaDatos[from].mensajes.push({ tipo: "agente", texto: respuestaLimpia, hora: new Date().toLocaleString("es-MX") });

    if (necesitaTransferir) {
      await notificarDueno(from, textoCliente, conversaciones[from]);
    }

  } catch (error) {
    console.error("Error:", error.message);
  }
});

app.get("/panel", (req, res) => {
  const pass = req.query.pass;
  if (pass !== PANEL_PASSWORD) {
    return res.send(`<html><body style="font-family:sans-serif;padding:40px;background:#111;color:white"><h2>RR Photography - Panel</h2><form><input name="pass" type="password" placeholder="Contrasena" style="padding:10px;font-size:16px;margin-right:10px"/><button type="submit" style="padding:10px 20px;background:#25D366;color:white;border:none;font-size:16px;cursor:pointer">Entrar</button></form></body></html>`);
  }

  const numeros = Object.keys(metaDatos);
  let contactosHtml = numeros.length === 0 ? '<div style="padding:20px;color:#666;font-size:13px">No hay conversaciones aun</div>' : "";
  for (const num of numeros) {
    const data = metaDatos[num];
    const ultimoMsg = data.mensajes[data.mensajes.length - 1];
    contactosHtml += `<div class="contacto" onclick="mostrar('${num}')"><div class="numero">+${num}</div><div class="preview">${ultimoMsg ? ultimoMsg.texto.substring(0, 50) : ""}</div><div class="hora">${data.ultimaActividad || ""}</div></div>`;
  }

  const datosJS = JSON.stringify(metaDatos).replace(/</g, "\\u003c");

  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RR Photography Panel</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#111;color:#eee;display:flex;height:100vh}#lista{width:300px;background:#1a1a1a;overflow-y:auto;border-right:1px solid #333}#lista h2{padding:16px;background:#25D366;color:white;font-size:16px}.contacto{padding:14px 16px;border-bottom:1px solid #2a2a2a;cursor:pointer}.contacto:hover{background:#252525}.numero{font-weight:bold;font-size:14px}.preview{font-size:12px;color:#aaa;margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.hora{font-size:11px;color:#666;margin-top:2px}#chat{flex:1;display:flex;flex-direction:column}#chat-header{padding:16px;background:#1a1a1a;border-bottom:1px solid #333;font-weight:bold}#mensajes{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}#vacio{flex:1;display:flex;align-items:center;justify-content:center;color:#555;font-size:18px}.burbuja{max-width:70%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5}.cliente{background:#2a2a2a;align-self:flex-start}.agente{background:#075E54;align-self:flex-end}.burbuja .hora2{font-size:11px;color:#aaa;margin-top:4px;text-align:right}</style></head><body><div id="lista"><h2>Conversaciones (${numeros.length})</h2>${contactosHtml}</div><div id="chat"><div id="vacio">Selecciona una conversacion</div></div><script>const datos=${datosJS};function mostrar(num){const data=datos[num];const chat=document.getElementById("chat");let msgsHtml=data.mensajes.map(m=>'<div class="burbuja '+m.tipo+'">'+m.texto+'<div class="hora2">'+m.hora+'</div></div>').join("");chat.innerHTML='<div id="chat-header">+'+num+'</div><div id="mensajes">'+msgsHtml+'</div>';document.getElementById("mensajes").scrollTop=99999;}</script></body></html>`);
});

async function obtenerRespuestaIA(historial) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      { model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: SYSTEM_PROMPT, messages: historial },
      { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" } }
    );
    return response.data.content[0].text;
  } catch (error) {
    console.error("Error Anthropic:", error.response?.data || error.message);
    return "Lo siento, tuve un problema tecnico. Por favor intenta de nuevo.";
  }
}

async function enviarMensaje(to, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to: to, type: "text", text: { body: texto } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error enviando:", error.response?.data || error.message);
  }
}

async function notificarDueno(clientePhone, ultimoMensaje, historial) {
  if (!OWNER_PHONE) return;
  const ultimos = historial.slice(-4).map(m => (m.role === "user" ? "Cliente" : "Agente") + ": " + m.content).join("\n");
  const notificacion = "Atencion requerida\n\nUn cliente necesita tu atencion.\n\nNumero: +" + clientePhone + "\n\nUltimos mensajes:\n" + ultimos + "\n\nContactalo directamente.";
  await enviarMensaje(OWNER_PHONE, notificacion);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
