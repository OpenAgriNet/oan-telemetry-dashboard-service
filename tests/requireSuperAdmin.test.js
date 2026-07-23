const test = require("node:test");
const assert = require("node:assert/strict");
const requireSuperAdmin = require("../middleware/requireSuperAdmin");

function invoke(roles) {
  let nextCalled = false;
  const req = { user: { realm_access: { roles } } };
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  requireSuperAdmin(req, response, () => { nextCalled = true; });
  return { nextCalled, response };
}

test("only a super-admin can start evaluation runs", () => {
  assert.equal(invoke(["viewer"]).response.statusCode, 403);
  assert.equal(invoke(["super-admin"]).nextCalled, true);
});
