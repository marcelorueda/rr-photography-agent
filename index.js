const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ──────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rr_photography_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;   // Token de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ID del número en Meta
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE; // Tu número con código de país, ej: 5214441362176

// ─── MEMORIA DE CONVERSACIONES ──────────────────────────────────────────────
// Guarda el historial de cada cliente para que el agente recuerde el contexto
const conversaciones = {};

// ─── PERSONALIDAD Y CONOCIMIENTO DEL AGENTE ─────────────────────────────────
const SYSTEM_PROMPT = `Eres el asistente virtual de RR Photography, un negocio de fotografía para eventos en San Luis Potosí y Matehuala, México. Tu lema es "Del momento al recuerdo".

Tu nombre es "Roro" y representas a la empresa con un tono amable, profesional y cálido.

## PAQUETES FOTOGRÁFICOS

### 📸 Paquete Digital — $2,350 MXN
- 50 fotos digitales editadas
- Entrega por WhatsApp
- Opción USB personalizado (+$350)
- Ideal para eventos pequeños

### 🖼️ Paquete Impresiones — $3,400 MXN
- 50 fotografías digitales
- 20 fotografías impresas en tamaño 6x8"
- Opción de incluir USB (+$350)

### 🎁 Paquete Memorable — $4,500 MXN
- 16 fotos en álbum personalizado
- 15 impresiones 6x8
- 2 impresiones 10x15
- Entrega en USB

### EXTRAS
- USB personalizado: $350
- Álbum adicional: desde $1,200

## INFORMACIÓN DEL NEGOCIO
- Cobertura: San Luis Potosí y Matehuala
- Tipos de eventos: infantiles, XV años, bodas, corporativos, graduaciones, y todo tipo de eventos
- Anticipación mínima: 1 día (aunque se recomienda reservar con más tiempo)
- Formas de pago: Efectivo, transferencia bancaria y tarjeta
- Anticipo: 50% para confirmar la reserva, el resto el día del evento

## POLÍTICA DE NEGOCIACIÓN
- NO puedes ofrecer descuentos en los precios establecidos
- SÍ puedes ajustar el trabajo proporcionalmente al presupuesto del cliente. Por ejemplo: si el cliente tiene menos presupuesto, puedes ofrecer menos fotos o menos impresiones
- Puedes combinar elementos de diferentes paquetes para adaptarte al presupuesto

## PROCESO DE CONTRATACIÓN
Cuando el cliente quiera contratar:
1. Confirma fecha, lugar y tipo de evento
2. Confirma el paquete elegido
3. Informa que se requiere 50% de anticipo para apartar la fecha
4. Indica las formas de pago disponibles
5. Una vez que el cliente confirme todo, dile que el dueño lo contactará para finalizar los detalles del contrato

## CUÁNDO TRANSFERIR AL DUEÑO
Transfiere la conversación al dueño (Marce) en estos casos:
- El cliente pregunta algo muy específico que no está en tu información
- Hay un conflicto o queja que no puedes resolver
- El cliente insiste en hablar con una persona
- Necesitas confirmar disponibilidad de fecha específica
- El cliente quiere cerrar el contrato formalmente

Cuando necesites transferir, responde al cliente que lo comunicarás con Marce y termina tu mensaje con la etiqueta exacta: [TRANSFERIR_AL_DUEÑO]

## REGLAS GENERALES
- Responde siempre en español
- Sé amable, profesional y entusiasta sobre la fotografía
- Si no sabes algo, sé honesto y ofrece transferir con el dueño
- Mantén las respuestas concisas pero completas
- Usa emojis con moderación para dar calidez`;

// ─── VERIFICACIÓN DEL WEBHOOK (Meta lo llama una vez para verificar) ──────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── RECIBIR MENSAJES DE WHATSAPP ────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const body = req.body;
    if (!body.object) return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    const message = messages[0];
    const from = message.from; // Número del cliente
    const messageType = message.type;

    let textoCliente = "";

    if (messageType === "text") {
      textoCliente = message.text.body;
    } else if (messageType === "interactive") {
      textoCliente = message.interactive?.button_reply?.title ||
                     message.interactive?.list_reply?.title || "";
    } else {
      // Para mensajes de voz, imágenes, etc.
      await enviarMensaje(from, "Hola 😊 Por el momento solo puedo responder mensajes de texto. ¿En qué te puedo ayudar?");
      return;
    }

    console.log(`📩 Mensaje de ${from}: ${textoCliente}`);

    // Inicializar historial si es la primera vez
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    // Agregar mensaje del cliente al historial
    conversaciones[from].push({
      role: "user",
      content: textoCliente
    });

    // Limitar historial a últimos 20 mensajes para no exceder tokens
    if (conversaciones[from].length > 20) {
      conversaciones[from] = conversaciones[from].slice(-20);
    }

    // Obtener respuesta del agente IA
    const respuesta = await obtenerRespuestaIA(conversaciones[from]);

    // Verificar si hay que transferir al dueño
    if (respuesta.includes("[TRANSFERIR_AL_DUEÑO]")) {
      const respuestaLimpia = respuesta.replace("[TRANSFERIR_AL_DUEÑO]", "").trim();
      await enviarMensaje(from, respuestaLimpia);
      await notificarDueno(from, textoCliente, conversaciones[from]);
    } else {
      await enviarMensaje(from, respuesta);
    }

    // Agregar respuesta del agente al historial
    conversaciones[from].push({
      role: "assistant",
      content: respuesta.replace("[TRANSFERIR_AL_DUEÑO]", "").trim()
    });

  } catch (error) {
    console.error("❌ Error procesando mensaje:", error.message);
  }
});

// ─── LLAMAR A CLAUDE (ANTHROPIC) ─────────────────────────────────────────────
async function obtenerRespuestaIA(historial) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
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
    console.error("❌ Error con Anthropic:", error.response?.data || error.message);
    return "Lo siento, tuve un problema técnico. Por favor intenta de nuevo en un momento 🙏";
  }
}

// ─── ENVIAR MENSAJE A WHATSAPP ────────────────────────────────────────────────
async function enviarMensaje(to, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: texto }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`✅ Mensaje enviado a ${to}`);
  } catch (error) {
    console.error("❌ Error enviando mensaje:", error.response?.data || error.message);
  }
}

// ─── NOTIFICAR AL DUEÑO CUANDO SE REQUIERE INTERVENCIÓN ──────────────────────
async function notificarDueno(clientePhone, ultimoMensaje, historial) {
  if (!OWNER_PHONE) return;

  const resumen = historial
    .slice(-6) // Últimos 3 intercambios
    .map(m => `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content}`)
    .join("\n");

  const notificacion = `🚨 *Atención requerida*\n\nUn cliente necesita tu atención personal.\n\n*Número del cliente:* ${clientePhone}\n\n*Últimos mensajes:*\n${resumen}\n\n_Por favor contáctalo directamente._`;

  await enviarMensaje(OWNER_PHONE, notificacion);
}

// ─── INICIAR SERVIDOR ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor RR Photography corriendo en puerto ${PORT}`);
  console.log(`📡 Webhook URL: https://TU-DOMINIO/webhook`);
});
