import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminView } from "@/components/admin/AdminView";
import { loadAdminData } from "@/lib/data/admin";

/**
 * Admin view (ADMIN_EMAILS only; everyone else gets a 404 from the proxy, and again here). The floor plan and the
 * tiles live in this layout so they stay mounted while /admin/<item> pages open and close in the panel.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="p-6 font-mono text-sm text-muted">Loading the plan.</p>}>
      <Admin>{children}</Admin>
    </Suspense>
  );
}

async function Admin({ children }: { children: React.ReactNode }) {
  const data = await loadAdminData();
  if (!data) notFound();
  return <AdminView data={data}>{children}</AdminView>;
}
