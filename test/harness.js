// A tiny test runner for the browser (the project has no Node or npm).
// Open test/index.html, or run it headless; results go in <pre id="out"> and the title.

const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }

export function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
export function equal(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || "not equal"}: ${sa.slice(0, 200)} !== ${sb.slice(0, 200)}`);
}

export async function run() {
  const out = document.getElementById("out");
  const lines = [];
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      lines.push(`ok   ${t.name}`);
    } catch (e) {
      failed++;
      lines.push(`FAIL ${t.name}\n     ${e.message}`);
    }
  }
  lines.push("", `${tests.length - failed}/${tests.length} passed`);
  out.textContent = lines.join("\n");
  document.title = failed ? `FAIL ${failed}` : `PASS ${tests.length}`;
}
