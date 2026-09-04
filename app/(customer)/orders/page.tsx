import Link from "next/link";
import { requireProfile } from "@/lib/auth/guards";
import { listCustomerOrderGroups } from "@/lib/data/orders";
import { Card } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/customer/order-status-badge";

/**
 * Customer order history (SRS Phase 3: "Customer order history and order
 * detail"). Groups are shown newest-first, each showing every restaurant
 * order within it (SRS V2 §J: multi-restaurant order groups). `justPaid`
 * is set by the Razorpay success redirect purely for a one-line banner —
 * it never affects what data is trusted or displayed.
 */
export default async function OrdersPage({ searchParams }: { searchParams: { justPaid?: string } }) {
  const profile = await requireProfile();
  const groups = await listCustomerOrderGroups(profile.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">Your orders</h1>

      {searchParams.justPaid && (
        <p className="mt-4 rounded-brand bg-success-bg px-4 py-3 text-sm text-success">
          Payment received — your order is confirmed below.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="mt-8 text-ink-soft">
          No orders yet.{" "}
          <Link href="/restaurants" className="font-medium text-orange-600 underline">
            Browse restaurants
          </Link>
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {groups.map((group) => (
            <Link key={group.groupId} href={`/orders/${group.groupId}`}>
              <Card className="transition-shadow hover:shadow-md">
                <p className="text-xs text-ink-muted">
                  {new Date(group.createdAt).toLocaleDateString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "medium",
                  })}
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {group.orders.map((o) => (
                    <div key={o.orderId} className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{o.restaurantName}</span>
                      <OrderStatusBadge status={o.status} />
                    </div>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
