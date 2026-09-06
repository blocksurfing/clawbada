using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Editor-only dummy battle driver for the designer's VFX/animation pass:
/// press Play in BattleScene and two teams fight on repeat — approach, melee
/// and ranged attacks, defends, specials, deaths — with no server and no React.
/// Each battle rotates the class roster so all 10 classes get screen time, and
/// each battle index replays identically (seeded RNG) so a VFX timing check can
/// be watched again on the next loop.
///
/// Feeds BattleManager the same data shapes BattleBridge would, so everything
/// exercised here is exactly what real battles will play. Inert outside the
/// editor: real battles are driven by React through BattleBridge.
/// </summary>
public class BattleDemoLoop : MonoBehaviour
{
    [Tooltip("Run automatically when entering play mode in the editor.")]
    public bool runOnPlay = true;

    [Tooltip("Arena layout JSON from Assets/ArenaLayouts. Left empty, arena_apex_02 is loaded in-editor.")]
    public TextAsset layoutJson;

    [Tooltip("Arena/prefab tier for every lobster: evolved, elite, or apex.")]
    public string tier = "apex";

    [Tooltip("Pause between rounds, on top of the animations themselves.")]
    public float roundGap = 0.8f;

    [Tooltip("Pause after a battle ends before the next roster spawns.")]
    public float battleGap = 2.5f;

    [Tooltip("Safety cap so a stalemate can't run forever.")]
    public int maxRoundsPerBattle = 12;

    [Tooltip("Roll a fresh deterministic obstacle layout per demo battle (seeded by battle index) instead of the JSON's fixed cells.")]
    public bool randomObstacles = true;

    private static readonly string[] Classes = LobsterClasses.Names;

    // Classes that read as ranged in playback (telegraph hop instead of lunge).
    private static readonly HashSet<int> RangedClasses = new() { 3, 4, 9 }; // Tempest, Specter, Ember

    private class DemoUnit
    {
        public string id;
        public int classIdx;
        public string side;
        public int slot;
        public int col, row;
        public int hp;
        public bool alive = true;
        public bool Ranged => RangedClasses.Contains(classIdx);
    }

    private BattleManager manager;
    private HexGrid hexGrid;
    private readonly List<DemoUnit> units = new();
    private System.Random rng;

    void Awake()
    {
        if (!Application.isEditor || !runOnPlay)
        {
            enabled = false;
            return;
        }
        manager = FindAnyObjectByType<BattleManager>();
        hexGrid = FindAnyObjectByType<HexGrid>();
    }

    void Start()
    {
        if (manager == null || hexGrid == null)
        {
            Debug.LogError("[DemoLoop] BattleManager/HexGrid not found — demo disabled.");
            return;
        }
        // The loop must keep animating while the editor is unfocused (watching
        // it side-by-side with an art tool is the whole point).
        Application.runInBackground = true;
        StartCoroutine(RunLoop());
    }

    private IEnumerator RunLoop()
    {
        var arena = LoadArena();
        for (int battle = 0; ; battle++)
        {
            rng = new System.Random(battle); // battle N always replays identically
            var init = BuildInit(battle, arena);
            if (randomObstacles) init.arena.blockedHexes = null; // HexGrid rolls a set from battleId
            hexGrid.BuildGrid(init.arena, init.battleId);
            manager.Initialize(init);
            manager.SyncUnits(BuildSync(0));
            Debug.Log($"[DemoLoop] Battle {battle}: " +
                      $"A [{Classes[units[0].classIdx]}, {Classes[units[1].classIdx]}, {Classes[units[2].classIdx]}] vs " +
                      $"B [{Classes[units[3].classIdx]}, {Classes[units[4].classIdx]}, {Classes[units[5].classIdx]}]");
            yield return new WaitForSeconds(1f);

            for (int round = 1; round <= maxRoundsPerBattle; round++)
            {
                // V3 HUD signals (turn strip, active panel, clock) around each demo round.
                var actor = units.Find(u => u.alive);
                if (actor != null)
                {
                    manager.StartTurn(new TurnStartData { turn = round, lobsterId = actor.id, side = actor.side, deadlineMs = 0, isPlayer = actor.side == "A" });
                    manager.UpdateBar(new BarData { turn = round, entries = BuildBar() });
                    manager.SetClock(actor.side == "A" ? 15000 : 0);
                    manager.SetSelection(new SelectionData
                    {
                        isPlayerTurn = actor.side == "A", canAct = true, action = "attack",
                        canSpecial = round >= 3, specialName = LobsterClasses.SpecialName(actor.classIdx), specialKind = "enemy",
                        hasMove = false, targetId = "", targetCount = 1, canUndo = round % 2 == 0, hint = "", pendingAck = false,
                    });
                }
                var result = SimulateRound(round);
                manager.PlayRound(result);
                yield return new WaitUntil(() => manager.currentPhase != BattleManager.BattlePhase.AnimatingRound);
                manager.SyncUnits(BuildSync(round));
                yield return new WaitForSeconds(roundGap);

                string wiped = WipedSide();
                if (wiped != null)
                {
                    string winner = wiped == "A" ? "B" : "A";
                    manager.OnBattleEnd(new BattleEndData { winner = winner, playerWon = winner == "A" });
                    break;
                }
            }

            yield return new WaitForSeconds(battleGap);
        }
    }

    private ArenaLayout LoadArena()
    {
        TextAsset json = layoutJson;
#if UNITY_EDITOR
        if (json == null)
        {
            json = UnityEditor.AssetDatabase.LoadAssetAtPath<TextAsset>(
                "Assets/ArenaLayouts/arena_apex_02.json");
        }
#endif
        if (json != null) return JsonUtility.FromJson<ArenaLayout>(json.text);

        Debug.LogWarning("[DemoLoop] No layout JSON found — using open 6x5 fallback.");
        return new ArenaLayout
        {
            layoutId = "demo_fallback",
            cols = 6,
            rows = 5,
            blockedHexes = new HexPosition[0],
            teamASpawns = new[] { new HexPosition { col = 0, row = 1 }, new HexPosition { col = 0, row = 2 }, new HexPosition { col = 0, row = 3 } },
            teamBSpawns = new[] { new HexPosition { col = 5, row = 1 }, new HexPosition { col = 5, row = 2 }, new HexPosition { col = 5, row = 3 } },
            tier = tier,
        };
    }

    private BattleInitData BuildInit(int battle, ArenaLayout arena)
    {
        arena.tier = tier;
        int tierInt = tier.ToLowerInvariant() switch { "evolved" => 1, "elite" => 2, _ => 3 };

        units.Clear();
        var teamA = new BattleLobsterData[3];
        var teamB = new BattleLobsterData[3];
        for (int k = 0; k < 6; k++)
        {
            bool isA = k < 3;
            int slot = k % 3;
            int classIdx = (battle * 6 + k) % Classes.Length;
            var spawn = isA ? arena.teamASpawns[slot] : arena.teamBSpawns[slot];
            var unit = new DemoUnit
            {
                id = (isA ? "A" : "B") + slot,
                classIdx = classIdx,
                side = isA ? "A" : "B",
                slot = slot,
                col = spawn.col,
                row = spawn.row,
                hp = 900,
            };
            units.Add(unit);

            var data = new BattleLobsterData
            {
                id = unit.id,
                classId = classIdx,
                className = Classes[classIdx],
                tier = tierInt,
                side = unit.side,
                slot = slot,
                maxHp = unit.hp,
                currentHp = unit.hp,
                position = new HexPosition { col = unit.col, row = unit.row },
                charge = 0,
                damage = 0,
                moveRange = 2,
                alive = true,
            };
            // One composited portrait per battle so the HUD's DNA path is exercised.
            if (k == 1) data.partClassIds = new[] { (classIdx + 3) % 10, classIdx, classIdx, (classIdx + 7) % 10, (classIdx + 5) % 10, classIdx };
            if (isA) teamA[slot] = data; else teamB[slot] = data;
        }

        return new BattleInitData
        {
            battleId = $"demo-loop-{battle}",
            arena = arena,
            teamA = teamA,
            teamB = teamB,
            playerSide = "A",
            playerBadge = "demo",
            opponentBadge = "demo",
            stakeBracket = "demo",
            stakeAmount = 0,
        };
    }

    private RoundResult SimulateRound(int round)
    {
        var movements = new List<MovementResult>();
        var actions = new List<ActionResult>();
        var deaths = new List<string>();

        // Interleave sides (A0, B0, A1, B1, ...) so the exchange reads turn-based.
        var order = new List<DemoUnit>();
        for (int slot = 0; slot < 3; slot++)
        {
            var a = units.Find(u => u.side == "A" && u.slot == slot);
            var b = units.Find(u => u.side == "B" && u.slot == slot);
            if (a is { alive: true }) order.Add(a);
            if (b is { alive: true }) order.Add(b);
        }

        // 1. Movement: close toward the nearest enemy (ranged classes hold at <= 3).
        var occupied = new HashSet<(int, int)>();
        foreach (var u in units) if (u.alive) occupied.Add((u.col, u.row));

        foreach (var u in order)
        {
            var enemy = NearestEnemy(u);
            if (enemy == null) continue;
            int dist = HexCoord.Distance(u.col, u.row, enemy.col, enemy.row);
            if (dist <= 1 || (u.Ranged && dist <= 3)) continue;

            var path = hexGrid.FindPath(u.col, u.row, enemy.col, enemy.row);
            if (path.Count == 0) continue;

            // Walk up to moveRange cells, stopping short of the enemy's own cell
            // and never ending on an occupied one.
            int maxSteps = Mathf.Min(2, path.Count - 1);
            for (int s = maxSteps - 1; s >= 0; s--)
            {
                var cell = path[s];
                if (occupied.Contains((cell.x, cell.y))) continue;
                occupied.Remove((u.col, u.row));
                movements.Add(new MovementResult
                {
                    lobsterId = u.id,
                    from = new HexPosition { col = u.col, row = u.row },
                    to = new HexPosition { col = cell.x, row = cell.y },
                });
                u.col = cell.x;
                u.row = cell.y;
                occupied.Add((cell.x, cell.y));
                break;
            }
        }

        // 2. Actions: attack when in reach, otherwise defend. One special per
        // round from round 3 on, so the designer can hang Special VFX timing.
        bool specialUsed = false;
        foreach (var u in order)
        {
            if (!u.alive) continue; // may have been killed earlier this round
            var enemy = NearestEnemy(u);
            if (enemy == null) break;
            int dist = HexCoord.Distance(u.col, u.row, enemy.col, enemy.row);
            bool inReach = u.Ranged ? dist <= 3 : dist <= 1;

            if (inReach)
            {
                bool special = !specialUsed && round >= 3 && rng.NextDouble() < 0.35;
                specialUsed |= special;
                bool crit = rng.NextDouble() < 0.25;
                int damage = (int)((special ? 260 : 140 + rng.Next(80)) * (crit ? 1.5f : 1f));
                actions.Add(new ActionResult
                {
                    actorId = u.id,
                    actionType = special ? "special" : "attack",
                    targetId = enemy.id,
                    damage = damage,
                    healed = 0,
                    crit = crit,
                    distance = dist,
                    distanceModifier = 1f,
                    moveType = special ? "special" : "attack",
                    enhanced = special && rng.NextDouble() < 0.5,
                });
                enemy.hp -= damage;
                if (enemy.hp <= 0 && enemy.alive)
                {
                    enemy.alive = false;
                    deaths.Add(enemy.id);
                }
            }
            else if (rng.NextDouble() < 0.4)
            {
                actions.Add(new ActionResult
                {
                    actorId = u.id,
                    actionType = "defend",
                    targetId = "",
                    damage = 0,
                    healed = 0,
                    crit = false,
                    distance = 0,
                    distanceModifier = 1f,
                    moveType = "defend",
                    enhanced = false,
                });
            }
        }

        return new RoundResult
        {
            round = round,
            movements = movements.ToArray(),
            actions = actions.ToArray(),
            deaths = deaths.ToArray(),
        };
    }

    private BarEntryData[] BuildBar()
    {
        var entries = new List<BarEntryData>();
        var alive = units.FindAll(u => u.alive);
        for (int i = 0; entries.Count < 8 && alive.Count > 0; i++)
        {
            var u = alive[i % alive.Count];
            entries.Add(new BarEntryData { lobsterId = u.id, tick = (i * 100).ToString() });
        }
        return entries.ToArray();
    }

    private UnitsSyncData BuildSync(int round)
    {
        var list = new List<UnitSyncData>();
        foreach (var u in units)
        {
            var statuses = new List<StatusData>();
            if (round >= 2 && u.side == "B" && u.slot == 0 && u.alive) statuses.Add(new StatusData { type = "bleed", turns = 3 });
            if (round >= 4 && u.side == "A" && u.slot == 2 && u.alive) statuses.Add(new StatusData { type = "stun", turns = 1 });
            list.Add(new UnitSyncData
            {
                lobsterId = u.id, hp = Mathf.Max(0, u.hp), maxHp = 900, alive = u.alive,
                charge = round % 4, defending = round % 3 == 0 && u.side == "B",
                col = u.col, row = u.row, statuses = statuses.ToArray(),
            });
        }
        return new UnitsSyncData { turn = round, units = list.ToArray() };
    }

    private DemoUnit NearestEnemy(DemoUnit u)
    {
        DemoUnit best = null;
        int bestDist = int.MaxValue;
        foreach (var other in units)
        {
            if (!other.alive || other.side == u.side) continue;
            int d = HexCoord.Distance(u.col, u.row, other.col, other.row);
            if (d < bestDist)
            {
                bestDist = d;
                best = other;
            }
        }
        return best;
    }

    private string WipedSide()
    {
        bool aAlive = units.Exists(u => u.side == "A" && u.alive);
        bool bAlive = units.Exists(u => u.side == "B" && u.alive);
        if (!aAlive) return "A";
        if (!bAlive) return "B";
        return null;
    }
}
