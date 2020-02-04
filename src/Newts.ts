import http from 'http';
import url from 'url';

import { Router, ContextProvider } from './Router';

export class Newts {
  routers: Router<any>[] = [];

  constructor() {
    // TODO
  }

  router<TCtx>(withContext: ContextProvider<TCtx>): Router<TCtx> {
    const router = new Router(withContext);
    this.routers.push(router);
    return router;
  }

  listen(port: number) {
    const server = http.createServer((req, res) => {
      console.log('got request');
      this.match(req, res);
    });
    server.listen(port);
    console.log(`listening on port ${port}`);
  }

  private match(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!req.url) {
      throw new Error('missing req.url i guess???');
    }

    const urlParts = url.parse(req.url, true);
    const pathname = urlParts.pathname!;

    for (const router of this.routers) {
      for (const route of router.routes) {
        if (route.method === req.method && route.regexp.test(pathname)) {
          router.handleRoute(urlParts, req, res, route);
          return;
        }
      }
    }

    // TODO: write something to the body here
    res.statusCode = 404;
    res.end();
  }
}
