import { requireSuperAdmin } from "@/lib/auth/guards";
import { listFeatureFlags } from "@/lib/platform/feature-flags";
import { listMaintenanceStates } from "@/lib/platform/maintenance";
import { getCommissionRate, getSettings, SETTING_KEYS } from "@/lib/platform/settings";
import { listNotificationTemplates } from "@/lib/platform/notification-templates";
import { listRetentionPolicies } from "@/lib/platform/data-retention";
import { SETTING_SPECS } from "@/lib/admin/settings-field-specs";
import { fmtDateTime } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FeatureFlagToggle,
  MaintenanceModeForm,
  CommissionRateForm,
  SettingValueForm,
  NotificationTemplateForm,
  RetentionPolicyForm,
} from "@/components/admin/settings-forms";

/**
 * Platform Settings (SRS §23, §Q, §R, §Y, §P; Phase 9). Five sections, each
 * backed by an already-audited action:
 *
 *   1. Feature flags (§Q) — server-enforced via `assertFeatureEnabled`,
 *      never a UI-only hide.
 *   2. Maintenance mode (§R) — server-enforced via `assertNotInMaintenance`,
 *      exempts super admins so a fix can be verified during the window.
 *   3. Commission & operational settings (§23, §11.5) — commission rate
 *      keeps its own dedicated, pre-existing action; the other nine keys go
 *      through one generic, per-key-validated action.
 *   4. Notification templates (§Y, V2.6 §63) — in-app copy is editable;
 *      retired SMS-era rows are shown as read-only history, never deleted
 *      (§70 non-removal).
 *   5. Data retention register (§P) — documented policy, editable so the
 *      operational and documented policy cannot drift.
 *
 * Every write on this page requires `requireSuperAdmin()` inside its own
 * action (defense in depth beyond this page's own guard, and beyond the
 * `(admin)` layout's `requireRole`), and every write that changes platform
 * BEHAVIOUR (flags, maintenance, operational settings, retention) requires a
 * reason. Only notification copy does not — see
 * lib/actions/admin/notification-templates.ts for why that one is different.
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSuperAdmin();

  const [flags, maintenanceStates, commissionRate, settingValues, templates, retentionPolicies] = await Promise.all([
    listFeatureFlags(),
    listMaintenanceStates(),
    getCommissionRate(),
    getSettings(SETTING_SPECS.map((s) => s.key)),
    listNotificationTemplates(),
    listRetentionPolicies(),
  ]);

  const activeTemplates = templates.filter((t) => t.channel === "inapp");
  const retiredTemplates = templates.filter((t) => t.channel !== "inapp");

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Platform-wide configuration. Every change here is audited with actor, time, previous value and (where the change affects behaviour, not just wording) a reason."
      />

      <nav className="mb-5 flex flex-wrap gap-2 text-xs">
        {[
          ["#flags", "Feature flags"],
          ["#maintenance", "Maintenance mode"],
          ["#operational", "Operational settings"],
          ["#notifications", "Notification templates"],
          ["#retention", "Data retention"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-brand border border-cream-300 bg-cream-50 px-2.5 py-1 font-medium text-ink-soft hover:bg-cream-200">
            {label}
          </a>
        ))}
      </nav>

      <section id="flags">
        <SectionHeading
          title="Feature flags"
          description="Enforced server-side by assertFeatureEnabled — disabling a flag here blocks the action, it does not just hide a button (SRS §Q)."
        />
        <Card className="mt-2 divide-y divide-cream-200">
          {flags.length === 0 ? (
            <p className="py-3 text-sm text-ink-muted">No flags found.</p>
          ) : (
            flags.map((f) => <FeatureFlagToggle key={f.key} flagKey={f.key} enabled={f.enabled} description={f.description} />)
          )}
        </Card>
      </section>

      <section id="maintenance" className="mt-6">
        <SectionHeading
          title="Maintenance mode"
          description="Existing paid orders stay accessible either way — this only blocks new writes (cart, checkout, new grievances). Super admins are exempt so a fix can be verified during the window (SRS §R)."
        />
        <div className="mt-2 flex flex-col gap-3">
          {maintenanceStates.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-muted">No maintenance rows found.</p>
            </Card>
          ) : (
            maintenanceStates.map((m) => (
              <Card key={m.key}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-ink">
                    {m.key === "global" ? "Platform-wide" : m.key}
                  </h3>
                  {m.isActive ? <Badge tone="danger">Active</Badge> : <Badge tone="success">Off</Badge>}
                </div>
                <MaintenanceModeForm moduleKey={m.key} isActive={m.isActive} message={m.message} />
              </Card>
            ))
          )}
        </div>
      </section>

      <section id="operational" className="mt-6">
        <SectionHeading
          title="Operational settings"
          description="Commission and penalty rates apply to orders created after the change — existing orders keep their own snapshot (SRS §11.5, §23). Restaurant defaults apply only to newly created restaurants."
        />
        <div className="mt-2 flex flex-col gap-3">
          <Card>
            <h3 className="mb-2 font-display text-sm font-semibold text-ink">Commission rate</h3>
            <p className="mb-2 text-xs text-ink-muted">Fraction of order value UNI8 retains. Snapshotted onto every order at creation.</p>
            <CommissionRateForm currentRate={commissionRate} />
          </Card>
          {SETTING_SPECS.map((spec) => (
            <Card key={spec.key}>
              <h3 className="font-display text-sm font-semibold text-ink">{spec.title}</h3>
              <p className="mb-2 text-xs text-ink-muted">{spec.description}</p>
              <SettingValueForm settingKey={spec.key} fields={spec.fields} initialValue={settingValues[spec.key] ?? null} />
            </Card>
          ))}
        </div>
      </section>

      <section id="notifications" className="mt-6">
        <SectionHeading
          title="Notification templates"
          description="In-app notification copy (SRS V2.6 §63). {{placeholders}} are filled in at send time — editing wording here never rewrites a notification already delivered."
        />
        <div className="mt-2 flex flex-col gap-3">
          {activeTemplates.map((t) => (
            <Card key={t.key}>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-xs text-ink-muted">{t.key}</p>
                {t.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
              </div>
              <NotificationTemplateForm
                templateKey={t.key}
                title={t.title}
                body={t.body}
                description={t.description}
                isActive={t.isActive}
                editable
              />
            </Card>
          ))}
        </div>

        {retiredTemplates.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft">
              {retiredTemplates.length} retired SMS-era template{retiredTemplates.length === 1 ? "" : "s"} (history, not deleted)
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {retiredTemplates.map((t) => (
                <Card key={t.key} className="bg-cream-100">
                  <p className="font-mono text-xs text-ink-muted">{t.key}</p>
                  <NotificationTemplateForm
                    templateKey={t.key}
                    title={t.title}
                    body={t.body}
                    description={t.description}
                    isActive={t.isActive}
                    editable={false}
                  />
                </Card>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section id="retention" className="mt-6">
        <SectionHeading
          title="Data retention register"
          description="Documented retention and disposition per data domain (SRS §P). Kept here, editable, so the operational policy and the documented policy cannot drift apart."
        />
        <Card className="mt-2 p-0">
          <div className="divide-y divide-cream-200">
            {retentionPolicies.map((p) => (
              <div key={p.domain} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-ink">{p.domain}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {p.retentionPeriod} — <span className="font-medium">{p.disposition.replace(/_/g, " ")}</span>
                      {p.automated ? " · automated" : " · manual"}
                    </p>
                    {p.rationale ? <p className="mt-1 text-xs text-ink-muted">{p.rationale}</p> : null}
                    <p className="mt-1 text-[11px] text-ink-muted">Updated {fmtDateTime(p.updatedAt)}</p>
                  </div>
                  <RetentionPolicyForm
                    domain={p.domain}
                    retentionPeriod={p.retentionPeriod}
                    disposition={p.disposition}
                    rationale={p.rationale}
                    automated={p.automated}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
