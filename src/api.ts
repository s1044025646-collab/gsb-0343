import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { Store } from "./db";
import { SecdedError, decode, encode, flip, layout, MAX_BATCH } from "./secded";

const DATA_DIR = process.env.SECDED_DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(DATA_DIR, "secded.db"));
process.on("exit", () => { try { store.close(); } catch { /* 忽略 */ } });

type Handler = (body: any, params: Record<string, string>) => unknown;

const routes: Record<string, Record<string, Handler>> = {
  "GET /api/layout": { "": () => layout() },
  "POST /api/encode": { "": (b) => ({ data: b?.data, codeword: encode(b?.data) }) },
  "POST /api/decode": { "": (b) => decode(b?.codeword, b?.ruleVersion) },
  "POST /api/verify": { "": (b) => store.verifyStandalone(b?.codeword) },
  "POST /api/flip": { "": (b) => ({ received: flip(b?.codeword, b?.positions) }) },
  "POST /api/experiments": { "": (b) => store.createExperiment(b?.data) },
  "GET /api/experiments": { "": () => store.listExperiments() },
  "GET /api/experiments/:id": {
    "": (_b, p) => store.getExperiment(Number(p.id)),
  },
  "POST /api/experiments/:id/inject": {
    "": (b, p) => store.injectAndDecode(Number(p.id), b?.positions),
  },
  "GET /api/reports": { "": () => store.listStandaloneReports() },
};

function match(method: string, url: string): { h: Handler; params: Record<string, string> } | null {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const pp = pattern.split("/");
    const up = url.split("/");
    if (pp.length !== up.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(up[i]);
      else if (pp[i] !== up[i]) { ok = false; break; }
    }
    if (ok) return { h: routes[key][""], params };
  }
  return null;
}

export async function findFreePort(preferred: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(port)));
    });
  if (preferred > 0) {
    try { return await tryPort(preferred); } catch { /* 占用则选空闲端口 */ }
  }
  return tryPort(0);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const m = match(req.method ?? "GET", url);
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    if (!m) return send(404, { error: { code: "NOT_FOUND", message: "路由不存在" } });
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = m.h(parsed, m.params);
        send(200, { ok: true, result });
      } catch (e) {
        if (e instanceof SecdedError) send(400, { error: { code: e.code, message: e.message } });
        else if (e instanceof SyntaxError) send(400, { error: { code: "BAD_JSON", message: "请求体不是合法 JSON" } });
        else send(500, { error: { code: "INTERNAL", message: String(e) } });
      }
    });
  });
}

if (require.main === module) {
  const preferred = Number(process.env.PORT ?? 8080);
  findFreePort(preferred).then((port) => {
    createServer().listen(port, "127.0.0.1", () => {
      console.log(`SECDED API 已启动: http://127.0.0.1:${port} (数据目录: ${DATA_DIR}, 批量上限 ${MAX_BATCH})`);
    });
  });
}
