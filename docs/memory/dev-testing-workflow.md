# Dev and testing workflow

## Running the pages

The pages in `project/` (e.g. `spatial-data-updater.html`, `fullcam-tsv-processor.html`) need two servers. Run each in its own terminal inside `project/`:

```
npm run dev     # Vite dev server for the pages
npm run proxy   # FullCAM API proxy on port 3001
```

- Opening a page straight from disk (`file://`) fails with CORS errors on its module scripts. Use the URL Vite prints.
- If the proxy isn't running, FullCAM calls fail with `net::ERR_CONNECTION_REFUSED`.

## Testing the plot builder without a browser

`plot-builder.ts` uses `import.meta.glob`, so load it through Vite's SSR loader from a temporary `.mjs` file inside `project/` (so `vite` resolves):

```js
import { createServer } from 'vite';
globalThis.window = { location: { hostname: 'localhost' } }; // spatial-data-updater.ts reads window.location at import
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
const { generatePlotFile, getSimulationDates } = await server.ssrLoadModule('/src/fullcam-templates/plot-builder.ts');
// ... generate plots, POST them to the FullCAM APIs with Node's fetch + FormData, then:
await server.close();
```

## Pitfalls

- Stopping a background `npx vite` process can leave its node child holding the port. Find the PID with `netstat -ano` and end it.
- A long-running dev server once served a stale copy of a page's inline script after the page was edited. Restarting it fixed this.
- Headless Edge screenshots (`msedge --headless --screenshot`) hung on the main dev machine, so UI changes there need checking by hand in a browser.
