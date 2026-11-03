#!/usr/bin/env node
// Tiny stdio MCP server bundled with claudex. Exposes a single `ask_user` tool that
// bridges multiple-choice questions to the claudex chat UI: on a tool call it POSTs
// the questions to the claudex server, which holds the request open until the user
// answers in ChatView, then returns their selections as the tool result. Claude is
// spawned with this via --mcp-config; the server passes CX_* settings through env.
const http = require("http");
const ASK_URL = process.env.CX_ASK_URL || "";
const SLUG = process.env.CX_SLUG || "";
const TOKEN = process.env.CX_ASK_TOKEN || "";

let buf = "";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
process.stdin.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (line.trim()) { let m; try { m = JSON.parse(line); } catch { continue; } handle(m); }
  }
});

const TOOL = {
  name: "ask_user",
  description:
    "Ask the user one or more multiple-choice questions and wait for their selected answers. " +
    "Use this whenever you need the user to make a choice or decision between options instead of guessing. " +
    "Each question has a short header, the question text, and 2-4 options; set multiSelect:true to allow multiple picks.",
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "One or more questions to ask the user.",
        items: {
          type: "object",
          properties: {
            header: { type: "string", description: "Short (<=12 char) category label for the question." },
            question: { type: "string", description: "The question to ask." },
            multiSelect: { type: "boolean", description: "Allow selecting more than one option." },
            allowOther: { type: "boolean", description: "Let the user type their own free-text answer instead of picking a listed option." },
            options: {
              type: "array",
              description: "2-4 options to choose from.",
              items: {
                type: "object",
                properties: { label: { type: "string" }, description: { type: "string" } },
                required: ["label"],
              },
            },
          },
          required: ["question", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

function handle(m) {
  if (m.method === "initialize")
    send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "claudexask", version: "1.0.0" } } });
  else if (m.method === "tools/list")
    send({ jsonrpc: "2.0", id: m.id, result: { tools: [TOOL] } });
  else if (m.method === "tools/call") {
    if (m.params && m.params.name === "ask_user") askUser(m);
    else send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "unknown tool" }], isError: true } });
  } else if (m.method && m.method.startsWith("notifications/")) {
    /* no response to notifications */
  } else if (m.id !== undefined && m.method) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } });
  }
}

function askUser(m) {
  const questions = (m.params.arguments && m.params.arguments.questions) || [];
  let u; try { u = new URL(ASK_URL); } catch { return reply(m.id, "[ask bridge not configured]"); }
  const body = JSON.stringify({ slug: SLUG, questions });
  const req = http.request(
    { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-ask-token": TOKEN } },
    (res) => {
      let data = ""; res.on("data", (c) => (data += c));
      res.on("end", () => { let answers = [], note = ""; try { const p = JSON.parse(data); answers = p.answers || []; note = p.note || ""; } catch {} reply(m.id, formatAnswers(questions, answers, note)); });
    }
  );
  req.on("error", () => reply(m.id, "[the question could not be delivered to the user]"));
  req.write(body); req.end();
}

function formatAnswers(questions, answers, note) {
  note = note || "";
  answers = Array.isArray(answers) ? answers : [];
  const anySel = answers.some((a) => (Array.isArray(a) ? a.length : a != null));
  // Pure discussion: the user typed a reply in the chat instead of picking. Hand
  // Claude the message so it can respond and, if needed, ask again.
  if (note && !anySel) return "The user did not pick an option and replied instead: " + note;
  if (!questions.length) return note || "(no questions)";
  let out = questions
    .map((q, i) => {
      const a = answers[i];
      const sel = Array.isArray(a) ? a : a != null ? [a] : [];
      return (q.header || q.question || "Q" + (i + 1)) + ": " + (sel.length ? sel.join(", ") : "(no selection)");
    })
    .join("\n");
  if (note) out += "\n\nThe user also added: " + note;
  return out;
}

function reply(id, text) { send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } }); }
