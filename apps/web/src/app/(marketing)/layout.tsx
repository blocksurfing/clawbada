export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen w-full"
      style={{
        backgroundImage:
          "linear-gradient(rgba(7,16,32,0.55), rgba(7,16,32,0.55)), url('/marketing/gutter.png')",
        backgroundSize: '100vw auto',
        backgroundRepeat: 'repeat-y',
        backgroundPosition: 'center top',
      }}
    >
      <div className="relative mx-auto max-w-[2400px] bg-ocean-deep">
        {children}
      </div>
    </div>
  );
}
