const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// â”€â”€â”€ CONFIGURACIÃ“N â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rr_photography_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;   // Token de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ID del nÃºmero en Meta
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE; // Tu nÃºmero con cÃ³digo de paÃ­s, ej: 5214441362176

// â”€â”€â”€ MEMORIA DE CONVERSACIONES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Guarda el historial de cada cliente para que el agente recuerde el contexto
const conversaciones = {};

// â”€â”€â”€ PERSONALIDAD Y CONOCIMIENTO DEL AGENTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SYSTEM_PROMPT = `Eres el asistente virtual de RR Photography, un negocio de fotografÃ­a para eventos en San Luis PotosÃ­ y Matehuala, MÃ©xico. Tu lema es "Del momento al recuerdo".

Tu nombre es "Roro" y representas a la empresa con un tono amable, profesional y cÃ¡lido.

## PAQUETES FOTOGRÃFICOS

### Paquete Digital â€” $2,350 MXN
- 50 fotos digitales editadas
- Entrega por WhatsApp
- Opcion USB personalizado (+$350)
- Ideal para eventos pequeÃ±os

### Paquete Impresiones â€” $3,400 MXN
- 50 fotografias digitales
- 20 fotografias impresas en tamaÃ±o 6x8"
- Opcion de incluir USB (+$350)

### Paquete Memorable â€” $4,500 MXN
- 16 fotos en album personalizado
- 15 impresiones 6x8
- 1 impresion 10x15 (poster)
- Entrega en USB

### EXTRAS
- USB personalizado: $350
- Ãlbum adicional: desde $1,200

## INFORMACIÃ“N DEL NEGOCIO
- Cobertura: San Luis PotosÃ­ y Matehuala
- Tipos de eventos: infantiles, XV aÃ±os, bodas, corporativos, graduaciones, y todo tipo de eventos
- AnticipaciÃ³n mÃ­nima: 1 dÃ­a (aunque se recomienda reservar con mÃ¡s tiempo)
- Formas de pago: Efectivo, transferencia bancaria y tarjeta
- Anticipo: 50% para confirmar la reserva, el resto el dÃ­a del evento

## POLÃTICA DE NEGOCIACIÃ“N
- NO puedes ofrecer descuentos en los precios establecidos
- SÃ puedes ajustar el trabajo proporcionalmente al presupuesto del cliente. Por ejemplo: si el cliente tiene menos presupuesto, puedes ofrecer menos fotos o menos impresiones
- Puedes combinar elementos de diferentes paquetes para adaptarte al presupuesto

## DATOS DE PAGO
Cuando el cliente confirme que quiere apartar la fecha y pagar el anticipo por transferencia, proporciona estos datos:
- Banco: Nu Mexico
- CLABE interbancaria: 638180010168846336
- Monto: 50% del paquete elegido

## REDES SOCIALES
- Instagram: @rr_photography_ig
- IMPORTANTE: Solo comparte el Instagram si el cliente lo pide explicitamente. No lo menciones proactivamente.

## PROCESO DE CONTRATACIÃ“N
Cuando el cliente quiera contratar:
1. Confirma fecha, lugar y tipo de evento
2. Confirma el paquete elegido
3. Informa que se requiere 50% de anticipo para apartar la fecha
4. Pregunta si pagara en efectivo, tarjeta o transferencia
5. Si elige transferencia, proporciona la CLABE interbancaria
6. Una vez que el cliente confirme el pago, dile que el dueÃ±o lo contactarÃ¡ para finalizar los detalles del contrato

## CUÃNDO TRANSFERIR AL DUEÃ‘O
Transfiere la conversaciÃ³n al dueÃ±o (Marce) en estos casos:
- El cliente pregunta algo muy especÃ­fico que no estÃ¡ en tu informaciÃ³n
- Hay un conflicto o queja que no puedes resolver
- El cliente insiste en hablar con una persona
- Necesitas confirmar disponibilidad de fecha especÃ­fica
- El cliente quiere cerrar el contrato formalmente

Cuando necesites transferir, responde al cliente que lo comunicarÃ¡s con Marce y termina tu mensaje con la etiqueta exacta: [TRANSFERIR_AL_DUEÃ‘O]

## REGLAS GENERALES
- Responde siempre en espaÃ±ol
- SÃ© amable, profesional y entusiasta sobre la fotografÃ­a
- Si no sabes algo, sÃ© honesto y ofrece transferir con el dueÃ±o
- MantÃ©n las respuestas concisas pero completas
- Usa emojis con moderaciÃ³n para dar calidez`;

// â”€â”€â”€ VERIFICACIÃ“N DEL WEBHOOK (Meta lo llama una vez para verificar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("âœ… Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// â”€â”€â”€ RECIBIR MENSAJES DE WHATSAPP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rÃ¡pido a Meta

  try {
    const body = req.body;
    if (!body.object) return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    const message = messages[0];
    const from = message.from; // NÃºmero del cliente
    const messageType = message.type;

    let textoCliente = "";

    if (messageType === "text") {
      textoCliente = message.text.body;
    } else if (messageType === "interactive") {
      textoCliente = message.interactive?.button_reply?.title ||
                     message.interactive?.list_reply?.title || "";
    } else {
      // Para mensajes de voz, imÃ¡genes, etc.
      await enviarMensaje(from, "Hola ðŸ˜Š Por el momento solo puedo responder mensajes de texto. Â¿En quÃ© te puedo ayudar?");
      return;
    }

    console.log(`ðŸ“© Mensaje de ${from}: ${textoCliente}`);

    // Inicializar historial si es la primera vez
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    // Agregar mensaje del cliente al historial
    conversaciones[from].push({
      role: "user",
      content: textoCliente
    });

    // Limitar historial a Ãºltimos 20 mensajes para no exceder tokens
    if (conversaciones[from].length > 20) {
      conversaciones[from] = conversaciones[from].slice(-20);
    }

    // Obtener respuesta del agente IA
    const respuesta = await obtenerRespuestaIA(conversaciones[from]);

    // Verificar si hay que transferir al dueÃ±o
    if (respuesta.includes("[TRANSFERIR_AL_DUEÃ‘O]")) {
      const respuestaLimpia = respuesta.replace("[TRANSFERIR_AL_DUEÃ‘O]", "").trim();
      await enviarMensaje(from, respuestaLimpia);
      await notificarDueno(from, textoCliente, conversaciones[from]);
    } else {
      await enviarMensaje(from, respuesta);
    }

    // Agregar respuesta del agente al historial
    conversaciones[from].push({
      role: "assistant",
      content: respuesta.replace("[TRANSFERIR_AL_DUEÃ‘O]", "").trim()
    });

  } catch (error) {
    console.error("âŒ Error procesando mensaje:", error.message);
  }
});

// â”€â”€â”€ LLAMAR A CLAUDE (ANTHROPIC) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function obtenerRespuestaIA(historial) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5",
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
    console.error("âŒ Error con Anthropic:", error.response?.data || error.message);
    return "Lo siento, tuve un problema tÃ©cnico. Por favor intenta de nuevo en un momento ðŸ™";
  }
}

// â”€â”€â”€ ENVIAR MENSAJE A WHATSAPP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    console.log(`âœ… Mensaje enviado a ${to}`);
  } catch (error) {
    console.error("âŒ Error enviando mensaje:", error.response?.data || error.message);
  }
}

// â”€â”€â”€ NOTIFICAR AL DUEÃ‘O CUANDO SE REQUIERE INTERVENCIÃ“N â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function notificarDueno(clientePhone, ultimoMensaje, historial) {
  if (!OWNER_PHONE) return;

  const resumen = historial
    .slice(-6) // Ãšltimos 3 intercambios
    .map(m => `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content}`)
    .join("\n");

  const notificacion = `ðŸš¨ *AtenciÃ³n requerida*\n\nUn cliente necesita tu atenciÃ³n personal.\n\n*NÃºmero del cliente:* ${clientePhone}\n\n*Ãšltimos mensajes:*\n${resumen}\n\n_Por favor contÃ¡ctalo directamente._`;

  await enviarMensaje(OWNER_PHONE, notificacion);
}

// â”€â”€â”€ INICIAR SERVIDOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ðŸš€ Servidor RR Photography corriendo en puerto ${PORT}`);
  console.log(`ðŸ“¡ Webhook URL: https://TU-DOMINIO/webhook`);
});
