# Playtest Punch List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure debug access, make combat pacing legible, activate defensive AI across wars/fronts, and make province-attack failures explicit.

**Architecture:** Keep authority on the server and simulation layers. Signed game-ticket claims carry an account-derived debug entitlement, while the game server applies a separate deployment gate per connection; combat projections reuse the same rate calculation as damage application; AI priorities consume read-only assessment data; province attacks choose a reachable node inside the intended province; and client feedback is a pure presentation mapping.

**Tech Stack:** TypeScript, Node HTTP/WebSocket services, Zod protocol schemas, Vitest, DOM UI.

**Spec:** `PLAYTEST_FIX_LIST.md` plus the approved five-item design in the implementation request.

## Global Constraints

- Canonical debug username is `DimaTest1`, matched case-insensitively.
- Debug use requires both a signed account-derived ticket entitlement and `IRONFRONTS_DEBUG_CONTROLS_ENABLED=true` on the game deployment.
- Query parameters and development mode grant no debug authority.
- Existing retreat/counterattack behavior remains intact.
- Do not expand into RBAC or occupation redesign.
- Commit incrementally per item; do not squash, amend, or bypass hooks.

---

### Task 1: Per-connection debug entitlement

**Files:**
- Create: `apps/auth-server/src/debug-entitlement.ts`
- Create: `src/client/debug-access.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/server-schema.ts`
- Modify: `packages/protocol/src/ticket.ts`
- Modify: `apps/auth-server/src/main.ts`
- Modify: `apps/game-server/src/config.ts`
- Modify: `apps/game-server/src/main.ts`
- Modify: `apps/game-server/src/gameplay-gateway.ts`
- Modify: `src/client/game-connection.ts`
- Modify: `src/client/remote-session.ts`
- Modify: `src/main.ts`
- Test: `tests/server/debug-authorization.test.ts`
- Test: `tests/server/ticket-protocol.test.ts`
- Test: `tests/game-connection-lifecycle.test.ts`
- Test: `tests/debug-access.test.ts`

**Interfaces:**
- Produces: `isDebugEntitledUsername(username: string): boolean`.
- Produces: required signed `GameTicketClaims.debugEntitled: boolean`.
- Produces: `GameplayConnection.debugEnabled: boolean` and `hello.debugEnabled: boolean`.
- Produces: `setDebugHandles(target, enabled, handles)` for installing/removing QA handles after authentication.

- [ ] **Step 1: Write failing entitlement, gateway, handshake, and handle tests**

```ts
expect(isDebugEntitledUsername('DimaTest1')).toBe(true);
expect(isDebugEntitledUsername('dImAtEsT1')).toBe(true);
expect(isDebugEntitledUsername('ordinary')).toBe(false);
expect(rejected.code).toBe('unauthorized_debug');
expect(unauthenticated.code).toBe('authentication_required');
expect(connection.debugEnabled).toBe(true);
expect(target.__ironfrontsSession).toBeUndefined();
```

- [ ] **Step 2: Run tests and confirm failures are caused by missing entitlement behavior**

Run: `npm.cmd test -- tests/server/debug-authorization.test.ts tests/server/ticket-protocol.test.ts tests/game-connection-lifecycle.test.ts tests/debug-access.test.ts`

Expected: FAIL on the absent claim, per-connection authorization, handshake field, and handle installer.

- [ ] **Step 3: Implement the minimal signed and deployment-gated path**

```ts
export const DEBUG_USERNAME = 'DimaTest1';
export function isDebugEntitledUsername(username: string): boolean {
  return username.trim().toLocaleLowerCase('en-US') === DEBUG_USERNAME.toLocaleLowerCase('en-US');
}

const debugEnabled = claims.debugEntitled === true && options.debugControlsEnabled;
```

Reject every `devSet*` message with `{ type: 'error', code: 'unauthorized_debug' }` unless that connection is enabled. Send debug-control broadcasts per connection so ordinary clients always receive `devControlsEnabled: false`. Initialize the browser UI to false and install renderer/session/combat handles only after the authenticated `hello`/baseline exposes `debugEnabled`.

- [ ] **Step 4: Run the targeted tests and type-check touched contracts**

Run: `npm.cmd test -- tests/server/debug-authorization.test.ts tests/server/ticket-protocol.test.ts tests/game-connection-lifecycle.test.ts tests/debug-access.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/2026-09-13-playtest-punchlist.md apps/auth-server/src/debug-entitlement.ts src/client/debug-access.ts packages/protocol/src/index.ts packages/protocol/src/server-schema.ts packages/protocol/src/ticket.ts apps/auth-server/src/main.ts apps/game-server/src/config.ts apps/game-server/src/main.ts apps/game-server/src/gameplay-gateway.ts src/client/game-connection.ts src/client/remote-session.ts src/main.ts tests/server/debug-authorization.test.ts tests/server/ticket-protocol.test.ts tests/game-connection-lifecycle.test.ts tests/debug-access.test.ts
git commit -m "fix: secure debug controls per connection"
```

### Task 2: Authoritative combat-rate projection

**Files:**
- Modify: `src/game/combat.ts`
- Modify: `src/game/combat/damage.ts`
- Modify: `src/game/player-view.ts`
- Modify: `apps/game-server/src/projection.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/server-schema.ts`
- Modify: `src/ui/ui-state.ts`
- Modify: `src/ui/army-presentation.ts`
- Modify: `src/ui/army.ts`
- Modify: `src/ui/game-ui.css`
- Modify: `src/main.ts`
- Test: `tests/game/combat-rates.test.ts`
- Test: `tests/game/player-view.test.ts`
- Test: `tests/army-presentation.test.ts`

**Interfaces:**
- Produces: `calculateFrontDamage(session, front, dtHours)` used by `stepCombat` and projection.
- Produces: per-front outgoing/incoming damage per game hour, HP casualties, numeric modifiers, and estimated game/real duration.
- Consumes: current projected timeline speed to convert game hours to real seconds.

- [ ] **Step 1: Write failing authoritative-rate and presentation tests**

```ts
const before = defenderHp;
const view = projectArmyView(state, world, 1, attacker.id, undefined, 1 / 3600)!;
stepCombat(context, 0.05);
expect(before - defenderHpAfter).toBeCloseTo(view.battleFronts![0].outgoingDamagePerGameHour * 0.05);
expect(formatCombatDuration(2, 7200)).toContain('2 game hours');
```

- [ ] **Step 2: Run tests and confirm the new projection fields are absent**

Run: `npm.cmd test -- tests/game/combat-rates.test.ts tests/game/player-view.test.ts tests/army-presentation.test.ts`

Expected: FAIL on absent rate/breakdown/duration fields.

- [ ] **Step 3: Share the exact combat calculation and render it**

```ts
export interface FrontDamageCalculation {
  sideAToB: readonly DamageEntry[];
  sideBToA: readonly DamageEntry[];
  sideAToBPerGameHour: number;
  sideBToAPerGameHour: number;
}
```

Relabel raw unit profiles as `Base damage / game hour`, spell out `Soft`, `Light`, and `Heavy`, and add live rate/casualty/modifier/duration rows to the battle overview.

- [ ] **Step 4: Run combat and UI tests**

Run: `npm.cmd test -- tests/game/combat-rates.test.ts tests/game/combat-v2.test.ts tests/game/player-view.test.ts tests/army-presentation.test.ts tests/army-command-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/game/combat.ts src/game/combat/damage.ts src/game/player-view.ts apps/game-server/src/projection.ts packages/protocol/src/index.ts packages/protocol/src/server-schema.ts src/ui/ui-state.ts src/ui/army-presentation.ts src/ui/army.ts src/ui/game-ui.css src/main.ts tests/game/combat-rates.test.ts tests/game/player-view.test.ts tests/army-presentation.test.ts tests/army-command-ui.test.ts
git commit -m "feat: project authoritative combat rates"
```

### Task 3: Defensive AI activation and multi-front priorities

**Files:**
- Modify: `src/game/game-state.ts`
- Modify: `src/game/ai/assessment.ts`
- Modify: `src/game/ai/simple-ai.ts`
- Test: `tests/game/diplomacy-domain.test.ts`
- Test: `tests/game/ai-strategy.test.ts`
- Test: `tests/game/ai-multi-front.test.ts`

**Interfaces:**
- Produces: war transition that promotes only the neutral defender to `ai`.
- Produces: `Assessment.threatenedFronts` and `Assessment.lostProvinces`.
- Consumes: existing command boundary, retreat rules, local-superiority gates, and front state.

- [ ] **Step 1: Write failing neutral activation, two-war, two-front reinforcement, and recapture tests**

```ts
setRelation(state, germany, poland, 'war');
setRelation(state, germany, belgium, 'war');
expect(state.countries[poland].controller).toBe('ai');
expect(state.countries[belgium].controller).toBe('ai');
expect(reinforcements.map((army) => army.order?.destX)).toEqual(expect.arrayContaining([polishFrontX, belgianFrontX]));
expect(recapture.order?.target).toMatchObject({ kind: 'province', provinceId: lostProvinceId });
```

- [ ] **Step 2: Run tests and confirm neutral countries remain inactive and priorities are absent**

Run: `npm.cmd test -- tests/game/diplomacy-domain.test.ts tests/game/ai-strategy.test.ts tests/game/ai-multi-front.test.ts`

Expected: FAIL for neutral controller state, front distribution, and recapture choice.

- [ ] **Step 3: Implement explicit defensive priorities**

Promote the defender when a war relation begins, assess every threatened active front, issue bounded reinforcement orders before global concentration, and try scenario-home provinces lost to current enemies before ordinary enemy objectives. Preserve existing retreat and favorable-counterattack checks.

- [ ] **Step 4: Run focused and live-world AI suites**

Run: `npm.cmd test -- tests/game/diplomacy-domain.test.ts tests/game/ai-strategy.test.ts tests/game/ai-multi-front.test.ts tests/game/ai-campaign.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/game/game-state.ts src/game/ai/assessment.ts src/game/ai/simple-ai.ts tests/game/diplomacy-domain.test.ts tests/game/ai-strategy.test.ts tests/game/ai-multi-front.test.ts
git commit -m "feat: activate defensive AI across fronts"
```

### Task 4: Province-target routing and clear order feedback

**Files:**
- Create: `src/ui/order-feedback.ts`
- Modify: `src/game/commands/attack.ts`
- Modify: `src/game/combat/location.ts`
- Modify: `src/main.ts`
- Modify: `tests/game/attack-target-validation.test.ts`
- Modify: `tests/playtest-pass-1b.test.ts`

**Interfaces:**
- Produces: province attack destination selected from graph nodes for which `world.provinceAt(nodeX, nodeZ) === provinceId` and an unrestricted route exists from the army.
- Produces: explicit engine reasons `Target is not reachable.`, `No valid hostile force.`, and `Attack route unavailable.`.
- Produces: `describeOrderFailure(reason): { title: string; body?: string }`.

- [ ] **Step 1: Write failing route/capture and feedback-mapping tests**

```ts
expect(arrivalProvince).toBe(command.target.provinceId);
expect(unreachable.reason).toBe('Target is not reachable.');
expect(unavailable.reason).toBe('Attack route unavailable.');
expect(describeOrderFailure('No valid hostile force.').title).toBe('No hostile force');
```

- [ ] **Step 2: Run tests and confirm the current nearest-click routing and in-main mapper fail them**

Run: `npm.cmd test -- tests/game/attack-target-validation.test.ts tests/game/refactor-regressions.test.ts tests/playtest-pass-1b.test.ts`

Expected: FAIL on province-contained destination and imported feedback behavior.

- [ ] **Step 3: Implement contained-node routing and extract the mapper**

Select the nearest reachable candidate inside the intended province, pass its exact coordinates to movement order installation, and use `world.provinceAt` for arrival-node capture/front location. Return explicit failures without mutating the army order. Import the pure mapper in both synchronous and asynchronous rejection paths.

- [ ] **Step 4: Run order, movement, capture, and feedback suites**

Run: `npm.cmd test -- tests/game/attack-target-validation.test.ts tests/game/attack-contact-gate.test.ts tests/game/refactor-regressions.test.ts tests/game/occupation.test.ts tests/playtest-pass-1b.test.ts tests/combat-feedback.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/ui/order-feedback.ts src/game/commands/attack.ts src/game/combat/location.ts src/main.ts tests/game/attack-target-validation.test.ts tests/playtest-pass-1b.test.ts
git commit -m "fix: route attacks into target provinces"
```

### Task 5: Full verification and focused regression coverage

**Files:**
- Modify only files required by failures directly caused by Tasks 1-4.

**Interfaces:**
- Consumes: every contract produced above.

- [ ] **Step 1: Run all focused suites together**

Run: `npm.cmd test -- tests/server/debug-authorization.test.ts tests/server/ticket-protocol.test.ts tests/game-connection-lifecycle.test.ts tests/debug-access.test.ts tests/game/combat-rates.test.ts tests/game/combat-v2.test.ts tests/game/player-view.test.ts tests/army-presentation.test.ts tests/army-command-ui.test.ts tests/game/diplomacy-domain.test.ts tests/game/ai-strategy.test.ts tests/game/ai-multi-front.test.ts tests/game/ai-campaign.test.ts tests/game/attack-target-validation.test.ts tests/game/attack-contact-gate.test.ts tests/game/refactor-regressions.test.ts tests/game/occupation.test.ts tests/playtest-pass-1b.test.ts tests/combat-feedback.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the repository check**

Run: `npm.cmd run check`

Expected: all workspace checks, TypeScript, ESLint, architecture tests, and Vitest pass.

- [ ] **Step 3: Review the diff against the approved design**

Run: `git diff --check HEAD~4..HEAD` and `git status --short`.

Expected: no whitespace errors and no unrelated changes.

- [ ] **Step 4: Close verification without an empty commit**

If verification required an in-scope correction, return to that task's red-green cycle and commit the named files with `test: cover playtest punch list regressions`. If no correction was required, leave the four item commits as the complete history.
