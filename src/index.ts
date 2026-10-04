import * as path from "node:path";
import { Store } from "./store.js";
import { Service } from "./service.js";
import { createServer, findFreePort } from "./server.js";

const dataDir = process.env.SECDED_DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(dataDir, "secded.sqlite"));
const service = new Service(store);
const preferred = Number(process.env.PORT ?? 8787);
const port = await findFreePort(preferred);
const server = createServer(service);
server.listen(port, "127.0.0.1", () => {
  console.log(`SECDED API 已启动: http://127.0.0.1:${port}  (数据目录: ${dataDir})`);
});
process.on("SIGINT", () => { server.close(); store.close(); process.exit(0); });
