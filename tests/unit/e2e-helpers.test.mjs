import { test } from "node:test";
import assert from "node:assert/strict";
import { shot } from "../e2e/helpers.mjs";

const fakePage = () => {
  const calls = [];
  return { calls, evaluate: async () => {}, screenshot: async (o) => calls.push(o) };
};

test("shot() writes nothing unless E2E_SCREENSHOTS=1", async () => {
  const saved = process.env.E2E_SCREENSHOTS;
  try {
    delete process.env.E2E_SCREENSHOTS;
    const off = fakePage();
    assert.equal(await shot(off, "x"), null);
    assert.equal(off.calls.length, 0);
    process.env.E2E_SCREENSHOTS = "0";
    assert.equal(await shot(off, "x"), null);
    assert.equal(off.calls.length, 0);

    process.env.E2E_SCREENSHOTS = "1";
    const on = fakePage();
    const file = await shot(on, "y", { fullPage: false });
    assert.match(file, /docs\/screenshots\/m2\/y\.png$/);
    assert.equal(on.calls[0].fullPage, false);
    assert.equal(on.calls[0].animations, "disabled");
  } finally {
    if (saved === undefined) delete process.env.E2E_SCREENSHOTS;
    else process.env.E2E_SCREENSHOTS = saved;
  }
});
