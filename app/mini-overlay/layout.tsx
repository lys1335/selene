export default function MiniOverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "transparent", width: "100vw", height: "100vh", overflow: "hidden" }}>
      {children}
    </div>
  );
}
