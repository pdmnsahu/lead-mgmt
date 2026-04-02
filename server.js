require("dotenv").config();

const express = require("express");
const twilio = require("twilio");
const { pool, initDb } = require("./db");

const app = express();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function normalizePhone(phone) {
  if (!phone) return "";
  return phone.replace("whatsapp:", "").trim();
}

app.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        mc.id,
        mc.call_sid,
        mc.caller_phone,
        mc.dial_status,
        mc.called_at,
        mc.whatsapp_sent,
        b.name AS builder_name,
        COALESCE(wr.body, '') AS whatsapp_reply
      FROM missed_calls mc
      LEFT JOIN builders b ON b.id = mc.builder_id
      LEFT JOIN LATERAL (
        SELECT body
        FROM whatsapp_replies
        WHERE missed_call_id = mc.id
        ORDER BY received_at DESC
        LIMIT 1
      ) wr ON true
      ORDER BY mc.called_at DESC
      LIMIT 50
    `);

    const listHtml = rows.length
      ? rows.map((row) => `
          <div style="border:1px solid #ddd; border-radius:10px; padding:16px; margin-bottom:16px;">
            <div><strong>Caller:</strong> ${row.caller_phone}</div>
            <div><strong>Builder:</strong> ${row.builder_name || "Demo Builder"}</div>
            <div><strong>Status:</strong> ${row.dial_status}</div>
            <div><strong>Time:</strong> ${new Date(row.called_at).toLocaleString()}</div>
            <div><strong>WhatsApp sent:</strong> ${row.whatsapp_sent ? "Yes" : "No"}</div>
            <div><strong>Reply:</strong> ${row.whatsapp_reply || "No reply yet"}</div>
          </div>
        `).join("")
      : `<p>No leads yet.</p>`;

    res.send(`
      <html>
        <head>
          <title>Missed Call Lead Demo</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 16px;">
          <h1>Missed Call Lead Demo</h1>
          <p>Incoming missed calls and WhatsApp replies.</p>
          ${listHtml}
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).send("Dashboard error");
  }
});

app.get("/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      ok: true,
      dbTime: result.rows[0].now
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({ ok: false });
  }
});

app.post("/voice/incoming", (req, res) => {
  try {
    const caller = req.body.From;
    const callSid = req.body.CallSid;

    console.log("Incoming call webhook:", {
      caller,
      callSid,
      to: req.body.To
    });

    const twiml = new twilio.twiml.VoiceResponse();

    const dial = twiml.dial({
      action: `${process.env.BASE_URL}/voice/status`,
      method: "POST",
      timeout: 15,
      answerOnBridge: true,
      callerId: process.env.TWILIO_VOICE_NUMBER
    });

    dial.number(process.env.BUILDER_FORWARD_TO);

    res.type("text/xml").send(twiml.toString());
  } catch (error) {
    console.error("Voice incoming error:", error);
    res.status(500).send("Voice incoming error");
  }
});

app.post("/voice/status", async (req, res) => {
  const { CallSid, From, DialCallStatus } = req.body;

  console.log("Voice status webhook:", {
    CallSid,
    From,
    DialCallStatus
  });

  try {
    const insertResult = await pool.query(
      `
      INSERT INTO missed_calls (call_sid, caller_phone, builder_id, dial_status, whatsapp_sent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (call_sid)
      DO UPDATE SET dial_status = EXCLUDED.dial_status
      RETURNING id
      `,
      [CallSid, From, 1, DialCallStatus, false]
    );

    const missedCallId = insertResult.rows[0].id;
    const missedStatuses = ["no-answer", "busy", "failed"];

    if (missedStatuses.includes(DialCallStatus)) {
      try {
        await client.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_SANDBOX}`,
          to: `whatsapp:${From}`,
          body: "We missed your call. Please reply with your work requirement, location, and timeline."
        });

        await pool.query(
          `UPDATE missed_calls SET whatsapp_sent = true WHERE id = $1`,
          [missedCallId]
        );

        console.log("WhatsApp message sent to:", From);
      } catch (whatsAppError) {
        console.error("WhatsApp send error:", whatsAppError);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Voice status error:", error);
    res.status(500).send("Voice status error");
  }
});

app.post("/whatsapp/incoming", async (req, res) => {
  const from = normalizePhone(req.body.From);
  const body = (req.body.Body || "").trim();

  console.log("WhatsApp incoming webhook:", {
    from,
    body
  });

  try {
    const missedCallResult = await pool.query(
      `
      SELECT id
      FROM missed_calls
      WHERE caller_phone = $1
      ORDER BY called_at DESC
      LIMIT 1
      `,
      [from]
    );

    if (missedCallResult.rows.length > 0 && body) {
      const missedCallId = missedCallResult.rows[0].id;

      await pool.query(
        `
        INSERT INTO whatsapp_replies (missed_call_id, from_phone, body)
        VALUES ($1, $2, $3)
        `,
        [missedCallId, from, body]
      );
    }

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Thanks! Your enquiry has been captured.");

    res.type("text/xml").send(twiml.toString());
  } catch (error) {
    console.error("WhatsApp incoming error:", error);
    res.status(500).send("WhatsApp incoming error");
  }
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(async () => {
    const result = await pool.query("SELECT NOW()");
    console.log("Database connected:", result.rows[0].now);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Base URL: ${process.env.BASE_URL}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });