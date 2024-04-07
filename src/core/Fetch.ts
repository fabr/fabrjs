import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { Computable } from "./Computable";

export function fetchUrl(urlstring: string): Computable<Buffer> {
  return Computable.from<Buffer>((resolve, reject) => {
    let data: Buffer[] = [];
    function handleResponse(res: http.IncomingMessage) {
      if (res.statusCode !== 200) {
        reject(new Error(`${res.statusCode} ${res.statusMessage}`));
      } else {
        res.on("data", chunk => data.push(chunk));
        res.on("end", () => resolve(Buffer.concat(data)));
        res.on("error", err => reject(err));
      }
    }

    const url = new URL(urlstring);
    let req;
    switch (url.protocol) {
      case "https:":
        req = https.request(url, { method: "GET" }, handleResponse);
        break;
      case "http:":
        req = http.request(url, { method: "GET" }, handleResponse);
        break;
      default:
        reject(new Error("Unsupported protocol: " + url.protocol));
        return;
    }
    req.on("error", err => reject(err));
    req.end();
  });
}