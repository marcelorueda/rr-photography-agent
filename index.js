const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

/* =========================
   VARIABLES
========================= */

const VERIFY_TOKEN =
  process.env.VERIFY_TOKEN || "rr_photography_token";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE;

const PANEL_PASSWORD =
  process.env.PANEL_PASSWORD || "rr2024";

/* =========================
   MEMORIA
========================= */

const conversaciones = {};
const metaDatos = {};
const crm = {};
const memoriaIA = {};

const MAX_HISTORY = 4;

/* =========================
   PROMPT IA
========================= */

const SYSTEM_PROMPT = `
Eres Roro, asistente virtual de RR Photography.

Tu personalidad:
- Profesional
- Natural
- Conversacional
- Breve
- Sin emojis
- Maximo 3 oraciones
- NO vuelvas a saludar si ya existe conversacion

IMPORTANTE:
- Nunca preguntes otra vez datos ya conocidos
- Si ya sabes el tipo de evento NO lo vuelvas a preguntar
- Usa la informacion del CRM antes de responder
- Responde corto para ahorrar tiempo al cliente

NEGOCIO:
Fotografia para eventos en San Luis Potosi y Matehuala.

PAQUETES:

Digital $2350
- 50 fotos digitales editadas
- Entrega WhatsApp
- USB opcional +350

Impresiones $3400
- 50 fotos digitales
- 20 impresiones 6x8

Memorable $4500
- 50 fotos digitales editadas
- Album personalizado
- Poster 10x15
- USB incluido

Album Express $1150
- 14 fotos en album fisico
- Fotos digitales opcionales +450

EXTRAS:
- USB personalizado +350
- Album adicional +1150

PAGOS:
- 50% anticipo
- Efectivo
- Transferencia
- Tarjeta

TRANSFERENCIA:
Banco Nu Mexico
CLABE 638180010168846336

NO ofrecer descuentos.
SI adaptar paquetes al presupuesto.

TRANSFERIR_DUENO si:
- quieren hablar con persona
- confirmar disponibilidad
- cerrar contrato
- tienen dudas complejas
- existe conflicto

Cuando transfieras agrega:
TRANSFERIR_DUENO
`;

/* =========================
   RESPUESTAS RAPIDAS
========================= */

const RESPUESTAS = {
  saludo:
    "Hola, soy Roro de RR Photography. ¿Que tipo de evento tendras?",

  precios:
    "Manejamos paquetes desde $1150 hasta $4500. ¿Que tipo de evento buscas cubrir?",

  pagos:
    "Aceptamos efectivo, transferencia y tarjeta. Para apartar fecha se requiere 50% de anticipo.",

  ubicacion:
    "Trabajamos en San Luis Potosi y Matehuala.",

  gracias:
    "Con gusto. Quedo atento a cualquier duda."
};

/* =========================
   WEBHOOK VERIFY
========================= */

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

/* =========================
   WEBHOOK MENSAJES
========================= */

app.post("/webhook", async (req, res) => {

  res.sendStatus(200);

  try {

    const body = req.body;

    if (!body.object) return;

    const messages =
      body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (!messages || messages.length === 0) {
      return;
    }

    const message = messages[0];

    const from = message.from;
    const messageType = message.type;

    let textoCliente = "";

    /* =========================
       EXTRAER TEXTO
    ========================= */

    if (messageType === "text") {

      textoCliente =
        message.text.body.trim();

    } else if (messageType === "interactive") {

      textoCliente =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";

    } else {

      await enviarMensaje(
        from,
        "Por ahora solo puedo responder mensajes de texto."
      );

      return;
    }

    const textoLower =
      textoCliente.toLowerCase();

    /* =========================
       CREAR CRM
    ========================= */

    if (!crm[from]) {

      crm[from] = {
        nombre: "",
        evento: "",
        fecha: "",
        paquete: "",
        etapa: "nuevo"
      };
    }

    /* =========================
       MEMORIA IA
    ========================= */

    if (!memoriaIA[from]) {

      memoriaIA[from] = {
        resumen: ""
      };
    }

    /* =========================
       HISTORIAL
    ========================= */

    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    if (!metaDatos[from]) {

      metaDatos[from] = {
        mensajes: [],
        ultimaActividad: null
      };
    }

    /* =========================
       GUARDAR MENSAJE
    ========================= */

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

    /* =========================
       LIMITAR HISTORIAL
    ========================= */

    if (
      conversaciones[from].length >
      MAX_HISTORY
    ) {

      conversaciones[from] =
        conversaciones[from].slice(
          -MAX_HISTORY
        );
    }

    /* =========================
       MENSAJES MUY CORTOS
    ========================= */

    const mensajesSimples = [
      "ok",
      "va",
      "sale",
      "perfecto",
      "gracias",
      "jaja",
      "👍"
    ];

    if (
      mensajesSimples.includes(textoLower)
    ) {

      await enviarMensaje(
        from,
        "Perfecto."
      );

      return;
    }

    /* =========================
       SALUDO
    ========================= */

    const esPrimerMensaje =
      conversaciones[from].length <= 1;

    if (
      esPrimerMensaje &&
      (
        textoLower.includes("hola") ||
        textoLower.includes("buenas") ||
        textoLower.includes("informes")
      )
    ) {

      await enviarMensaje(
        from,
        RESPUESTAS.saludo
      );

      return;
    }

    /* =========================
       RESPUESTAS RAPIDAS
    ========================= */

    if (
      textoLower.includes("precio") ||
      textoLower.includes("costos") ||
      textoLower.includes("cuanto")
    ) {

      await enviarMensaje(
        from,
        RESPUESTAS.precios
      );

      return;
    }

    if (
      textoLower.includes("pago") ||
      textoLower.includes("transferencia")
    ) {

      await enviarMensaje(
        from,
        RESPUESTAS.pagos
      );

      return;
    }

    if (
      textoLower.includes("ubicacion") ||
      textoLower.includes("donde")
    ) {

      await enviarMensaje(
        from,
        RESPUESTAS.ubicacion
      );

      return;
    }

    /* =========================
       DETECTAR NOMBRE
    ========================= */

    const regexNombre =
      /me llamo (.+)|soy (.+)/i;

    const nombreMatch =
      textoCliente.match(regexNombre);

    if (nombreMatch) {

      crm[from].nombre =
        nombreMatch[1] ||
        nombreMatch[2];
    }

    /* =========================
       DETECTAR EVENTO
    ========================= */

    if (
      textoLower.includes("boda")
    ) {
      crm[from].evento = "Boda";
    }

    if (
      textoLower.includes("xv") ||
      textoLower.includes("quince")
    ) {
      crm[from].evento = "XV años";
    }

    if (
      textoLower.includes("graduacion")
    ) {
      crm[from].evento = "Graduacion";
    }

    if (
      textoLower.includes("infantil")
    ) {
      crm[from].evento = "Infantil";
    }

    /* =========================
       DETECTAR PAQUETE
    ========================= */

    if (
      textoLower.includes("digital")
    ) {
      crm[from].paquete = "Digital";
    }

    if (
      textoLower.includes("impresiones")
    ) {
      crm[from].paquete = "Impresiones";
    }

    if (
      textoLower.includes("memorable")
    ) {
      crm[from].paquete = "Memorable";
    }

    if (
      textoLower.includes("album express")
    ) {
      crm[from].paquete =
        "Album Express";
    }

    /* =========================
       ETAPAS
    ========================= */

    if (
      textoLower.includes("precio") ||
      textoLower.includes("cotizacion")
    ) {
      crm[from].etapa =
        "cotizacion";
    }

    if (
      textoLower.includes("anticipo") ||
      textoLower.includes("apartar")
    ) {
      crm[from].etapa =
        "anticipo";
    }

    if (
      textoLower.includes("reservar") ||
      textoLower.includes("agendar")
    ) {
      crm[from].etapa =
        "cierre";
    }

    /* =========================
       RESUMEN IA
    ========================= */

    memoriaIA[from].resumen = `
Nombre: ${crm[from].nombre || "-"}
Evento: ${crm[from].evento || "-"}
Paquete: ${crm[from].paquete || "-"}
Etapa: ${crm[from].etapa || "-"}
`;

    /* =========================
       CONTEXTO IA
    ========================= */

    const contextoSistema = `
INFORMACION DEL CLIENTE

${memoriaIA[from].resumen}

INSTRUCCIONES:
- NO preguntes datos ya definidos
- Usa memoria previa
- Se breve
`;

    const historialIA = [
      {
        role: "user",
        content: contextoSistema
      },
      ...conversaciones[from]
    ];

    /* =========================
       IA
    ========================= */

    const respuestaCompleta =
      await obtenerRespuestaIA(
        historialIA
      );

    const necesitaTransferir =
      respuestaCompleta.includes(
        "TRANSFERIR_DUENO"
      );

    const respuestaLimpia =
      respuestaCompleta
        .replace(
          "TRANSFERIR_DUENO",
          ""
        )
        .trim();

    /* =========================
       ENVIAR RESPUESTA
    ========================= */

    await enviarMensaje(
      from,
      respuestaLimpia
    );

    conversaciones[from].push({
      role: "assistant",
      content: respuestaLimpia
    });

    metaDatos[from].mensajes.push({
      tipo: "agente",
      texto: respuestaLimpia,
      hora: new Date().toLocaleString(
        "es-MX"
      )
    });

    /* =========================
       TRANSFERIR
    ========================= */

    if (necesitaTransferir) {

      await notificarDueno(
        from,
        crm[from],
        conversaciones[from]
      );
    }

  } catch (error) {

    console.error(
      "Error:",
      error.response?.data ||
      error.message
    );
  }
});

/* =========================
   PANEL CRM
========================= */

app.get("/panel", (req, res) => {

  const pass = req.query.pass;

  if (pass !== PANEL_PASSWORD) {

    return res.send(`
      <html>
      <body style="font-family:sans-serif;padding:40px;background:#111;color:white">
        <h2>RR Photography CRM</h2>

        <form>
          <input
            name="pass"
            type="password"
            placeholder="Contraseña"
            style="padding:10px;font-size:16px"
          />

          <button
            type="submit"
            style="padding:10px 20px;margin-left:10px;background:#25D366;color:white;border:none"
          >
            Entrar
          </button>
        </form>
      </body>
      </html>
    `);
  }

  res.send("CRM funcionando");
});

/* =========================
   CLAUDE
========================= */

async function obtenerRespuestaIA(
  historial
) {

  try {

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model:
          "claude-haiku-4-5-20251001",

        max_tokens: 180,

        temperature: 0.5,

        system: SYSTEM_PROMPT,

        messages: historial
      },
      {
        headers: {
          "x-api-key":
            ANTHROPIC_API_KEY,

          "anthropic-version":
            "2023-06-01",

          "content-type":
            "application/json"
        }
      }
    );

    return response.data
      .content[0].text;

  } catch (error) {

    console.error(
      "Error Anthropic:",
      error.response?.data ||
      error.message
    );

    return "Lo siento, tuve un problema tecnico.";
  }
}

/* =========================
   WHATSAPP
========================= */

async function enviarMensaje(
  to,
  texto
) {

  try {

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product:
          "whatsapp",

        to: to,

        type: "text",

        text: {
          body: texto
        }
      },
      {
        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"
        }
      }
    );

  } catch (error) {

    console.error(
      "Error enviando:",
      error.response?.data ||
      error.message
    );
  }
}

/* =========================
   NOTIFICAR DUEÑO
========================= */

async function notificarDueno(
  clientePhone,
  clienteCRM,
  historial
) {

  if (!OWNER_PHONE) return;

  const ultimos = historial
    .slice(-4)
    .map(m =>
      (m.role === "user"
        ? "Cliente: "
        : "Agente: ") +
      m.content
    )
    .join("\n");

  const notificacion = `
Atencion requerida

Cliente: +${clientePhone}

Nombre:
${clienteCRM.nombre || "-"}

Evento:
${clienteCRM.evento || "-"}

Paquete:
${clienteCRM.paquete || "-"}

Etapa:
${clienteCRM.etapa || "-"}

Ultimos mensajes:
${ultimos}
`;

  await enviarMensaje(
    OWNER_PHONE,
    notificacion
  );
}

/* =========================
   SERVER
========================= */

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    "Servidor corriendo en puerto " +
    PORT
  );
});
