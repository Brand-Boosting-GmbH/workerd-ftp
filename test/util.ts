import path from "node:path";
import { Miniflare } from "miniflare";

export const createRunWorkerScript = (
  env: Record<string, string>,
): (<E>(content: () => Promise<E>) => Promise<E>) => {
  const runWorkerScript = async <E>(content: () => Promise<E>): Promise<E> => {
    const cwd = process.cwd();
    const dist = path.join(cwd, "dist");
    const miniflare = new Miniflare({
      modules: true,
      modulesRoot: dist,
      compatibilityDate: "2023-12-18",
      scriptPath: path.join(dist, "run.mjs"),
      script: `
          import { FTPClient } from 'index.mjs'
          export default {
            async fetch(request) {
              try {
                const ret = await (${content.toString()})() ?? null
                console.log('ret', ret)
                return new Response(JSON.stringify(ret), { status: 200 });
              } catch (err) {
                console.error(err)
                return new Response(JSON.stringify(err), { status: 500 })
              }
            }
          }`.replace(
        /\$[A-z]+\$/g,
        (match) => env[match.slice(1, -1)] ?? match,
      ),
    });
    return (
      await miniflare.dispatchFetch("http://localhost:8787/")
    ).json() as E;
  };

  return runWorkerScript;
};
