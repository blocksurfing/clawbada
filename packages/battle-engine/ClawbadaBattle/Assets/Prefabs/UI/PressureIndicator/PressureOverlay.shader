// Built-in render pipeline: true destination-dependent Overlay, not normal alpha.
// Unnamed GrabPass captures the framebuffer immediately before this UI draw.
Shader "Clawbada/UI/PressureOverlay"
{
 Properties {
  [PerRendererData] _MainTex ("Sprite Texture", 2D) = "white" {}
  _Color ("Tint", Color) = (1,1,1,1)
  _StencilComp ("Stencil Comparison", Float) = 8
  _Stencil ("Stencil ID", Float) = 0
  _StencilOp ("Stencil Operation", Float) = 0
  _StencilWriteMask ("Stencil Write Mask", Float) = 255
  _StencilReadMask ("Stencil Read Mask", Float) = 255
  _ColorMask ("Color Mask", Float) = 15
  [Toggle(UNITY_UI_ALPHACLIP)] _UseUIAlphaClip ("Use Alpha Clip", Float) = 0
 }
 SubShader {
  Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" "PreviewType"="Plane" "CanUseSpriteAtlas"="True" }
  Stencil { Ref [_Stencil] Comp [_StencilComp] Pass [_StencilOp] ReadMask [_StencilReadMask] WriteMask [_StencilWriteMask] }
  Cull Off Lighting Off ZWrite Off ZTest [unity_GUIZTestMode]
  ColorMask [_ColorMask]
  GrabPass { }
  Pass {
   Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
   CGPROGRAM
   #pragma vertex vert
   #pragma fragment frag
   #pragma target 3.0
   #pragma multi_compile_local _ UNITY_UI_CLIP_RECT
   #pragma multi_compile_local _ UNITY_UI_ALPHACLIP
   #include "UnityCG.cginc"
   #include "UnityUI.cginc"
   struct appdata { float4 vertex:POSITION; float4 color:COLOR; float2 uv:TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
   struct v2f { float4 vertex:SV_POSITION; float4 color:COLOR; float2 uv:TEXCOORD0; float4 grab:TEXCOORD1; float4 local:TEXCOORD2; UNITY_VERTEX_OUTPUT_STEREO };
   sampler2D _MainTex; sampler2D _GrabTexture;
   float4 _Color, _TextureSampleAdd, _ClipRect;
   v2f vert(appdata v) { v2f o; UNITY_SETUP_INSTANCE_ID(v); UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o); o.local=v.vertex; o.vertex=UnityObjectToClipPos(v.vertex); o.grab=ComputeGrabScreenPos(o.vertex); o.uv=v.uv; o.color=v.color*_Color; return o; }
   float4 frag(v2f i):SV_Target {
    float4 s=(tex2D(_MainTex,i.uv)+_TextureSampleAdd)*i.color;
    float3 d=tex2Dproj(_GrabTexture,UNITY_PROJ_COORD(i.grab)).rgb;
    // Per-channel branch on DESTINATION, as required by Overlay.
    float3 overlay=lerp(2*d*s.rgb,1-2*(1-d)*(1-s.rgb),step(.5,d));
    #ifdef UNITY_UI_CLIP_RECT
    s.a*=UnityGet2DClipping(i.local.xy,_ClipRect);
    #endif
    #ifdef UNITY_UI_ALPHACLIP
    clip(s.a-.001);
    #endif
    return float4(overlay,s.a);
   }
   ENDCG
  }
 }
}
