const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("../scripts/prepare-vendor.js");

const root = path.resolve(__dirname, "..");
let lastRequest;
let apiRequests = [];
let apiStatus = 200;
const createTranslationResponse = () => ({
  choices: [{ message: { content: JSON.stringify({
    sentence_translation: "Она сняла пальто и надела пальто.",
    words: [
      { text: "coat", lemma: "coat", meaning: "пальто, которое она надела", examples: ["He wore a warm coat.", "Hang your coat by the door."], start: 35, end: 39 },
      { text: "took off", lemma: "take off", meaning: "сняла (одежду)", examples: ["She took off her shoes.", "Take off your jacket."], start: 4, end: 12 },
      { text: "coat", lemma: "coat", meaning: "пальто, которое она сняла", examples: ["She bought a new coat.", "His coat was covered in snow."], start: 17, end: 21 }
    ]
  }) } }]
});
let apiBody = createTranslationResponse();

const server = http.createServer((request, response) => {
  if (request.url === "/__test/chrome-mock.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" }).end(`
      (() => {
        const values = JSON.parse(localStorage.getItem("lexideck-test-storage") || '{"settings":{},"pendingSelection":"She took off her coat and wore her coat."}');
        const sessionValues = {};
        const listeners = [];
        window.__chromeValues = values;
        window.chrome = { storage: {
          local: {
            get: async (key) => { Object.assign(values, JSON.parse(localStorage.getItem("lexideck-test-storage") || "{}")); return structuredClone({ [key]: values[key] }); },
            set: async (next) => { Object.assign(values, JSON.parse(localStorage.getItem("lexideck-test-storage") || "{}"), structuredClone(next)); localStorage.setItem("lexideck-test-storage", JSON.stringify(values)); listeners.forEach((listener) => listener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue } ])), "local")); },
            remove: async (key) => { Object.assign(values, JSON.parse(localStorage.getItem("lexideck-test-storage") || "{}")); delete values[key]; localStorage.setItem("lexideck-test-storage", JSON.stringify(values)); }
          },
          session: {
            get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, sessionValues[key]])),
            set: async (next) => {
              Object.assign(sessionValues, next);
              listeners.forEach((listener) => listener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), "session"));
            },
            remove: async (key) => { delete sessionValues[key]; }
          },
          onChanged: { addListener: (listener) => listeners.push(listener) }
        }};
      })();
    `);
    return;
  }
  if (request.url === "/__test/reset" && request.method === "POST") {
    lastRequest = undefined;
    apiRequests = [];
    apiStatus = 200;
    apiBody = createTranslationResponse();
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/__test/last-request") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(lastRequest ?? null));
    return;
  }
  if (request.url === "/__test/requests") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(apiRequests));
    return;
  }
  if (request.url === "/__test/error" && request.method === "POST") {
    apiStatus = 401;
    apiBody = { error: { message: "invalid api key" } };
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      lastRequest = { headers: request.headers, body: JSON.parse(raw) };
      apiRequests.push(lastRequest);
      const isVision = Array.isArray(lastRequest.body.messages?.[1]?.content);
      const isExpressionExamples = lastRequest.body.messages?.[0]?.content.includes("Сгенерируй два дополнительных примера");
      const body = isVision
        ? { choices: [{ message: { content: JSON.stringify({ dialogues: ["She took of her coat and wore her coat."] }) } }] }
        : isExpressionExamples
          ? { choices: [{ message: { content: JSON.stringify({ examples: ["She finally let the cat out of the bag.", "He let the cat out of the bag by accident."] }) } }] }
          : apiBody;
      response.writeHead(apiStatus, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
    return;
  }

  const requested = request.url === "/" ? "/src/panel.html" : request.url;
  const filePath = path.resolve(root, `.${decodeURIComponent(requested)}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) return response.writeHead(404).end("Not found");
    const mime = filePath.endsWith(".js") ? "text/javascript" : filePath.endsWith(".css") ? "text/css" : "text/html";
    let html = contents;
    if (filePath.endsWith("panel.html")) {
      html = contents.toString().replace('<script type="module" src="panel.js"></script>', '<script src="/__test/chrome-mock.js"></script><script type="module" src="panel.js"></script>');
    }
    response.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` }).end(html);
  });
});

server.listen(Number(process.env.PORT || 4173), "127.0.0.1");

module.exports = server;
