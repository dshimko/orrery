// SPDX-License-Identifier: Apache-2.0
// A recording CanvasRenderingContext2D stand-in so drawing runs in Node (jsdom is not installed).

export interface FakeContext {
  ctx: CanvasRenderingContext2D;
  calls: string[];
}

const TEXT_WIDTH_PER_CHAR = 6;
const GRADIENT_FACTORIES = new Set(['createLinearGradient', 'createRadialGradient']);

function record(calls: string[], name: string, args: readonly unknown[]): void {
  calls.push(`${name}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`);
}

export function createFakeContext(): FakeContext {
  const calls: string[] = [];
  const props = new Map<string, unknown>();
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key) {
      const name = String(key);
      if (props.has(name)) return props.get(name);
      return (...args: unknown[]) => {
        record(calls, name, args);
        if (GRADIENT_FACTORIES.has(name)) {
          return { addColorStop: (...stop: unknown[]) => record(calls, 'addColorStop', stop) };
        }
        if (name === 'measureText') return { width: String(args[0]).length * TEXT_WIDTH_PER_CHAR };
        return undefined;
      };
    },
    set(_target, key, value) {
      props.set(String(key), value);
      calls.push(`set ${String(key)}=${typeof value === 'object' ? 'obj' : String(value)}`);
      return true;
    },
  };
  const ctx = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
