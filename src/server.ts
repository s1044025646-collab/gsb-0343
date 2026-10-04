import * as http from "node:http";
import * as net from "node:net";
import { Service } from "./service.js";
import { SecdedError } from "./secded.js";

function json(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(s);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new SecdedError("ERR_BAD_JSON", "请求体必须是合法 JSON"); }
}

export function createServer(service: Service) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      const body = req.method === "POST" ? await readBody(req) : {};

      if (req.method === "GET" && p === "/api/layout") return json(res, 200, service.layout());
      if (req.method === "POST" && p === "/api/encode") return json(res, 200, service.encode(body.data));
      if (req.method === "POST" && p === "/api/check") return json(res, 200, service.check(body.received, body.ruleVersion));
      if (req.method === "POST" && p === "/api/experiments") return json(res, 201, service.createExperiment(body.data));
      if (req.method === "GET" && p === "/api/experiments") return json(res, 200, service.listExperiments());
      const m = p.match(/^\/api\/experiments\/(\d+)(\/flip|\/decode)?$/);
      if (m) {
        const id = Number(m[1]);
        if (req.method === "GET" && !m[2]) return json(res, 200, service.getExperiment(id));
        if (req.method === "POST" && m[2] === "/flip") return json(res, 200, service.flip(id, body.positions));
        if (req.method === "POST" && m[2] === "/decode") return json(res, 200, service.decodeExperiment(id));
      }
      return json(res, 404, { error: { code: "ERR_NOT_FOUND", message: "路由不存在" } });
    } catch (e: any) {
      const status = e?.code === "ERR_NOT_FOUND" ? 404 : e?.code === "ERR_ALREADY_DECODED" || e?.code === "ERR_NOT_FLIPPED" ? 409 : 400;
      return json(res, status, { error: { code: e?.code ?? "ERR_INTERNAL", message: e?.message ?? String(e) } });
    }
  });
}

export function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(findFreePort(preferred + 1)));
    srv.listen(preferred, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
