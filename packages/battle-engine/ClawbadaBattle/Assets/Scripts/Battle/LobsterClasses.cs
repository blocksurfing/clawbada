/// <summary>
/// Class id ↔ name tables shared by the rig code, the demo loop and the HUD.
/// Order matches the LobsterClass enum in packages/game-logic (Bulwark = 0 … Ember = 9).
/// </summary>
public static class LobsterClasses
{
    public static readonly string[] Names =
    {
        "Bulwark", "Mantis", "Leviathan", "Tempest", "Specter",
        "Sentinel", "Reaver", "Abyss", "Kraken", "Ember",
    };

    public static readonly string[] SpecialNames =
    {
        "Fortify", "Ambush", "Crush", "Maelstrom", "Haunt",
        "Rally", "Rend", "Devour", "Bind", "Inferno",
    };

    public static string Name(int classId) =>
        classId >= 0 && classId < Names.Length ? Names[classId] : $"Class{classId}";

    public static string SpecialName(int classId) =>
        classId >= 0 && classId < SpecialNames.Length ? SpecialNames[classId] : "Special";

    /// <summary>1 → Evolved, 2 → Elite, 3 → Apex (same rule as LobsterPrefabLibrary.TierName).</summary>
    public static string TierName(int tier) => LobsterPrefabLibrary.TierName(tier);
}
