export default function MiniOverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "transparent", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <style>{`
        [data-sonner-toaster] { display: none !important; }
        .task-notification-toast { display: none !important; }
      `}</style>
      {children}
    </div>
  );
}
