// 路由切换时的加载骨架：让手机上的导航立即有反馈，而不是等服务器返回。
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="加载中">
      <div className="h-44 rounded-3xl border border-line bg-white/70" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 rounded-2xl border border-line bg-white/70" />
        ))}
      </div>
      <div className="h-6 w-40 rounded bg-paper-deep" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-line bg-white/70" />
        ))}
      </div>
    </div>
  );
}
