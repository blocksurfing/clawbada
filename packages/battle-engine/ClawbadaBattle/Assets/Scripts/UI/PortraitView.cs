using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Hex-masked portrait composited from the lobster's own body-part sprites
/// (Carapace + Antennae + Eyes from LobsterPartLibrary, following the DNA slot
/// mapping used by LobsterController.ApplyGenetics), with a team-tinted frame.
/// Team A is mirrored so the two sides face each other on the strip.
/// </summary>
public class PortraitView : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    private HudSkin skin;
    private Image frame;
    private Image maskImage;
    private RectTransform parts;
    private Image carapace, antennae, eyes;
    private float width;

    public static PortraitView Create(Transform parent, string name, HudSkin skin, float width)
    {
        bool large = width >= 80f;
        Sprite frameSprite = large ? skin.hexFrame96 : skin.hexFrame56;
        Sprite maskSprite = large ? skin.hexMask96 : skin.hexMask56;
        float height = width * 1.143f;

        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, new Vector2(width, height));
        var view = rt.gameObject.AddComponent<PortraitView>();
        view.Rect = rt;
        view.skin = skin;
        view.width = width;

        // Mask: the hex fill clips the parts drawn under it.
        var maskRt = HudFactory.Stretch(rt, "Mask");
        view.maskImage = HudFactory.AddImage(maskRt, maskSprite, new Color(0.06f, 0.12f, 0.2f, 1f));
        var mask = maskRt.gameObject.AddComponent<Mask>();
        mask.showMaskGraphic = true; // dark hex backdrop behind the parts

        view.parts = HudFactory.Rect(maskRt, "Parts", HudFactory.Center, HudFactory.Center, HudFactory.Center, skin.portraitPartOffset, new Vector2(64f, 64f));
        view.carapace = HudFactory.Image(view.parts, "Carapace", null, Color.white, new Vector2(64f, 64f));
        view.antennae = HudFactory.Image(view.parts, "Antennae", null, Color.white, new Vector2(64f, 64f));
        view.eyes = HudFactory.Image(view.parts, "Eyes", null, Color.white, new Vector2(64f, 64f));

        var frameRt = HudFactory.Stretch(rt, "Frame");
        view.frame = HudFactory.AddImage(frameRt, frameSprite, Color.white);
        return view;
    }

    public void Compose(LobsterController lob, LobsterPartLibrary lib)
    {
        if (lob == null) return;
        int[] ids = lob.partClassIds;
        int carapaceClass = ids != null && ids.Length == 6 ? ids[0] : lob.classId;
        int antennaeClass = ids != null && ids.Length == 6 ? ids[3] : lob.classId;
        int eyesClass = ids != null && ids.Length == 6 ? ids[4] : lob.classId;

        Assign(carapace, lib, lob.tier, carapaceClass, "Carapace", lob.className);
        Assign(antennae, lib, lob.tier, antennaeClass, "Antennae", lob.className);
        Assign(eyes, lib, lob.tier, eyesClass, "Eyes", lob.className);

        float s = width * skin.portraitPartScale / 64f;
        parts.localScale = new Vector3(lob.side == "A" ? -s : s, s, 1f);
        SetFrameColor(skin.TeamColor(lob.side));
    }

    private static void Assign(Image img, LobsterPartLibrary lib, int tier, int classId, string part, string hostClass)
    {
        Sprite sprite = null;
        if (lib != null)
        {
            sprite = lib.Get(tier, LobsterClasses.Name(classId), part);
            if (sprite == null) sprite = lib.Get(tier, hostClass, part);
        }
        img.sprite = sprite;
        img.enabled = sprite != null;
        if (sprite != null) img.SetNativeSize();
    }

    public void SetFrameColor(Color c) { if (frame != null) frame.color = c; }

    public void SetDimmed(bool dimmed)
    {
        var c = dimmed ? new Color(0.5f, 0.5f, 0.5f, 0.85f) : Color.white;
        carapace.color = c; antennae.color = c; eyes.color = c;
    }

    public void SetActive(bool active, Color ringColor)
    {
        if (active) frame.color = ringColor;
        transform.localScale = active ? new Vector3(1.15f, 1.15f, 1f) : Vector3.one;
    }
}
