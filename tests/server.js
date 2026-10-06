const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let lastRequest;
let apiStatus = 200;
let apiBody = {
  choices: [{ message: { content: JSON.stringify({
    sentence_translation: "Она сняла пальто.",
    words: [
          { text: "coat", meaning: "пальто" },
          { text: "took off", meaning: "сняла (одежду)" }
    ]
  }) } }]
};

const server = http.createServer((request, response) => {
  if (request.url === "/__test/chrome-mock.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" }).end(`
      (() => {
        const values = { settings: {}, pendingSelection: "She took off her coat." };
        const listeners = [];
        window.chrome = { storage: {
          local: {
            get: async (key) => ({ [key]: values[key] }),
            set: async (next) => { Object.assign(values, next); listeners.forEach((listener) => listener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue } ])), "local")); },
            remove: async (key) => { delete values[key]; }
          },
          onChanged: { addListener: (listener) => listeners.push(listener) }
        }};
      })();
    `);
    return;
  }
  if (request.url === "/__test/reset" && request.method === "POST") {
    lastRequest = undefined;
    apiStatus = 200;
    apiBody = {
      choices: [{ message: { content: JSON.stringify({
        sentence_translation: "Она сняла пальто.",
        words: [
          { text: "coat", meaning: "пальто" },
          { text: "took off", meaning: "сняла (одежду)" }
        ]
      }) } }]
    };
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/__test/last-request") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(lastRequest ?? null));
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
      response.writeHead(apiStatus, { "Content-Type": "application/json" }).end(JSON.stringify(apiBody));
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
