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

const MAX_HISTORY = 8;

const SYSTEM_PROMPT = `
Eres Roro, asistente virtual de RR Photography.

Negocio de fotografia para eventos en San Luis Potosi y Matehuala.
Lema: "Del momento al recuerdo".

Habla:
- Profesional
- Amable
- Natural
- Breve
- Sin emojis

PAQUETES:

Digital - $2350
- 50 fotos digitales
- Entrega WhatsApp
- USB opcional +$350

Impresiones - $3400
- 50 digitales
- 20 impresas 6x8

Memorable - $4500
- Album personalizado
- 15 impresiones 6x8
- Poster 10x15
- USB incluido

EXTRAS:
- USB +$350
- Album extra desde $1200

PAGOS:
- 50% anticipo
- Efectivo
- Transferencia
- Tarjeta

TRANSFERENCIA:
Banco: Nu Mexico
CLABE: 638180010168846336

EVENTOS:
- XV años
- Bodas
- Infantiles
- Corporativos
- Graduaciones

REGLAS:
- No ofrecer descuentos
- Si adaptar paquetes al presupuesto
- Respuestas maximo 3 oraciones cortas
- Responder siempre en español

TRANSFERIR_DUENO si:
- quieren hablar con persona
- dudas muy especificas
- conflictos
- confirmar disponibilidad exacta
- cerrar contrato formalmente

Cuando transfieras agrega SOLO:
TRANSFERIR_DUENO
`;

const RESPUESTAS_RAPIDAS = {
  paquetes:
    "Manejamos paquetes desde $2350 hasta $4500. Incluyen fotografia digital, impresiones y albumes dependiendo del paquete. ¿Que tipo de evento tendras?",

  precios:
    "Nuestros paquetes empiezan desde $2350 MXN. ¿Te gustaria conocer las opciones disponibles?",

  pago:
    "Aceptamos efectivo, transferencia y tarjeta. Para reservar se requiere 50% de anticipo.",

  ubicacion:
    "Trabajamos en San Luis Potosi y Matehuala.",

  gracias:
    "Con gusto. Quedo atento a cualquier duda.",

  hola:
    "Hola, soy Roro de RR Photography. ¿En que puedo ayudarte?"
};

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
      textoCliente = message.text.body.trim();
    } else if (messageType === "interactive") {
      textoCliente =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";
    } else {
      await enviarMensaje(
        from,
        "Por el momento solo puedo responder mensajes de texto."
      );
      return;
    }

    const textoLower = textoCliente.toLowerCase();

    // IGNORAR MENSAJES MUY CORTOS
    const mensajesSimples = [
      "ok",
      "gracias",
      "va",
      "sale",
      "jaja",
      "jj",
      "👍",
      "grcs"
    ];

    if (mensajesSimples.includes(textoLower)) {
      await enviarMensaje(from, "Perfecto.");
      return;
    }

    // RESPUESTAS RAPIDAS SIN IA
    if (
      textoLower.includes("precio") ||
      textoLower.includes("cuanto") ||
      textoLower.includes("costos")
    ) {
      await enviarMensaje(from, RESPUESTAS_RAPIDAS.precios);
      return;
    }

    if (
      textoLower.includes("paquete") ||
      textoLower.includes("paquetes")
    ) {
      await enviarMensaje(from, RESPUESTAS_RAPIDAS.paquetes);
      return;
    }

    if (
      textoLower.includes("pago") ||
      textoLower.includes("transferencia")
    ) {
      await enviarMensaje(from, RESPUESTAS_RAPIDAS.pago);
      return;
    }

    if (
      textoLower.includes("donde") ||
      textoLower.includes("ubicacion")
    ) {
      await enviarMensaje(from, RESPUESTAS_RAPIDAS.ubicacion);
      return;
    }

    if (
      textoLower.includes("hola") ||
      textoLower.includes("buenas")
    ) {
      await enviarMensaje(from, RESPUESTAS_RAPIDAS.hola);
      return;
    }

    // CREAR HISTORIAL
    if (!conversaciones[from]) conversaciones[from] = [];

    if (!metaDatos[from]) {
      metaDatos[from] = {
        mensajes: [],
        ultimaActividad: null
      };
    }

    conversaciones[from].push({
      role: "user",
      content: textoCliente
    });

    metaDatos[from].mensajes.push({
      tipo: "cliente",
      texto: textoCliente,
      hora: new Date().toLocaleString("es-MX")
    });

    metaDatos[from].ultimaActividad =
      new Date().toLocaleString("es-MX");

    // LIMITAR HISTORIAL
    if (conversaciones[from].length > MAX_HISTORY) {
      conversaciones[from] =
        conversaciones[from].slice(-MAX_HISTORY);
    }

    // IA
    const respuestaCompleta =
      await obtenerRespuestaIA(conversaciones[from]);

    const necesitaTransferir =
      respuestaCompleta.includes("TRANSFERIR_DUENO");

    const respuestaLimpia = respuestaCompleta
      .replace("TRANSFERIR_DUENO", "")
      .trim();

    await enviarMensaje(from, respuestaLimpia);

    conversaciones[from].push({
      role: "assistant",
      content: respuestaLimpia
    });

    metaDatos[from].mensajes.push({
      tipo: "agente",
      texto: respuestaLimpia,
      hora: new Date().toLocaleString("es-MX")
    });

    if (necesitaTransferir) {
      await notificarDueno(
        from,
        textoCliente,
        conversaciones[from]
      );
    }

  } catch (error) {
    console.error("Error:", error.message);
  }
});

app.get("/panel", (req, res) => {
  const pass = req.query.pass;

  if (pass !== PANEL_PASSWORD) {
    return res.send(`
      <html>
      <body style="font-family:sans-serif;padding:40px;background:#111;color:white">
        <h2>RR Photography - Panel</h2>
        <form>
          <input
            name="pass"
            type="password"
            placeholder="Contrasena"
            style="padding:10px;font-size:16px;margin-right:10px"
          />
          <button
            type="submit"
            style="padding:10px 20px;background:#25D366;color:white;border:none;font-size:16px"
          >
            Entrar
          </button>
        </form>
      </body>
      </html>
    `);
  }

  const numeros = Object.keys(metaDatos);

  let contactosHtml =
    numeros.length === 0
      ? '<div style="padding:20px;color:#666">No hay conversaciones aun</div>'
      : "";

  for (const num of numeros) {
    const data = metaDatos[num];
    const ultimoMsg = data.mensajes[data.mensajes.length - 1];

    contactosHtml += `
      <div class="contacto" onclick="mostrar('${num}')">
        <div class="numero">+${num}</div>
        <div class="preview">
          ${ultimoMsg ? ultimoMsg.texto.substring(0, 50) : ""}
        </div>
        <div class="hora">${data.ultimaActividad || ""}</div>
      </div>
    `;
  }

  const datosJS = JSON.stringify(metaDatos).replace(/</g, "\\u003c");

  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>RR Photography Panel</title>

    <style>
      *{
        box-sizing:border-box;
        margin:0;
        padding:0;
      }

      body{
        font-family:sans-serif;
        background:#111;
        color:#eee;
        display:flex;
        height:100vh;
      }

      #lista{
        width:300px;
        background:#1a1a1a;
        overflow-y:auto;
        border-right:1px solid #333;
      }

      #lista h2{
        padding:16px;
        background:#25D366;
        color:white;
      }

      .contacto{
        padding:14px;
        border-bottom:1px solid #2a2a2a;
        cursor:pointer;
      }

      .contacto:hover{
        background:#252525;
      }

      .numero{
        font-weight:bold;
      }

      .preview{
        font-size:12px;
        color:#aaa;
        margin-top:4px;
      }

      .hora{
        font-size:11px;
        color:#666;
        margin-top:4px;
      }

      #chat{
        flex:1;
        display:flex;
        flex-direction:column;
      }

      #vacio{
        flex:1;
        display:flex;
        align-items:center;
        justify-content:center;
        color:#555;
      }

      #mensajes{
        flex:1;
        overflow-y:auto;
        padding:16px;
        display:flex;
        flex-direction:column;
        gap:10px;
      }

      .burbuja{
        max-width:70%;
        padding:10px 14px;
        border-radius:12px;
        line-height:1.5;
      }

      .cliente{
        background:#2a2a2a;
        align-self:flex-start;
      }

      .agente{
        background:#075E54;
        align-self:flex-end;
      }
    </style>
  </head>

  <body>

    <div id="lista">
      <h2>Conversaciones (${numeros.length})</h2>
      ${contactosHtml}
    </div>

    <div id="chat">
      <div id="vacio">Selecciona una conversacion</div>
    </div>

    <script>
      const datos = ${datosJS};

      function mostrar(num){
        const data = datos[num];

        const msgsHtml = data.mensajes.map(m =>
          '<div class="burbuja '+m.tipo+'">'+m.texto+'</div>'
        ).join("");

        document.getElementById("chat").innerHTML =
          '<div id="mensajes">'+msgsHtml+'</div>';
      }
    </script>

  </body>
  </html>
  `);
});

async function obtenerRespuestaIA(historial) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 180,
        temperature: 0.5,
        system: SYSTEM_PROMPT,
        messages: historial
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    );

    return response.data.content[0].text;

  } catch (error) {
    console.error(
      "Error Anthropic:",
      error.response?.data || error.message
    );

    return "Lo siento, tuve un problema tecnico.";
  }
}

async function enviarMensaje(to, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: texto
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    console.error(
      "Error enviando:",
      error.response?.data || error.message
    );
  }
}

async function notificarDueno(
  clientePhone,
  ultimoMensaje,
  historial
) {
  if (!OWNER_PHONE) return;

  const ultimos = historial
    .slice(-4)
    .map(m =>
      (m.role === "user" ? "Cliente: " : "Agente: ") + m.content
    )
    .join("\n");

  const notificacion =
    "Atencion requerida\n\n" +
    "Cliente: +" + clientePhone +
    "\n\n" +
    ultimos;

  await enviarMensaje(OWNER_PHONE, notificacion);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
