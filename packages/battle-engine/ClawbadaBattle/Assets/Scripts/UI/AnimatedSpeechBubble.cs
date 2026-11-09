using UnityEngine;
using UnityEngine.UI;
namespace Clawbada.UI {
/// <summary>Text-sized pixel-art bubble. 1/2 lines: touching cap bands; 3+ lines: repeated middle rows.</summary>
[DisallowMultipleComponent]
public sealed class AnimatedSpeechBubble : MonoBehaviour {
 [SerializeField] Image top, bottom, middle, connector;
 [SerializeField] Text label;
 [SerializeField] Sprite[] topFrames, bottomFrames, middleFrames, connectorFrames;
 [SerializeField, TextArea] string message="Ready?";
 [SerializeField] bool playOnEnable=true;
 double elapsed; bool playing; Vector2 expandedSize;
 public const double MainDuration=.6;
 public int MainFrame {get;private set;} public int ConnectorFrame {get;private set;}=-1;
 [SerializeField] float[] mainDurations={.1f,.1f,.1f,.1f,.1f,.1f}, connectorDurations={.1f,.1f,.1f,.1f};
 public bool IsOpen=>elapsed+1e-7>=System.Math.Max(Duration(mainDurations),Duration(connectorDurations)); public Vector2 ExpandedSize=>expandedSize;
 static double Duration(float[] durations){double total=0;foreach(var d in durations)total+=d;return total;}
 static int FrameAt(double time,float[] durations,int count){double end=0;for(int i=0;i<count-1;i++){end+=durations[i];if(time+1e-7<end)return i;}return count-1;}
 public int LineCount {get;private set;} public float MiddleHeight {get;private set;}
 /// <summary>Text size and line pitch (art px). The cap bands hold 20 px of text; taller text grows the middle rows.</summary>
 public const int FontPx=20; public const float LinePitch=14f;
 /// <summary>The cap bands hold 24 px; text gets 4 px clear above and below, so taller text grows the middle rows.</summary>
 const float CapRoom=24f, TextPad=8f, GlyphOverhang=2f;
 static float MiddleForText(float textHeight)=>Mathf.Max(0f,Mathf.Ceil((textHeight+TextPad-CapRoom)/2)*2);
 /// <summary>Estimate before the bubble exists (the coach places him with it): Upheaval's capitals stand a little above
 /// the line pitch.</summary>
 public static float HeightFor(int lines)=>CapRoom+MiddleForText(lines*LinePitch+GlyphOverhang);
 public Text Label=>label;
 void OnEnable(){if(label!=null)SetText(message);if(playOnEnable)Replay();}
 void Update(){if(playing){Evaluate(elapsed+Time.unscaledDeltaTime);if(IsOpen)playing=false;}}
 public void Replay(){playing=true;Evaluate(0);}
 /// <summary>Explicit newlines determine line count; width follows the longest line. No gameplay integration.</summary>
 public void SetText(string text){
  message=(text??"").Replace("\r",""); if(label==null)return;
  // Upheaval at its 20 px grid (Nzib 2026-11-09, one in-game face); lines LinePitch apart whatever the font's own leading.
  label.text=message; label.fontSize=FontPx;label.resizeTextForBestFit=false;
  if(label.font!=null&&label.font.lineHeight>0)label.lineSpacing=LinePitch/(label.font.lineHeight*FontPx/(float)Mathf.Max(1,label.font.fontSize));
  label.horizontalOverflow=HorizontalWrapMode.Overflow;label.verticalOverflow=VerticalWrapMode.Overflow;
  var lines=message.Split('\n');LineCount=lines.Length;
  float width=0;var settings=label.GetGenerationSettings(Vector2.zero);settings.generateOutOfBounds=true;
  foreach(var line in lines)width=Mathf.Max(width,label.cachedTextGeneratorForLayout.GetPreferredWidth(line,settings)/label.pixelsPerUnit);
  float textHeight=label.cachedTextGeneratorForLayout.GetPreferredHeight(message,settings)/label.pixelsPerUnit;
  MiddleHeight=MiddleForText(Mathf.Max(textHeight,LineCount*LinePitch));
  expandedSize=new Vector2(Mathf.Max(44,Mathf.Ceil((width+28)/2)*2),24+MiddleHeight);
  ((RectTransform)transform).sizeDelta=expandedSize;
  label.rectTransform.sizeDelta=new Vector2(expandedSize.x-12,expandedSize.y-4);
  Evaluate(elapsed);
 }
 // Kept for existing art-preview callers; text remains the sizing authority.
 public void SetExpandedSize(Vector2 unused){SetText(message);}
 public void Evaluate(double seconds){
  elapsed=System.Math.Max(0,seconds);
  if(top==null||topFrames==null||topFrames.Length!=6)return;
  MainFrame=FrameAt(elapsed,mainDurations,topFrames.Length);
  top.sprite=topFrames[MainFrame];bottom.sprite=bottomFrames[MainFrame];middle.sprite=middleFrames[MainFrame];
  float cap=top.sprite.rect.height, sourceWidth=top.sprite.rect.width;
  float width=Mathf.Max(sourceWidth,Mathf.Round(expandedSize.x*sourceWidth/44f/2)*2);
  float mid=MiddleHeight<=0?0:Mathf.Round(MiddleHeight*sourceWidth/44f/2)*2;
  top.rectTransform.sizeDelta=new Vector2(width,cap);bottom.rectTransform.sizeDelta=new Vector2(width,cap);
  top.rectTransform.anchoredPosition=new Vector2(0,(mid+cap)/2);bottom.rectTransform.anchoredPosition=new Vector2(0,-(mid+cap)/2);
  middle.enabled=mid>0;middle.rectTransform.sizeDelta=new Vector2(width,mid);
  label.enabled=elapsed>=MainDuration;
  ConnectorFrame=FrameAt(elapsed,connectorDurations,connectorFrames.Length);
  connector.enabled=ConnectorFrame>=0;if(ConnectorFrame>=0)connector.sprite=connectorFrames[ConnectorFrame];
  connector.rectTransform.anchoredPosition=new Vector2(-expandedSize.x/2-2,-expandedSize.y/2-12);
 }
}
}
