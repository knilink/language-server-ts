import { fileURLToPath } from 'node:url';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { EventEmitter } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function writeData(res: http.ServerResponse, data: string): void {
  res.write('data: ' + data.replace(/\n/g, `\ndata:`) + '\n\n');
}

class DebugServer {
  server: http.Server;
  port: number;
  emitter: EventEmitter;

  constructor(port: number, emitter: EventEmitter) {
    this.port = port;
    let file: string | undefined;

    this.server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
      if (req.headers.accept && req.headers.accept === 'text/event-stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        switch (req.url) {
          case '/stdin':
            this.emitter.on('read', (data) => writeData(res, JSON.stringify(data)));
            return;
          case '/stdout':
            this.emitter.on('write', (data) => writeData(res, JSON.stringify(data)));
            return;
          default:
            res.writeHead(404);
            res.end();
            return;
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        let basePath = __dirname;
        if (path.basename(__dirname) !== 'debug') {
          basePath = path.dirname(__dirname);
        }

        if (!file) {
          file = fs.readFileSync(path.join(basePath, 'dist', 'debugServer.html')).toString();
        }
        res.write(file);
        res.end();
      }
    });
    this.emitter = emitter;
    this.server.on('error', (e) => console.error(e));
  }

  listen(): DebugServer {
    this.server.listen(this.port);
    return this;
  }

  getPort(): number {
    return (this.server.address() as any).port; // MARK
  }
}

export { DebugServer };
