# Fine water (adaptive sub-cell bricks)

The coarse automaton ([water-physics.md](water-physics.md)) moves water in eighths of a block, four cells per second, with no volume:
a source is infinite and a flowing cell drains when it is not fed. The **fine water** is the default replacement
(`runtime.plugins.fine_water: false` keeps the coarse automaton) that keeps a real, conserved volume of water at a resolution of `1/N` block (N = 2, 4 or 8, default 4),
only where water moves. Calm water folds back into ordinary blocks, which remain the truth for large still volumes.

| | coarse (W1, projects not yet upgraded) | fine (`Config.Fine`) |
|---|---|---|
| state | blocks `water`, `water_1..7` | blocks `water` (infinite source), `water_1..7` and `water_full` (finite volumes) + bricks |
| resolution | 1/8 block in height, 1 block across | `1/N` block across, `1/(32 N)` block in height |
| rate | one step every 5 ticks (4 Hz) | one step every tick (20 Hz, `FineInterval`) |
| volume | not conserved (sources spread, flows drain) | conserved exactly, every exchange is ledgered |
| pressure | none | communicating vessels through full cells |

## Representation

* **Units.** A sub-cell holds `0..32` units (`voxel.FineCap`); a block of `N^3` sub-cells holds `32 N^3` units (2048 at N=4).
  Coarse level `l` (1..8) is `l V` units with `V = 32 N^3 / 8` (256 at N=4); per sub-column a level is `q = 32 N / 8` units.
* **Brick.** The water of one block cell whose voxel is **air**: `N^3` bytes, index `x + N (z + N y)`, plus a `dirty` bit.
  Bricks live in `fluid.State` (map + sorted order), never in the chunks.
* **Coarse cells.** `water_1..water_7` hold `l V` units, `water_full` (registered only when Fine is on, after every other
  block, so a coarse registry keeps its ids) holds `8 V`. They are finite. `water` stays an infinite source: it feeds
  neighbours up to level `FineSourceLevel` (default 2) and absorbs what is above that level, so a source behaves as a
  constant-head boundary and a sheet it feeds reaches a few blocks, not the whole world.
  A source with at least two source neighbours (a river, a lake, a reservoir) feeds at `FineBodyLevel` instead (default 6): the bank of a body holds water near the level of its surface, so a breach, a ditch or a basin fills up (`sourceHead` in `fine_step.go`). Setting it equal to `FineSourceLevel` turns this off.
* **Streams.** The water falling from a brick over free air (see [Falling streams](#falling-streams)): per lip brick, one
  integer queue per sub-column. Hashed, captured, snapshotted.
* **Ledger** (snapshotted, not hashed: it never feeds back into the rules, so an undo returns the exact StateHash): `Created` (sources, pours, edits that place flowing blocks), `Drained` (void, sources), `Evaporated` ([stagnant films](#evaporation-of-stagnant-films)),
  `Displaced` (edits over water). `Held` is the water of the bricks plus `Transit`, the water in the streams. Exact law,
  checked by the tests: `coarse finite units + Held - (Created - Drained - Evaporated - Displaced)` never changes.

## One fine step

Every `FineInterval` ticks (default 1). Everything is integer arithmetic on sorted slices; no map is iterated where order
could matter (map loops only set flags or sum).

**A. Demands** (refine a coarse cell, spawn a brick in air or a fragile block, turn lava into stone):

* coarse candidates (wake-ups, chunk scans, unserved demands) that satisfy the **coarse predicate** below;
* every dirty brick: a face whose neighbour is air and that would spill (bottom layer wet above it; or a lateral sub-cell
  that is supported and holds at least the film threshold), a coarse neighbour across a **seam** that disagrees, lava
  touched by water;
* the **pressure** pass: for each dirty brick touching a body of **full** cells (full bricks and `water_full`) not yet
  reached this step, a breadth-first walk through that body (at most `FinePressure` cells per step, a cut walk does nothing)
  collects its surfaces: non-full bricks, partial coarse cells and empty cells beside or on top of it. They are compared by
  head `Y 32 N^3 + units`; when the highest wet one and the lowest differ by more than `2 N^2` units (`V` when a coarse cell
  is involved), up to one layer (`32 N^2` units) moves at once from the top of the highest to the bottom of the lowest; a
  coarse or empty end is refined or spawned first (a demand). This is what fills a U-tube or a basin from below.

Demands are sorted by target and served within `FineSpawn` per step and `FineMaxBricks` live bricks, starting at the
hashed **spawn cursor** and wrapping (see [Overload](#overload)). A brick whose demand is refused stays dirty (it retries);
a refused coarse candidate stays in the work list. A brick created or a cell converted
during this phase keeps its neighbours dirty one more step (their demands were computed before the change).

**B. Moves** on the dirty bricks (sorted by `(Y, Z, X)`), sequential on live values so a pair can never overshoot:

1. *Fall*, `FineFallPasses` passes (default 2): each sub-cell drops into the sub-cell below up to its room; the bottom
   layer drops into the brick below, into the void (drained) or into a source (absorbed). A source above is a spring at
   constant head: once per step (first pass only) it tops each top sub-cell of the brick below up to `FineSourceLevel`
   eighths of a sub-cell (8 units at the default level 2, at most 128 units per step at N=4). It used to fill the whole
   top layer at every pass (1024 units, half a block of water per tick), more than any lateral spreading carries away:
   a source placed in the air built a tower of full bricks up to itself, drawn as a stack of glassy terraces
   (`TestFineFloatingSourceFallsAsStream`).
2. *Lateral*, one pass: each sub-cell equalises with its four side neighbours (inside the brick or across a face): when the
   giver is **supported** (full sub-cell or a solid / full block below) and the difference is at least 2, half the difference
   moves. Into a dry sub-cell only when the giver holds at least the **film** threshold (`32 N / 16` units, 1/16 block), so a
   puddle stops spreading. Across a face: a source gives or absorbs toward its virtual level, the void drains. The sweep
   direction and the order of the four sides alternate with the step parity so no direction is favoured.
3. *Legacy evaporation* (`FineEvapEvery` > 0 only, off by default): single-unit films with nothing above lose their unit
   every `FineEvapEvery` steps. The default sink is the [evaporation of stagnant films](#evaporation-of-stagnant-films).

**C. Settle and fold.** A dirty brick that neither gave nor received anything and has no refused demand becomes clean; every
brick that changed makes its six neighbours dirty. A clean empty brick disappears. Each connected set of clean bricks that
contains a brick that just became clean is offered to the **fold**:

* each brick `i` of volume `u_i` gets level `L_i = u_i / V`; the remainders `u_i mod V` are summed, `k` whole levels are given
  to the bricks with the largest remainders (ties by cell order), and the last remainder `r < V` stays in **residue
  bricks** (the next in that order, as few as possible while each keeps less than the film threshold per sub-cell, so a
  calm film does not spread again), flattened from the bottom;
* the result is checked against the same predicates the automaton uses (coarse predicate of every created or neighbouring
  coarse cell, seam and spill tests of the residue brick, support below every created cell). If any test would fire, nothing
  is folded (the bricks stay, clean and free, until something disturbs them).

Folding moves less than one level (`V`) of water per brick inside a connected calm body. The total is exact.

A calm component that the evaporation will take entirely (an **isolated film** in the sense below, every brick of it on a
solid block) is not folded while the evaporation is on: folded, a thin puddle would become level-1 coarse cells, which
nothing ever revisits. Any other component folds as before (a film larger than the budget, beside lava, the void or a
stream, over air): kept in bricks without being evaporated, it would hold them forever (`TestFineEvapBigFilmFolds`,
`TestFineEvapRefusedFilmFolds`).

## Evaporation of stagnant films

Small leftovers (the film a spill leaves on a lawn, a puddle after the source was removed) clear by themselves after a
while instead of lingering forever. It is an explicit sink: every unit removed is added to `Ledger.Evaporated`, so the
conservation law stays exact.

**Pass.** Every `FineEvapPeriod` ticks (default 20, one pass per second; `-1` turns it off), also while the water is idle,
a pass visits at most `FineEvapBudget` bricks (default 1024) from a cursor, in cell order, wrapping around. For each brick
not classified yet in this pass it walks the brick's connected component (six faces, bricks only, at most the budget,
all walks of a pass at most 4 budgets: the cursor then resumes at the first brick not visited). The component is an
**isolated film** when it is no larger than the budget and every brick of it is:

* a **film**: no water column deeper than `FineEvapDepth` (in 1/256 metre, default 32: 1/8 m, 16 units at N=4),
* not the lip of a falling stream,
* free of coarse water (a source: sea, river, spring; finite `water_1..7` or `water_full`: a lake), lava and the void on
  all six faces.

A film touching anything deeper is part of that body: the shallow rim of a pool, the sheet of a spring and the shore of a
sea never evaporate. Each brick of an isolated film that rests on a solid block with no water above it is **tracked**:
`since` (the tick it became stagnant), `at` (the tick of its last evaporation), `last` (its units after the last visit)
and `rem` (the remainder of the integer rate). A change of more than `FineEvapEps` units between two visits (default N^2,
one unit per sub-column) other than its own evaporation restarts the dwell, and so does a `since` in the future (a
malformed state; it never underflows into an immediate evaporation); a dirty brick waits. After `FineEvapDwell` ticks
(default 500, 25 s) each visit removes `floor((rate * climate * capRes * elapsed + rem) / (1000 * 1000 * 20))` units and
keeps the rest in `rem`, so a slow rate (a cold shelter, a small `FineEvapRate`) still evaporates at its rate instead of
rounding to nothing. `capRes` is the volume of a film at the threshold depth, `elapsed` the ticks since the brick's last
evaporation (or the end of its dwell), at most 10 periods (a long rain or dirty spell does not come back as one large
step), `rate` the permille per second `FineEvapRate` (default 30: a film at the threshold depth clears in about 33 s, a
thinner one sooner) and `climate` the permille factor:

| condition | factor |
|---|---|
| rain or snow on an open brick (`weather` extra, local phase) | 0 |
| sheltered: a solid or opaque block within 64 cells above (a roof, a cave) | x0.25 |
| open: sun height (weather day clock) | x0.5 at night .. x1.5 at noon |
| temperature at the brick (`weather.Local.TempMilliC`) | x0.1 at -5 C and below, x1 at 15 C, x1.5 at 25 C and above |
| no weather extra installed, or the module installed but off (every game installs it, inert unless the project enables it) | x1 (open), x0.25 (sheltered) |

The units are taken from the deepest columns first, one unit per column and round from its top wet sub-cell, so the
film thins evenly; the brick and its neighbours are made dirty (the step settles them, an emptied brick disappears). The
mesh draws the depth per corner (below), so the surface and its film look fade out with the volume, without a step.

**State and determinism.** The `since`/`at`/`last`/`rem` of the tracked bricks and the cursor are hashed (appended to the brick
digest only when something is tracked or the cursor has moved, so a state without films keeps its former hash),
captured, snapshotted (`fine.evap`, validated) and restored; a world file (`PrepareFineBytes`) drops them like the dirty
bits. Every input of a pass is hashed state: the tick, the bricks, the voxels and the weather extra. A `Config` with
an evaporation field set hashes them (`'E'`). The rules changed without changing the default `Config`, so a fine
`Config` also hashes the **rules version** `fluid.FineRules` (1 = with evaporation, 2 = [overload](#overload), 3 = [tall
falls](#falling-streams)): a journal recorded under the former
rules fails its first hash check at replay instead of diverging later, a snapshot written by a newer rules version is
refused with an explicit error, and an older snapshot (a save) restores and continues under the current rules.
`Stats.FineEvapVisited` is the bricks examined by the last pass.

An edit that removes a brick (`fluid_cell` with an empty fill, a block placed over it) drops its tracking like its dirty
bit; re-creating it (the editor's undo through `fluid_cell`) starts a new dwell, so that undo, like the dirty bit it
restores as dirty, does not return the exact `StateHash` of a state with a tracked film. Chunk-mode undo and rollbacks
capture the whole extra and do return it.

**Cost.** One pass per `FineEvapPeriod`: at most `FineEvapBudget` visits and `4 FineEvapBudget` bricks walked (six map
reads each), one column scan of at most 64 blocks per evaporating brick. 4096 droplets on a 128x128 map
(`TestFineEvapBoundedCost`, budget 256) clear without a pass examining more than the budget.

**Coarse water.** The coarse automaton (W1) needs no equivalent: an unfed flowing cell, a level-1 puddle included,
already drains (one cell per step from its edge). In fine mode, level-1 coarse cells that were folded before this rule
existed (an older save) are left as they are.

**Tests** (`fluid/fine_evap_test.go`): a puddle clears between its dwell and the expected time, the ledger exact at every
tick; a lake of finite coarse cells, a pit of poured bricks and a river of sources keep every unit while a puddle beside
them clears; rain stops the open puddle while a roofed one dries, and the open one clears after the rain; snapshot,
restore, journal replay and same-hash-same-future while films are tracked (the dwell is in the hash); bounded passes on
4096 films; random edits with a fast evaporation keep the conservation law at every tick.

## Falling streams

Before streams, a cascade was a column of bricks, one per block crossed: the fall rule moves a sub-cell down by at most
`FineFallPasses` sub-cells per step, so the falling water sat as a thin packet (about 6 of 32 units) in one layer of each
cell, and the renderer had to invent a curtain between the packets (notches where a cell had no brick at that tick).
Water in free fall now has its own continuous representation.

**Lip.** A dirty brick whose bottom layer is wet, whose cell below is air without a brick, and whose column has at least
`FineStreamMinFall` (default 2) free cells under it. Its stream is created in phase A (demands, canonical order: dirty
bricks sorted by cell; within `FineMaxStreams`, default 1024) instead of the spill demand that would spawn the brick below.
A drop of one cell keeps the old rule (the brick below is spawned).

**State** (per lip, sorted by lip cell): `q`, `D` slots of `N^2` integers (units per sub-column), slot 0 arriving at the
next step, slot `D-1` the water that just left. Hashed (lip, `D`, every slot) after the bricks, only when a stream exists
(a state without falling water keeps its former hash); captured (deep copy), snapshotted (`fine.streams`, validated:
sorted, in bounds, `1 <= D <= 181`, slots `>= 0`, not empty, at most the cap), restored. The impact cell of the last step is
carried for the renderer but neither hashed nor read by the rules.

**Step** (phase B, after the fall and lateral passes of the dirty bricks):

1. *Leave the lip.* In the fall passes, a bottom sub-cell of a lip that feeds its stream moves entirely into the stream's
   input of its sub-column (no room limit: free fall). The lip is "moved", so it stays dirty while it feeds.
2. *Walk.* From the lip down through air cells without brick, at most 256 cells (64 before rules 3): the target is the first brick that is not
   full; a void or a source absorbs (drained, like the fall rule); a fragile block is the target itself (spawned, the
   block destroyed); anything else (wall, coarse water, lava, a full brick) puts the target in the free cell above it.
   With nothing free under the lip (`h = 0`) that cell is the lip itself, which an edit may have turned into anything:
   a lip brick or air is the target as usual, a source or a void absorbs, any other block (stone, lava, coarse flowing
   water...) **blocks** the stream: what arrives is ledgered as `Displaced` (like an edit over water), so the stream
   empties and the automaton can go idle (`TestStreamBlockedLipDrains`). The fall height `h` is the number of free cells
   crossed. Everything is read from the hashed state of this step.
3. *Resize* to the delay `D` (`delayOf`): free fall at 32 blocks/s^2 up to a terminal speed of 30 blocks/s (reached
   after 14 blocks and 0.94 s), 20 steps/s, rounded up, 1 for `h = 0`: `ceil(5 sqrt(h))` for `h <= 14`,
   `ceil(20 (64 h + 900) / 1920)` above (150 blocks: 110 steps, 5.5 s; 256 blocks: 181). A shorter fall
   merges the slots beyond the new length into slot 0 (that water arrives now), a longer one appends empty slots (the
   water in the air keeps its schedule, the new water travels further).
4. *Deposit* slot 0 into the target brick: each sub-column fills its own sub-column from the bottom, then the rest of the
   brick layer by layer; what does not fit, or what waits for a brick to be spawned, stays in slot 0.
5. *Shift*: slot `k` takes slot `k+1`, the input enters slot `D-1`. A stream whose total is 0 is removed.

A target that is free air with nothing below it in range asks for a brick in phase A of the next step (a demand served
like the others, within `FineSpawn` and `FineMaxBricks`; a refused one is simply asked again: the stream keeps the
automaton busy). A stream that exists makes `Idle` false.

**Back-pressure.** A lip feeds its stream only while slot 0 (the water waiting at the target) holds at most one brick of
water (`N^3 FineCap` units); past it the lip follows the normal rules (it asks for the brick below, starved when the cap
refuses it), so a target that accepts nothing (brick cap, spawn budget, a full pool) never makes slot 0 grow without
bound. One step moves at most `FineFallPasses` full sub-cells per sub-column into a stream, so every slot value of a
reachable state is at most `N^3 FineCap + 181 FineFallPasses FineCap` (`streamSlotMax`, 13632 at N=4), which is also the
bound the snapshot parser enforces: every reachable state is restorable (`TestStreamBackPressureAtBrickCap`,
`TestStreamBackPressureSourceAboveHoles`, `TestStreamSlotBoundRestorable`). A blob with any stream is rejected when
streams are off (`FineMaxStreams: -1`).

**Interruptions.** A block placed in the fall, a lip that dries up or is removed, a basin that fills: the walk of the next
step sees it (the water already in the air lands on the block, or arrives at the shorter delay, or keeps falling without
new input until the queue is empty). Nothing in a stream can refer to a stale cell: the lip is only a key, the target is
recomputed every step.

**Determinism.** Streams are created and walked in sorted order, the deposit order is the stream order, and every input
is a function of the hashed state, so two states with the same `StateHash` have the same future
(`TestStreamSameHashSameFuture`, the restored engine with every brick dirty included). Undo/redo in chunk mode and the rollback of a failed act
capture the whole fluid extra, streams included (`agent`: `TestFineWaterStreamsChunkModeUndoAndReplay`,
`TestFineWaterStreamsActRollback`).

**World files.** A `.voxworld` holds voxels and bricks, not the water in the air: `PrepareFineBytes` ledgers the transit
as displaced and clears the streams (a load replaces the water like the voxels; `TestFineStreamsLoadWorldMidFallReplays`
loads a world saved mid-fall into editors holding other water and checks the journal replay and the hash, three loads).

**Bounds.** At most `FineMaxStreams` streams (-1 turns them off: the fall goes through bricks as before), each at most
181 slots of `N^2` integers (11.3 KiB at N=4); a step walks at most 256 cells per stream twice (demands and advance).
A 500-block fall (`TestStreamVeryTallFallBounded`) is two chained streams and costs a few milliseconds per step at most.

**Tall falls** (rules version 3). Before, a stream walked 64 cells: a 150-block fall was three streams, each landing in
a brick hanging in mid-air and restarting from rest there (the water reached the foot after 108 ticks instead of the
61 of a free fall, with a splash ring and a thin filet in the sky every 64 blocks), and the renderer drew the whole
curtain, lip to impact, at the first tick of a new stream (the water seemed to arrive at once). Now one stream covers
256 cells with a terminal speed, and the export carries `FrontGap` / `TailGap` (voxel.FineStream: the part of the fall
below the oldest water in the air, above the newest one; both 0 for a steady stream): the curtain grows from the lip
with its front (white tip, no splash at the foot before the water arrives) and a dried lip leaves a falling tail. The
streamer re-meshes a chunk when the front or the tail moves by 1/64 of the fall, and meshes the chunk layers above the
generated terrain that hold water but no edited block (the air beside a tower: the curtain had a gap in each). The
curtain vertices carry the time since the lip (1/28 s, `curtainTau`) instead of the fall in 1/4 block, which saturated
64 blocks down and froze the streaks into stretched lines; the shader advects the streaks with that time, so they
accelerate, then run at the terminal speed.

**Tests** (`fluid/fine_stream_test.go`): formation and exact conservation at every tick, a cascade without bricks in the
air (and the same scene with streams off peaks higher in bricks), monotone delays, cut by a block / re-formed / dried up
with conservation, snapshot mid-fall (other engine, same engine, transit in the hash), rollback of a failed tick, same hash
same future, random edits in and around the fall (blocks, pours, the source toggled; two engines agree, law at every tick),
the cap, the wire validation.

## Voxel size

A world with smaller voxels (`sim.Engine.Subdiv()` = 2, 4 or 8 voxels per metre) keeps the brick: `N` sub-cells per voxel
axis, so the resolution per metre is `N*Subdiv` (finer, `Subdiv^3` times more bricks per cubic metre; the user accepts the
memory). The rules read the voxel size every tick (`Config.atScale`, a working copy that is never hashed), so a scene
switch to another size takes effect at once, with no registry change (the fine water keeps scale 1 blocks):

* **Speed.** The tick runs `Subdiv` fine steps (the whole step: spills, falls, sideways flow, streams, folds), so the
  front and the falls cover the same metres per second. The evaporation pass belongs to the tick. `Subdiv` 1 is one step.
* **Spread.** The heads of a spring and of a body (`FineSourceLevel`, `FineBodyLevel`) are depths in metres: eighths of a
  metre at scale 1, so `Subdiv` times more eighths of a voxel, no longer capped at one voxel (8). The part above the top
  voxel of a source column is served by the **virtual head** (`virtualHead`, `headRises`): the head is measured from the
  bottom source of the column, and an air cell beside a brick, reached from that column through air only, is a virtual
  source at the level the head still reaches in that layer (`head - 8 * layers above the bottom source`); a brick whose top
  layer is three quarters full against such a cell spawns the brick above it (water never spills upward). A spring is thus
  25 cm deep at every voxel size (two voxels at `Subdiv` 8) and a deep lake adds nothing (its head is within its own
  voxels). A source belongs to a body of water when two of its side neighbours **one metre away** are sources (a one metre
  spring is no lake). The film threshold grows with `Subdiv`, capped at a half sub-cell up to `Subdiv` 2, 3/8 at 4 and 1/4 at 8
  (`filmFor`): the finer sheet spreads by smaller steps and a thinner film keeps its reach in metres.
* **Caps.** `FineMaxBricks`, `FinePressure`, the evaporation budget and `FineBurstBricks` grow by `Subdiv^2` (the sheet's
  area), the bricks (cap plus burst) up to 64 MiB of sub-cells; `FineSpawn` by `Subdiv`. The burst step stays an eighth of
  the scaled range. `FineInterval` and `FineFallPasses` are unchanged. The overload fold and the forced fold run every
  `overFoldEvery` / `overForceEvery` **ticks** (the step counter advances `Subdiv` times per tick).
* **Metres.** `FineEvapDepth` is a depth in 1/256 metre: the same metres at every size (`Subdiv` times the voxel fraction, up
  to 3/4 of a voxel so a full brick is never a film). `Plugin.FocusRadius` is in metres (`radius * Subdiv` voxels, within
  `MaxFocusRadius`) and its snap is 8 metres; `fluid_focus` itself takes voxels.
* **Mesh.** `mesh/finewater.go` works in voxel units, like the coarse mesh: the 8/9 lowering of a free surface and the seams
  with coarse cells are fractions of the voxel, and the sheet's slope per sub-column does not depend on the size, so seams
  stay consistent (`TestFineSeamWithCoarseCell`).
* Tests: `TestFineSubdivSpreadMetres` (a one metre spring spreads within 0.75 m of the scale 1 front at 0.5 s, 1 s, 2 s and
  0.5 m at 10 s, at `Subdiv` 2, 4 and 8), `TestSpringHeadDeeperThanAVoxel`, `TestScaledCapsInMetres`, `TestEvapDepthInMetres`,
  `TestOverFoldPeriodInTicks`, `TestFocusSnapInMetres`, `TestFineSubdivSeamWithSource`, `TestFineSubdivBricksAndVolume`,
  `TestFineSubdivChangeAtRuntime`,
  `TestFineLakeSurfaceMetres` (a 3 m x 3 m basin filled from a 1 m spring settles, at `Subdiv` 8 and at scale 1, to the same
  depth within 0.035 m, one sub-cell of a brick at 12.5 cm voxels; measured at the far corner and the far edge, not beside
  the spring where a scale 1 cell averages a metre of the head gradient; the depth is the evaporation film depth, 1/8 m,
  plus the spring's reach).
* **Waking.** An edit of a source wakes the bricks that read its head from up to `ceil(head / 8)` layers above it
  (`dirtyBody`, `State.headLayers`; one layer at scale 1), because the virtual head of a brick beside a column of air is
  measured from a source several voxels below: a removed spring drains the second layer too (`TestFineRemovedSpringDrains`,
  `TestFineSourceEditWakesTheVirtualHeadLayers`). `voxel.Access` (what `sim.Chunks` hands to systems such as the physics
  character) exposes the fine water like the map (`FineSource`), so a character's immersion sees the bricks.

## Opposing flows

Sources whose water meets (a channel fed from both ends, springs facing each other, channels crossing, a loop, a spring
against a finite coarse lake or lava) settle without oscillating: no state of the bricks comes back two steps later, and
each scene of `TestFineOpposingFlowsSettle` goes idle (channel 235 ticks, head on 800, crossing 210, loop 323, lake 1899,
lava 312) with the volume exact at every tick. A symmetric layout settles to the same water on both sides within one
level (the fold gives its whole levels to the largest remainders, ties by cell order) or 2% (the lateral pass is
sequential; its direction alternates every step, which leaves a bias of about 1%).

**Push.** The current that pushes a body (`voxel.LiquidTable.Flow`: the controller's water push, `Immersion.Flow`) was a
unit vector toward any lower neighbour: a film a few units higher than its neighbour pushed at full speed, and where two
flows met the push flipped from full speed one way to full speed the other way every few ticks (25 flips in 300 ticks,
amplitude 0.69 at the meeting line of `TestFineOpposingPushNoJitter`). It now grows with the head difference up to full
strength at one coarse level, so coarse water (whose differences are whole levels) pushes exactly as before and the
meeting line of fine water pushes with an amplitude under 0.02. The water surface's current (`mesh` `flowOf`) was
already proportional and clamped: no flipped or NaN direction where flows cancel.

Scene: `examples/voxel_sandbox -fluid fine -demo opposing -cam 0,74,26,0,-38`.

## Rules shared by coarse and fine cells (hysteresis)

A coarse cell only knows its level, so the coarse and seam tests use a tolerance of one level; this is what makes a fold
stable instead of refining again:

| test | fires when |
|---|---|
| coarse predicate, cell of level `L` | air, a fragile block or the void below; a partial coarse cell or a source below; liquid above a partial cell; a side neighbour that is air / void with `L >= 2`, a coarse cell with `abs(L - L') >= 2`, a source with `abs(L - S) >= 2`, lava (when it can turn to stone) |
| source predicate | air or a fragile block below or beside it, lava beside it |
| seam, brick face column `a` (units) vs coarse level `L` | `abs(a - L q) > q`; coarse partial below a wet bottom layer; coarse water above a top layer that has room |
| spill into air | bottom layer wet (down); a supported sub-cell with at least the film threshold (sides) |

Bricks are invisible to the coarse predicate (a coarse cell next to a brick is the brick's business). The thresholds are the
same seen from both sides: a clean brick never has a coarse neighbour whose test would fire, so removing it or folding next to
it cannot leave an unstable coarse cell that nobody woke.

## Waking and determinism

* **Dirty bits are state**: they are hashed, captured, snapshotted. Every voxel write (`voxel.Observer.BlockChanged`) marks the
  bricks of the 15 cells it can influence dirty *synchronously*; `ChunkReplaced` (world loads, agent history, undo in chunk
  mode) marks every brick of the chunk and its one-cell border dirty, removes the bricks whose cell is no longer air
  (ledgered as displaced) and ledgers the change of coarse volume of the chunk; `fluid_wake` marks the bricks of its box.
  Writes commute (a flag, a sum), so the arrival order of a command's writes cannot matter.
* The **chunk scans** still to do (queue, sweep and its cursor) are hashed in fine mode, and a wake-up inside a chunk that
  is still to be scanned waits for that scan. The rest of the **coarse work list** (pending writes, unserved demands) works
  as in W1 (sorted multisets; past 8192 writes in one step the writes become the sorted set of their chunks; past 4096 queued
  chunks a sweep of the overlay chunks that also looks at the six neighbours of each chunk, base terrain included). It is not
  hashed: it is a superset of the coarse cells whose predicate fires outside the chunks still to scan, so two states with the
  same hash evaluate the same demands. Candidates are evaluated in cell order until `4 FineSpawn` of them fired; a stale
  entry costs one predicate and neither budget nor a hit, and the rest is carried over untouched. Only the evaluated, refused
  candidates count against `MaxActive` and the hashed `Dropped`; the carried ones are bounded separately (`MaxActive` plus one
  step of wake-ups and scans) and an excess, which needs far more unstable cells than the spawn budget serves for a long
  time, is shed without being hashed (`Stats.CarryShed`).
* Every other choice (sweep direction, side order) depends on the tick, which is hashed. Hence: **same `StateHash`, same
  future**, including after `Snapshot`/`Restore` in the middle of a flow, a failed tick's rollback, a chunk-mode undo
  (`agent/hist.go` captures the whole extra) and `VerifyReplay` after a world load.
* Assumption shared with W1: water of the **base terrain** that is unstable but never touched is not evaluated (the world
  generator only produces stable sea).

## Cost bounds

| cap | default | bounds |
|---|---|---|
| `FineMaxBricks` | 4096 (2048 before rules 2) | live bricks: memory `MaxBricks * (N^3 + ~150)` bytes (0.9 MiB at N=4) and the work of a step |
| `FineSpawn` | 128 | bricks created per step: a breach widens by at most that much per tick |
| `FineFallPasses` | 2 | sub-cell moves per step: `(passes + 1) * N^3 * dirty bricks` |
| `FinePressure` | 8192 | cells walked by the pressure pass per step |
| `FineMaxStreams` | 1024 | falling streams: memory `40 N^2 * 4` bytes each at most, two walks of 64 cells each per step |
| `FineEvapBudget` | 1024 | bricks examined per evaporation pass (every `FineEvapPeriod` ticks), `4x` that walked |
| `MaxActive`, wake queue, chunk queue | as W1 | coarse candidates |

An ocean breach therefore costs at most `FineMaxBricks` bricks and `FineSpawn` new bricks per step; past the cap a spill
waits (`Stats.FineRefused`) and the [overload rules](#overload) make room. Measured numbers are in
[the measurements section](#measurements).

`FineMaxBricks` is part of the `Config`, which is replay state (hashed, identical on every engine of a world): it cannot
follow the load radius of one viewer. Raise it for worlds that need more moving water at once (64 MiB of fills at
most, `FineMaxBricks * N^3 <= 2^24`); the cost of a step grows with the dirty bricks, about 2 to 4 us each at N=4.

## Overload

Many sources (or one large flood) can ask for more bricks than `FineMaxBricks`. Before rules version 2 this was a cliff:

* **Deadlock.** A brick whose spill the cap refused stayed dirty, and a connected set of bricks folds only when none of
  them is dirty. The waiting front of a sheet therefore kept the whole sheet in bricks, nothing ever folded, the pool
  never emptied: the water froze half spread, with straight cut edges drawn as skirts, dry ground between the sources,
  and a world that was never idle (100 sources on a plane: 2048 bricks and 1248 dirty bricks forever, 3.7 ms per tick
  for nothing; at 50 sources, 174 waiting bricks held 1874 calm ones).
* **Starvation.** The demands were served from the lowest target every step, so whatever room the budgets left went to
  the same cells again: the sources with the highest coordinates waited for every lower front.

Rules version 2 (`fluid.FineRules = 2`):

1. **Fair service.** The demands of a step are served in target order from the hashed spawn cursor, wrapping; when a
   budget (`FineSpawn` or the cap) refuses one, the cursor moves to it, so the next step starts where this one stopped.
   A pending demand is served within about `pending / FineSpawn` steps of room. The cursor is hashed (appended to the
   brick digest only while it is set: a state where every demand is served keeps its former hash), captured,
   snapshotted (`fine.spawn`, validated) and dropped by a world file like the dirty bits.
2. **Overload fold.** On a step whose cap refused a demand, every 4 steps, the clean bricks next to a brick that is
   *held* (dirty only because its demand was refused: it neither gave nor received) are offered to the fold without
   it: the calm water behind a waiting front becomes coarse cells with the same stability tests as any fold, plus no
   seam with the held brick (a residue brick may touch it). The freed bricks go to the waiting fronts.
3. **Forced fold.** When that frees nothing (a pool made only of fronts and thin films that cannot fold alone), every 20
   steps whole components whose dirty bricks are all held are folded with the lateral tests waived, in cell order from
   the spawn cursor, until 1/8 of the cap is free. Vertical tests stay (support, water above a partial cell), so no
   coarse water hangs in the air; a front cell becomes a coarse cell whose predicate fires, which asks for a brick again
   when there is room. A component with a brick that moved is never forced.

Every fold moves less than one level per brick and is exact: the conservation law holds at every tick of every overload
test. The water keeps spreading at the rate the pool allows and the scene settles to the same coarse water as with an
unlimited pool, later.

**Signal.** `Stats.FineOverload` (the last step's cap refused a demand), `FineCapRefused`, `FineCapSources` (of which
raised by a source), `FineCapSteps`, `FineOverFolds`, `FineOverFolded`; `State.Overloaded()` and
`State.OverloadNote()` ("water overloaded: 2048/2048 bricks, 312 spills waiting (41 sources throttled)"). The
`fluid.Plugin` writes one line to standard error when the water becomes overloaded and one when it recovers (held 100
ticks, at most one line per 200 ticks; `Log` redirects, `Quiet` silences) and, with `OverloadHUD`, adds the note to the
HUD lines (the sandbox turns it on).

**Cost of a step.** The move phases (fall passes, lateral pass) run on several goroutines (`fluid.Threads`, default
`GOMAXPROCS` up to 6; 1 is sequential) and give exactly the water of the sequential order: each brick gets a level one
above the highest level of the earlier bricks it conflicts with (the brick and its four side bricks are written, the
bricks under them are read), and the bricks of a level, which touch no common brick, run together. The `StateHash` does not
depend on the number of threads (`TestFineThreadsDoNotChangeTheWater`, also run under `-race`). The bricks also keep
pointers to their six neighbours (no map lookup to resolve them) and the pressure walk follows them. Together: 1.8x on the
1000-source plane and cave scenes (11.9 and 21.5 ms per tick at `FineMaxBricks` 16384, was 21.1 and 39.7), identical
results. A brick costs about 1 to 1.5 us per step now, so `FineMaxBricks` 8192 to 16384 fits a 20 Hz budget on a
desktop (`FineMaxBricks * N^3 <= 2^24` still holds); the default stays 4096 because the config is hashed.

**Adaptive cap.** `Config.FineBurstBricks` (default 0: off) lets the cap on the live bricks follow the load: the
effective cap (`State.FineCap`, `Stats.FineCap`) is `FineMaxBricks + burst`. On every step where the cap refused a demand
the burst grows by an eighth of `FineBurstBricks` (up to it); after 100 calm steps (nothing refused, also at rest) it
shrinks by the same amount once the bricks fit under the lower cap. `FineMaxBricks + FineBurstBricks` is the memory and
cost ceiling (same limits as `FineMaxBricks`). The burst and its calm counter are state: hashed while the burst is above
0 (a state at its base cap keeps its former hash), written in snapshots (`fine.burst`, validated against the config)
and captured for undo; the config field is hashed only when set. It is a function of the steps, not of the clock, so every
engine agrees (`TestFineBurstIsState`, `TestFineBurstGrowsAndShrinks`). 1000-source plane, 4096 + 12288: every source
served at tick 67 instead of 383, 12.4 ms per tick at the 16384 peak instead of 4.4 ms at the fixed 4096; the cave
needs more than the ceiling and stays overloaded, at 16.5 ms per tick. Combine it with the focus: the focus bounds what
needs bricks, the burst gives that part the room it needs for as long as it needs it.

**Focus.** `fluid_focus {points, radius}` (or `fluid.Plugin{FocusRadius: 48}`, which follows the camera and
`FocusPoints`) limits the fine step to the bricks whose column is within `radius` voxels of a point (the plugin's `FocusRadius` is in metres). Outside the focus
the water is frozen like an unloaded chunk: its bricks keep their dirty bits and are not evaluated, nothing spawns
there (a demand outside waits; a brick inside forgets it and is woken when the focus reaches the target), calm bricks
outside fold back to coarse cells (64 offered per step, in a window that rotates with the tick) and the engine goes
idle when nothing inside the focus moves. A brick inside may still push water into a brick across the border. The
focus (radius and sorted points) is hashed (only while set: no focus keeps the former hash), snapshotted, captured for
undo and journaled; the points are sorted, so their order is not state. Widening or clearing the focus resumes the frozen
water, which settles to the same coarse water as without a focus (`TestFineFocusFreezesOutsideAndResumes`). Measured on the
1000-source scenes (default caps, 1000 ticks): plane, no focus: cap reached, never idle; radius 24: 2.7 ms per tick,
no overload, idle at tick 376. Cave: 7.7 ms per tick, cap reached; radius 24: 4.6 ms, cap not reached.

**Stress scenes.** `examples/voxel_sandbox -fluid fine -demo sources -demo-n N -demo-layout plane|terrace|bowl|cliff|cave`
(and `sourceScene` in `fluid/fine_overload_test.go`): N sources 6 blocks apart in a closed stone box (floor y=59).

Measured with `sourceScene` (Apple M2 Max, `FineMaxBricks` 2048 for the first two columns, 4000 ticks; "served" is the
tick every source fed water, "-" never; "idle" the tick the scene settled, "-" still moving at 4000; ms are the mean
fine step and its worst):

| scene | rules 1 (2048): served / idle / ms | rules 2 (2048): served / idle / ms | rules 2 (default 4096): served / idle / ms |
|---|---|---|---|
| plane, 20 sources | 2 / 765 / 2.0 | 2 / 765 / 1.1 | 2 / 765 / 1.1 |
| plane, 100 | 8 / - (frozen at the cap) / 3.8 | 7 / 1581 / 2.2 | 7 / 661 / 4.3 (worst 9.6) |
| plane, 300 | - (starved) / - / 4.4 | 11 / - (1763 bricks left) / 2.6 | 11 / - (2248 left) / 2.9 |
| terrace, 300 | - / - / 4.1 | 143 / - / 2.4 | 23 / - / 7.3 (worst 24) |
| bowl, 100 | 8 / - / 4.3 | 7 / 1581 / 2.1 | 7 / 661 / 4.2 |
| cave, 300 | 8 / - / 4.8 | 8 / - / 5.9 | 8 / - / 9.9 (worst 31) |

The terrace, cliff and cave scenes keep moving in every version: their springs fill a closed box. Under rules 1 their
water stood still at the cap anyway (no fold, no spill, every waiting brick evaluated every tick); now it keeps spreading
within the pool. Captures (`-demo sources -demo-n 100 -demo-layout plane -cam 4,66,24,0,-25`, 300 ticks): before, a grid
of frozen star-shaped puddles with blue skirts along their cut edges and dry stone between them; after, one continuous
sheet that settles to coarse water by tick 661. Terraces (`-cam 30,78,10,70,-28`, 600 ticks): before, the same frozen
puddles on every step; after, sheets running down every step.

Mesh: an overloaded sheet (`BenchmarkFineWaterSheet`, 688 bricks of uneven films among coarse cells in one chunk) took
124 ms per water build (up to 140 ms in the sandbox: the drawn water lagged the simulation by seconds and the mesh
workers saturated every core); 27 ms now, same vertices (a dense brick index over the chunk and its margin, dense memos
of the surface candidates per lattice point and of the corner normals instead of maps keyed by vectors).

Tests (`fluid/fine_overload_test.go`): an overloaded plane settles with exact conservation at every tick and survives a
snapshot round trip; every source of 100 (300 in the slow run) is served within a bound with a spawn budget of 8; two
engines agree tick by tick under overload, a snapshot taken with the cursor set restores and continues identically, the
journal replays, a malformed cursor is refused and the cursor is hashed; 500 sources on the default caps keep every
step under the brick cap and conserve the water; the cached volume matches the fills at every tick of the fuzz scenes
that reach the cap (a fold once ranked a full brick as a residue); the meshes of an overloaded scene are built without truncation and draw
every wet column.

## Compatibility

* `Config.Fine` is off by default: the coarse automaton, the registry (no `water_full`), `StateHash` and every golden are
  unchanged (`TestFineOffIsTheCoarseAutomaton`, the scenario goldens).
* In a project, `runtime.plugins.fine_water` is on by default and only read when `runtime.plugins.fluid` is `true`; `"fine_water": false`
  selects the coarse automaton. The editor without a project (`burrowedit`, `-no-fine-water` to turn it off) and burrowd sessions
  created with `fine_water: true` follow the same rule. Saves taken with the coarse water do not load with the fine water.
  `burrowedit -project` follows the project, so the editor and `burrowplay` simulate the same water.
* A `.voxworld` with bricks stores them after the chunks; a coarse engine refuses such a file with an explicit error.

## Commands and tools

| command | effect |
|---|---|
| `fluid_pour {pos, units}` | add units to one cell (bucket, leak) |
| `fluid_cell {pos, fill}` | set the exact sub-cells of one cell (empty clears); the editor's undo uses it |
| `fluid_refine {min, max}` | turn calm coarse water of a box into bricks (to disturb it by hand) |
| `fluid_wake {min, max}` | rescan a box and mark its bricks dirty |
| `fluid_focus {points, radius}` | evaluate only the bricks within `radius` blocks of the points (empty clears), see [Overload](#overload) |

Editor tools: `editor_water` (read, with `detail` the sub-cells), `editor_water_pour`, `editor_water_wake`.

## For S3 (renderer)

`mesh.BuildFineWater(grid, reader, liquidTable, chunk, opts)` (or `mesh.Opts.FineWater` on the mesher, which fills
`Result.Fine`) builds the surface of the bricks of one chunk from an immutable `voxel.FineGrid` (`State.ExportFine(lo, hi)`,
safe to hand to a mesher goroutine). The coarse faces are unchanged; the fine mesh is an extra indexed triangle list (quads
of 4 vertices, 6 indices, counter-clockwise seen from outside) drawn in the water pass:

| `mesh.FineVertex` field | type | meaning |
|---|---|---|
| `Pos` | `[3]float32` | chunk-local position in blocks (fractional: the surface moves in `1/(32 N)` block) |
| `Normal` | `[3]int8` | unit normal x127 (central differences of the corner heights for the top) |
| `Flow` | `[2]int8` | surface current (x, z) x127, from the column volumes, downhill |
| `Depth` | `uint8` | water depth of the column in 1/16 block (capped) |
| `Foam` | `uint8` | foam potential 0..255: speed, plus skirts (falling or spilling water) and undersides |
| `Face` | `uint8` | `FineTop`, `FineSideXP/XN/ZP/ZN` (skirts toward dry columns), `FineBottom` (water over air) |
| `Block` | `voxel.BlockID` (uint16) | the water block, for its texture layer and tint |

24 bytes in Go (packed: 22). The coarse vertex (`mesh.Vertex`, integer positions) cannot hold fractional heights, so S3 needs
a second vertex layout and pipeline sharing the water fragment shader. Seams: on a block corner that touches a coarse
liquid cell the height equals `LiquidCornerHeights` of the coarse neighbours (`LiquidTable.BlockCornerHeight`: the mean
height of the liquid cells around the corner, **bricks only** when a brick touches it, see below), along a block edge
shared with a coarse cell it is the straight line between the two corners, so the fine surface meets the coarse quads
without cracks (`TestFineSeamWithCoarseCell`, `TestFineSurfaceHasNoCracks`). Elsewhere the surface is built from
**sheets** (next section). `Opts.FineMaxVertices` (default 65536) truncates a
pathological chunk and sets `FineMesh.Truncated`.

### Rendering (S3, done)

The HDR shader levels draw it: the streamer exports the bricks and the streams once per simulation tick
(`State.ExportFine`, found by duck typing on the chunk map's fine source; `FineGrid.Streams`), and re-meshes **only the
water** of the chunks whose bricks (or one-cell border) or streams changed (`Mesher.BuildWater`, on the mesh workers, at
most every 2 ticks per chunk, never while a build of that chunk is queued). The renderer swaps the chunk's water buffer
alone (`Renderer.UploadChunkWaterOnly`) and keeps drawing the old one until the new one is uploaded: no cube re-mesh, no
gap. Water meshes are joined with the coarse liquid surface (`mesh.Opts.LiquidSurface`, same `FineVertex` layout) and
drawn by `water2.vert` + `water_hdr.frag`.

**Cascades** (`mesh/cascade.go`; all frame domain, nothing written to the simulation):

* **Curtain** (`FineCurtain`): a ribbon from the lip surface (the height of the feeding neighbour, so the sheet continues
  the water above the edge, no lump) to the impact surface found by walking the voxels and bricks. It leaves the lip with
  a horizontal tangent along the flow over the edge and follows the free-fall parabola (horizontal speed from the debit:
  thick water shoots further), then drops. Its width covers the wet sub-columns; ribbons of neighbouring lips with the same
  direction join exactly (shared boundary vertices: thickness, lip and impact heights averaged at the boundary, the same
  row fractions for every ribbon), open ends taper (alpha to 0 over 0.22 block, wobbling in the vertex shader), and a thin
  filet narrows as it accelerates. Shader: thickness = debit (`Depth`), streaks advected along `sqrt(fall)` so they
  accelerate downward, wide "panels" across, aeration growing with debit and fall (thin = glassy, refracting the cliff
  behind through the scene copy with a sky reflection and a sun glint; thick = white, lit through), a white foot over the
  last block.
* **Foot**: spray droplets (`FineSpray`, at most 20 per lip, ballistic loops animated on the GPU from a per-vertex seed),
  churning boils and a faint rising mist (`FineMist`, 2..6 + 1..3 sprites per lip), expanding foam rings and boils on the
  water (`FineRing`, a flat quad, radius from the energy). On the levels without HDR these are dropped in the vertex
  shader. The spray and mist sprites are soft: they fade over a short height above the impact level and a short depth in
  front of the opaque scene, and the curtain fades into the pool over its last half block, so the depth test does not cut
  a hard white line (a fake ledge) along the foot.
* **Foam on the surface** (`water_hdr.frag`): the current foam pattern is advected with a two-phase periodic drift
  (flow-map technique), not by `flow * time`, which sheared the pattern without bound where the flow varies (moire on the
  small basins under a rill). Shore foam uses the distance to the opaque scene (`max(vertical depth, path / 2)`), so a
  wall seen at a low angle gets a thin soft fringe instead of a wide band.
* The lip bricks are not drawn (their water is the head of the curtain) while they hold only falling water: at most half
  full and no wet bottom sub-column resting on a block, coarse water or a full sub-cell below (a lip whose fall was
  blocked keeps its puddle, `TestCascadeSupportedLipIsDrawn`). A chunk resolves only the streams of its column and its
  one-cell border (`TestCascadeFarChunkSkipsStreams`); the streamer re-meshes the neighbouring column of a lip on a chunk
  border (joined curtains) and keeps exporting a grid that has streams but no brick left (`engine/TestSyncFineStreams`). The former stream heuristics of the brick mesh
  (packets joined into a sheet, gaps filled) remain for drops of one cell and for streams over the cap.
* **Sheets** (`mesh/finewater.go`, `clusterAt`): a sub-column draws a top quad only where its water is *supported*
  (every layer under its top wet, the bottom one on a solid block, coarse water or a full sub-cell) and *uncovered*.
  Each such surface, each coarse surface and each dry floor ("ground") of the four columns around a lattice point, in
  the rows `floor(h)-2 .. floor(h)+2`, is a candidate; sorted by global height, candidates less than 0.55 block apart
  form one sheet, and the corner takes the mean of its sheet. A sheet spans at most three gaps, never the ends of the
  window, so every column of the sheet, whatever its row, gets the same corner (no crack, `TestFineSurfaceHasNoCracks`):
  a mound or a slope over a step is one smooth surface across cell rows instead of terraces with vertical faces between
  them (`TestFineSheetAcrossRows`). A film next to dry ground averages with it and tapers to 0.015 above it: no skirt,
  no stair outline (`TestFineFilmTapersToGround`). A skirt is drawn only toward a neighbour that is not part of the
  sheet, from the corner heights down to the neighbour's lower sheet or the bottom of the water column (it can span
  several rows), and only when it is at least 0.07 block tall (a thinner one read as a blue line). Water that rests
  on nothing (a packet between two ticks) never enters a sheet: the stream heuristics below draw it, and a packet of
  less than one sub-cell in mid-air (a film spilling over a one-block step) is not drawn at all. Before, every corner
  averaged the columns of its own row: a falling packet or a covered column (height 1) next to a puddle pulled the
  corner up into spikes, and a partly filled brick pinned to its mean height at the block corners drew a sawtooth.
* **Coarse/brick corners**: `LiquidTable.SurfaceCorners` averages only the bricks at a block corner that a brick
  touches. A coarse source is drawn full but holds its fine neighbours at its low constant head (`FineSourceLevel`), so
  the old mean pinned the brick surface to a steep strip along the seam (a notched band seen from the side); the coarse
  cell now slopes down to the bricks over its own width.
* **Shading of thin and standing water** (`water_hdr.frag`): the foam of the current and of the shore needs a body of
  water (it fades out under ~0.2 block of column depth: a film is wet ground, not a field of white blotches); the
  current is the head difference across a column (`flowOf`, a quarter block over two sub-columns is full speed), not the
  raw unit difference that made every film a torrent; a film reflects less and darkens the ground a little. A side
  face of standing water (vertex foam under 70) gets no falling streaks, and its refraction path is capped by the
  column depth (it crossed everything behind the face: blue slivers). The path under any surface is capped at three
  column depths. A steep slope seen from its back (water running over a ledge) is shaded as a surface from above with
  its normal turned toward the eye, not with the underwater colour (a dark blue band along every ledge).
* **White water** (curtain aeration, spray, mist, boils, rings): lit by the sky dome by day (the terrain's hemisphere
  term alone left it darker than the sky-reflecting pool: a grey, dirty band at the foot) and at half intensity under
  the moon (it glowed far above the moonlit ground); moonlight caustics are faint. The curtain's glassy part has more
  water body (absorption over 0.3 + 0.7 thickness block, stronger in-scatter) and brighter streaks. Each foam ring has
  its own phase from its centre and the boil is a world-space pattern on a soft white base, so the foot of a wide fall
  is one band of churning water instead of a chain of identical circles with dark holes.
* **Depth per corner**: the `Depth` of a top vertex is the sheet height at that lattice point over the bottom of its
  column (rounded to 1/16 block), not one value per column: over a flat floor the corner height is shared, so the depth
  (and every term driven by it: foam, the film look) varies continuously instead of in sub-column squares. Across a step
  in the floor the two columns still disagree at the shared corner. The attribute keeps its 1/16 block unit (shared with
  the coarse surface): a drying film loses its depth-driven look in 1/16 steps, while its surface height goes down
  continuously.
* **Shallow water at noon** (`water_hdr.frag`): the caustics gain is `1 + 1.2 c / (1 + 0.4 c)` (at most x2.8; it was
  `1 + 1.4 c`, up to x6 where two veins cross, which clipped a bright sand or grass bottom to white in shallow water and
  bloom smeared it); the shore foam needs about 0.3 block of water (in a pool a few tenths deep every pixel was within
  the shore distance of the bottom: white blotches over the whole pool), and so does the current foam (every shallow
  flowing film, and the calm finite `water_1..7` sheets that the coarse surface marks with a flowing foam potential, was
  covered with white patches); the foam rings of a fall's foot fade out over
  less than half a block of water (a flat quad crossing a stepped film showed through as stepped white patches). Every
  `pow` with a base that can be negative or out of range is clamped or written as a product (`pow(x, 2.0)` of a
  negative `x` in the rings returned NaN on NVIDIA, which bloom spread into a white smear) and the normals are
  normalised with a zero-length fallback.
* **Merging**: a brick whose `N^2` top quads are coplanar (calm, flat, no skirt) is emitted as one quad keeping the
  attributes of its four corners; the per-corner current and foam of the sub-column quads are the mean of the columns
  around each corner (no flat square of foam per sub-column).
* **LOD**: beyond 96 blocks (horizontal distance to the chunk centre) the bricks are drawn by the coarse surface, one
  quad per cell at the brick's mean height (`Opts.FineLOD`); curtains are kept. Crossing the distance re-meshes the water.

![fine water cascade, ultra, 3/4 view](img/shaders-waterfall.png)
![a small filet into a pool, ultra](img/shaders-filet.png)

Captures (1280x720, `examples/voxel_sandbox -fluid fine -settle-min 300 -shaders ultra`): cascade `-demo waterfall -cam
15,66,3,40,-12`, filet `-demo rill -cam 10,64,6,40,-15`. `-demo-dt` sets the game time of an idle frame of a `-shot`
run (default 1/20: one water tick per frame; 1/60 paces several frames per tick like a live window; negative uses the
wall clock); `-demo spill` is the open-ground scene of a live session (a source floating over a lawn, a terrace of two
one-block steps, a source over a tree crown; night with `-tick 18000`). Its sources pour into the air (the floating one
creates 384 units per tick at N=4: its brick below and four side bricks, all falling), so nothing bounds it: the puddle
widens for as long as the scene runs (about 1000 bricks at tick 300, 1800 at tick 1150) and a capture shows the age of
the run. See
[rendering.md](rendering.md#shader-levels-stage-s3-water-weather-atmosphere).

## Performance

Apple M2 Max, MoltenVK, `examples/voxel_sandbox -w 2560 -h 1440 -radius 12 -novsync -novalidation -nohud -frames 300`,
seed 1, the `perf:` lines of a `-shot` run averaged over 280 frames. With `-demo` the water advances one fixed tick per
frame (so these per-frame numbers are 6x the real-time load at 20 Hz); the "after" runs use `-settle-min` so the scene
is measured at the same age as the "before" run (frames before the window: waterfall 813, breach 792, v2 1676, sheet
10424 at medium and 12932 at ultra). The wall time is capped at 8.33 ms by the 120 Hz display even with `-novsync` (120 FPS
in every row): the GPU milliseconds are the meaningful numbers. GPU: `total` of the frame, `main` the HDR main pass (its
opaque half includes sky and clouds), `water` its second half (water, glass, rain, the cascade), `copy` the scene copy,
`post` the post chain. Mesh: wall time of the mesh workers per frame (all builds; the water part in parentheses) and the
worst single build. Fluid: wall time of the fine system per tick and the worst tick. Scenes: `-demo waterfall` (cam
`8,66,20,0,-12`), `-demo sheet` (the spring spreading over a stone plane: the stress scene, cam `9,66,9,0,-20`; in the "before"
build it was called `rill`), `-demo breach` (cam `6,72,22,0,-30`), `-gen v2 -shapes` river (cam `34,66,-22,0,-30`, base
water only, no bricks), `-demo rill` (the new filet, after only, cam `10,64,6,40,-15`).

**Before** (bricks in the fall, full chunk re-mesh every 4 ticks):

| scene | level | GPU total / main / water / copy / post (ms) | mesh per frame (water), worst build (ms) | fluid ms/tick (worst) | bricks |
|---|---|---|---|---|---|
| waterfall | medium | 5.35 / 3.85 / 0.65 / 0.05 / 1.22 | 2.52 (1.61), 5.67 | 0.77 (1.15) | 178 |
| waterfall | ultra | 7.29 / 5.36 / 0.68 / 0.05 / 1.72 | 3.03 (1.79), 6.23 | 0.91 (1.75) | 178 |
| sheet | medium | 10.24 / 7.88 / 2.42 / 0.08 / 2.03 (wall 11.4) | 49.5 (35.0), 45.2 | 9.37 (15.2) | 641 |
| sheet | ultra | 7.38 / 5.62 / 1.26 / 0.05 / 1.50 (wall 9.2) | 25.9 (14.5), 82.0 | 5.14 (18.3) | 641 |
| breach | medium | 5.42 / 3.89 / 0.82 / 0.06 / 1.25 | 2.37 (1.63), 5.52 | 0.70 (0.90) | 148 |
| breach | ultra | 5.72 / 3.68 / 0.74 / 0.05 / 1.83 | 2.35 (1.62), 5.80 | 0.68 (0.98) | 148 |
| v2 river | medium | 5.35 / 3.93 / 0.98 / 0.13 / 0.94 | 0 | - | 0 |
| v2 river | ultra | 7.35 / 5.18 / 1.38 / 0.08 / 1.71 | 0 | - | 0 |

**After** (streams, curtains and foot effects, water-only re-mesh every 2 ticks, chunk cache, LOD):

| scene | level | GPU total / main / water / copy / post (ms) | mesh per frame (water), worst build (ms) | fluid ms/tick (worst) | bricks, streams |
|---|---|---|---|---|---|
| waterfall | medium | 5.81 / 4.48 / 0.84 / 0.14 / 1.06 | 2.18 (1.69), 2.74 | 0.53 (1.32) | 80, 14 |
| waterfall | ultra | 7.66 / 5.70 / 0.92 / 0.06 / 1.73 | 1.83 (1.44), 2.39 | 0.47 (0.59) | 80, 14 |
| sheet | medium | 5.23 / 3.98 / 1.48 / 0.05 / 1.05 | 6.91 (4.89), 3.66 | 1.38 (1.59) | 326, 15 |
| sheet | ultra | 7.81 / 6.04 / 1.71 / 0.05 / 1.52 | 8.38 (5.98), 4.95 | 1.67 (2.39) | 326, 15 |
| breach | medium | 5.38 / 3.79 / 0.78 / 0.06 / 1.31 | 2.07 (1.76), 3.68 | 0.66 (0.98) | 148, 0 |
| breach | ultra | 5.77 / 3.69 / 0.69 / 0.06 / 1.87 | 2.07 (1.76), 3.26 | 0.71 (0.99) | 148, 0 |
| v2 river | medium | 5.80 / 4.30 / 1.03 / 0.13 / 1.01 | 0 | - | 0 |
| v2 river | ultra | 7.38 / 5.20 / 1.31 / 0.08 / 1.74 | 0 | - | 0 |
| rill (filet) | medium | 5.34 / 3.97 / 1.69 / 0.05 / 1.18 | 3.23 (0.89), 3.92 | 0.06 (0.13) | 6, 1 |
| rill (filet) | ultra | 8.39 / 6.65 / 2.00 / 0.05 / 1.57 | 3.08 (0.89), 1.66 | 0.06 (0.12) | 6, 1 |

Reading: the cascade's look costs about +0.2 ms in the water half (curtain, spray, mist, rings); every scene stays under
the budget (medium <= 6 ms, ultra <= 10 ms of GPU at 1440p, radius 12). The run-to-run noise of these GPU numbers is about
+-0.4 ms (the v2 river, untouched, moved by +0.45 ms at medium). The streams halve the bricks of the cascade (178 -> 80)
and of the sheet (641 -> 326: no brick column under the ledge), which divides the sheet's fluid tick by 6.8 (9.4 -> 1.4 ms,
worst 15 -> 1.6 ms) and its GPU water by 1.6. The mesh workers no longer rebuild the cube mesh for moving water: the worst
build drops from 5.7 to 2.7 ms (waterfall) and from 45-82 to 3.7-5.0 ms (sheet); the sheet's worker time per frame drops
from 26-49 ms to 7-8 ms although its water re-meshes twice as often. Nothing of this runs on the main thread (frame CPU
0.6-0.9 ms in every row).

Simulation alone, A/B with the same build (`go test ./fluid -run TestFineCostReport -v`, fast sizes, N=4): cascade 0.042
ms/tick and 15 bricks with streams, 0.054 ms/tick and 21 bricks with `FineMaxStreams: -1`; the other reference scenes have
no fall of two cells or more and are unchanged.

Water mesh of the waterfall's chunks (a temporary benchmark of `Mesher.BuildWater` on the three chunks of the scene after
200 ticks): 5.4 ms -> 4.2 ms with the 27-chunk read cache -> 2.8 ms reading the chunk's own voxels from the mesher's copy.

Not done: a faster fold of calm bricks and skipping stable bricks beyond what the dirty bits already do (every clean brick
is already skipped; the sheet stays expensive because a constant-head source keeps its film moving). Coplanar faces are merged
only inside a brick (a calm flat brick is one quad instead of `N^2`, `TestFineFlatBrickIsOneQuad`; added after the
tables above, not measured); merging across bricks would need T-junction handling on non-flat edges.

## Measurements

Apple M2 Max, `go test ./fluid -run 'TestFineCostReport|TestFineOceanBreachDefaultCaps|TestFineDamBreak' -v` (ms per
simulation tick, fine step every tick):

| scene (N=4) | ms/tick | live bricks | sub-cells per step |
|---|---|---|---|
| rest (settled pool) | < 0.001 (idle: one branch) | 3 | 0 |
| rill (a source feeding a 1-wide trough, then a plane) | 0.72 | 229 | 14k |
| cascade (source over an 8-block cliff into a pool) | 0.07 | 29 | 1.8k |
| breach (dam of a 9x4x17 lake of sources) | 0.24 | 86 | 5.5k |
| ocean of 66k sources open on a plane, default caps | 6.3 mean, 11.8 worst | 2048 (the cap) | 131k |
| dam break of a 11x4x11 finite reservoir | settles in 2462 ticks, peak 438 bricks, ends with 3 | | |

N=2 costs about half of N=4 per brick, N=8 about four times as much (`TestFineCostReport` logs all three). Memory: about
150 bytes per brick plus `N^3` bytes of fill (2048 bricks at N=4: about 0.4 MiB). A 65536-write burst (scattered sources)
costs at most 10.3 ms per step (`TestSlowFineWorstBurst`): past 8192 writes in one step the wake-ups become chunk scans.

Surface mesh (`go test ./mesh -bench FineWater`): a chunk with 256 bricks of random fills (the worst case: every column
has skirts) builds in 4.9 ms, 26940 vertices (105 per brick); a calm, flat brick costs 4 vertices per sub-column.

Coarse mode, for reference (`go test -tags slow ./fluid -run 'TestSlowCoarse' -v`): filling a 201x10x401 sea (804k
writes) costs 0.9 ms/tick on average over 501 ticks, worst 13 ms; breaching its 401x10 wall 0.41 ms/tick, worst 9 ms. The
coarse mode has no evaluation cap (an earlier `MaxEval` made the future depend on stale wake-ups); what bounds a burst is the
overflow of the wake-up queue to chunk scans, now at 8192 writes in both modes (it was 65536): a burst of 65536 scattered
sources went from one 257 ms step (983k cells evaluated) to a worst step of 30 ms (83k cells). No golden or recorded
world reached either threshold, so their hashes are unchanged.

## Limits

* Pressure acts through full cells only and moves at most one layer per body per step; a body larger than `FinePressure`
  cells only equalises locally. Sources do not take part in pressure.
* The coarse/fine seam has a tolerance of one level (1/8 block): fine water can rest up to that much above or below a calm
  coarse neighbour.
* Folding may move less than one level of water inside a calm connected body (never across a wall, never changing the total).
* A spill refused by a cap keeps its brick dirty, so a world at `FineMaxBricks` is not idle until the overload folds have
  made room (bounded cost, no growth). Scenes that keep moving (springs filling a closed cave, terraces draining into a
  closed pool) stay at the cap while they move: the water there spreads at the rate the pool and the folds allow.
* A forced fold turns the front of a sheet into coarse cells for a while: the look changes from the fine surface to the
  coarse one there until the front is refined again.
* Streams: the water in the air is not stored in a `.voxworld` (a load replaces it, ledgered as displaced); a fall deeper
  than 256 cells lands in mid-air (a new brick, then a new stream below it, starting from rest); the fluid bounds stop at
  y=512 by default (`Config.Max`: a pillar taller than that loses its spring into the void); the water of a stream lands in the column of
  its lip (no horizontal drift in the simulation: the curtain's bend is drawn, not simulated); a drop of a single cell
  still spawns the brick below.
* Rendering: the cascade is drawn after the scene copy, so SSR on the pool does not reflect it; at sunset the aerated
  curtain takes the sky's lilac ambient and looks a little too bright next to the shadowed cliff.
* A pool of coarse sources is drawn full but holds the bricks beside it at its constant head (a quarter block at the
  default level): where the two meet, the source cell slopes down to the bricks over one block.
* Lateral spreading is diffusive (half the difference per sub-cell pair and step): under a strong spring the water
  still heaps into a low mound around the impact before it spreads (drawn as one smooth sheet).
