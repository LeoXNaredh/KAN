/**
 * Genera el código MicroPython que se manda tal cual por raw REPL para cada
 * operación de archivo. Todo el contenido de archivo viaja en base64 (nunca
 * bytes crudos): el framing del raw REPL usa `\x04` como terminador de
 * stdout/stderr (ver `rawRepl.ts`) — un archivo cuyo contenido tuviera ese
 * byte literal rompería esa detección si se mandara sin codificar.
 *
 * Cada script arranca con un comentario `#KAN_OP ...` — Python válido (lo
 * ignora un device real), pero es lo que `FakeMicroPythonDevice` (tests) usa
 * para reconocer qué operación simular sin interpretar Python de verdad.
 */

// Sin espacios a propósito (no solo comillas/backslash/saltos de línea):
// el comentario `#KAN_OP write <path> <base64>` que encabeza cada script
// separa path y contenido por el primer espacio — un path con espacio
// rompería ese split. Restricción razonable para nombres de archivo de un
// proyecto MicroPython real.
const VALID_PATH = /^[^\s'"\\]+$/;

export function assertValidDevicePath(path: string): void {
  if (path.length === 0 || !VALID_PATH.test(path)) {
    throw new Error(`Ruta de archivo inválida: "${path}" (no puede contener espacios, comillas ni backslash)`);
  }
}

function normalizeDevicePath(path: string): string {
  assertValidDevicePath(path);
  return path.startsWith("/") ? path : `/${path}`;
}

export function buildListFilesScript(): string {
  return [
    "#KAN_OP list",
    "import os",
    "def __kan_walk(p):",
    "    for n in os.listdir(p):",
    "        f = (p + n) if p.endswith('/') else (p + '/' + n)",
    "        try:",
    "            if os.stat(f)[0] & 0x4000:",
    "                __kan_walk(f + '/')",
    "            else:",
    "                st = os.stat(f)",
    "                print((f[1:] if f.startswith('/') else f) + ' ' + str(st[6]))",
    "        except OSError:",
    "            pass",
    "__kan_walk('/')",
  ].join("\n");
}

export function buildReadFileScript(path: string): string {
  const devicePath = normalizeDevicePath(path);
  return [
    `#KAN_OP read ${path}`,
    "import ubinascii, sys",
    `with open('${devicePath}', 'rb') as __kan_f:`,
    "    __kan_data = __kan_f.read()",
    "sys.stdout.write(ubinascii.b2a_base64(__kan_data).decode().strip())",
  ].join("\n");
}

export function buildWriteFileScript(path: string, content: string): string {
  const devicePath = normalizeDevicePath(path);
  const base64Content = Buffer.from(content, "utf-8").toString("base64");
  return [
    `#KAN_OP write ${path} ${base64Content}`,
    "import os, ubinascii",
    "def __kan_ensure_dirs(path):",
    "    parts = path.split('/')[1:-1]",
    "    cur = ''",
    "    for part in parts:",
    "        cur = cur + '/' + part",
    "        try:",
    "            os.mkdir(cur)",
    "        except OSError:",
    "            pass",
    `__kan_ensure_dirs('${devicePath}')`,
    `with open('${devicePath}', 'wb') as __kan_f:`,
    `    __kan_f.write(ubinascii.a2b_base64('${base64Content}'))`,
  ].join("\n");
}
