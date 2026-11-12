# Items

A project gives its scripts a small **item registry**: names, stable ids and stack limits. The engine owns the identity and
the 6-byte stack format; the content is the mod's. There is no built-in item list, no recipe, no inventory, no dropped item
and no item rendering in the engine. Machines, crates, conveyors and inventories keep counts in block data, `Script.State`
or the save store, and draw them with the game UI.

## `runtime.items`

The registry is one JSON file named by `runtime.items` in `vox.project` (project relative, under an asset directory so
`burrow build` packs it; the build adds the file itself).

```json
{ "items": [
  { "name": "mymod:gear",  "display": "Gear",  "max_stack": 16, "block": "mymod:gear_block" },
  { "name": "mymod:wire",  "display": "Wire" },
  { "name": "mymod:hammer", "max_stack": 1 }
] }
```

| field | meaning |
|---|---|
| `name` | registry name, `[a-z][a-z0-9_]*` with an optional `namespace:` (at most 20 + 28 characters); `air` is reserved |
| `display` | readable name for tooltips and GUIs (default: the name) |
| `max_stack` | stack limit `1..65535` (default 64; `uint16`, so 65535 is the maximum) |
| `block` | optional registry name of the block the item stands for or places; the engine only reports it, it never places anything |

* **Ids.** Items are numbered in file order starting at 1; id 0 is the empty stack. Appending items keeps every id, while
  reordering or removing one renumbers the following items, so append only. The ids are project data, not simulation state:
  adding an item does not change the `StateHash`, and a replay or multiplayer peer must use the same project file to agree on
  them.
* **Limits.** At most `itemset.MaxItems` = 4096 items. The game refuses a file over 1 MiB. Parsing rejects unknown fields,
  duplicate or invalid names, and a `block` that is not a plain block registry name (no `[state]`).
* **One project per process.** Like the project block registry, the item registry is global to the process
  (`itemset.Set`), which is what a game or an editor session is.

Engine programs call `itemset.Parse`, `itemset.Set`, `itemset.ID`, `itemset.ByID`, `itemset.All` and `itemset.Count` directly.

## Stacks

An item stack is 6 bytes, little endian:

| offset | size | field |
|---|---|---|
| 0 | 2 | item id (`u16`, 0 = empty) |
| 2 | 4 | count (`u32`) |

A stack with an id and no count, or a count and no id, is invalid. The engine does not store stacks, it only defines the
format so block data, bus payloads and saves are portable between scripts and languages. `itemset.Stack` and the SDK
`burrowsdk.ItemStack` implement it:

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.OnBlockUse("mymod:crate", func(self burrowsdk.Entity, ev burrowsdk.BlockEvent) {
		id, err := burrowsdk.ItemIDByName("mymod:gear")
		if err != nil {
			return
		}
		info, err := burrowsdk.ItemInfo(id)
		if err != nil {
			return
		}
		stack := burrowsdk.ItemStack{Item: id, Count: info.MaxStack}
		b := stack.Encode()
		_ = burrowsdk.SetBlockData(ev.X, ev.Y, ev.Z, string(b[:]))
	})
}

func main() {}
```

The Go API mirrors the engine: `Encode`, `DecodeItemStack`, `Split(n)` (removes up to n and returns them) and
`Merge(src, maxStack)` (fills the receiver up to `maxStack` and returns what is left of `src`). The engine has
`itemset.Stack.Encode`, `itemset.DecodeStack`, `Split`, `Merge` and `Validate` (which also checks the registry and the stack
limit).

## Scripts

The host functions work without a plugin; a project without `runtime.items` reports 0 items. All ids are `1..item_count`.

| function | what it does | errors |
|---|---|---|
| `ItemCount()` | number of registered items | none |
| `ItemName(id)` | registry name of an id | `NOT_FOUND` |
| `ItemIDByName(name)` | id of a name; case and the `burrow:` prefix are ignored | `NOT_FOUND` |
| `ItemInfo(id)` | `ItemProps{ID, Name, Display, MaxStack, Block}` | `NOT_FOUND` |

Always resolve items by name at `on_start` (or from a project data file) and keep the id in block data or `Script.State`:
ids are stable only while the item file is appended to.

## What the mod writes

* the items themselves (the engine ships none), their recipes and crafting stations;
* inventories and containers (counts in block data or the save store, shown with the game UI);
* dropped items (a prefab spawned by a script), pickup and placement;
* item icons and rendering, tooltips, durability, enchantments or any other per-item behaviour;
* the machine logic that moves stacks between cells ([blocks](blocks.md#block-logic), [scripting](scripting/05-world.md)).
