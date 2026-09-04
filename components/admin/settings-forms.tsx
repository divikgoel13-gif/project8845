"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateFeatureFlag, updateMaintenanceMode } from "@/lib/actions/admin/platform";
import { updateCommissionRate } from "@/lib/actions/admin/update-commission-rate";
import { updateSetting } from "@/lib/actions/admin/settings";
import { updateNotificationTemplate } from "@/lib/actions/admin/notification-templates";
import { updateRetentionPolicy } from "@/lib/actions/admin/data-retention";
import {
  buildSettingValue,
  extractFieldValues,
  type SettingField,
} from "@/lib/admin/settings-field-specs";
import type { Json } from "@/types/database";

/**
 * Duplicated from `lib/platform/data-retention.ts`'s `RETENTION_DISPOSITIONS`
 * rather than imported: that module starts with `import "server-only"`, and
 * this file is a "use client" component — the same reason
 * `lib/admin/settings-field-specs.ts` duplicates `SETTING_KEYS` instead of
 * importing it.
 */
const RETENTION_DISPOSITIONS = ["retain_indefinitely", "archive", "anonymize", "delete"] as const;
type RetentionDisposition = (typeof RETENTION_DISPOSITIONS)[number];
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select, Checkbox, FormError, FormSuccess } from "@/components/ui/field";

/**
 * Every form here follows the same shape: local field state, a `reason`
 * field where §11.5/§Q/§R/§P require one, a `useTransition` submit that
 * calls one audited Server Action, and an inline success/error message. None
 * of them use `router.refresh()` blindly on success — each revalidates its
 * own path server-side (see the action files), so a refresh here is about
 * re-pulling the now-current value into this form, not a substitute for the
 * action's own revalidation.
 */

function useSavedReset(ms = 4000) {
  const [saved, setSaved] = useState(false);
  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), ms);
  }
  return [saved, flash] as const;
}

export function FeatureFlagToggle({ flagKey, enabled, description }: { flagKey: string; enabled: boolean; description: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await updateFeatureFlag({ key: flagKey, enabled: next, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold text-ink">{flagKey}</p>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        {editing ? (
          <div className="mt-2 max-w-sm">
            <Field label="Reason" htmlFor={`flag-reason-${flagKey}`} required>
              <Input id={`flag-reason-${flagKey}`} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            </Field>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" onClick={() => submit(!enabled)} disabled={pending || reason.trim().length === 0}>
                {pending ? "Saving…" : enabled ? "Confirm disable" : "Confirm enable"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
            <FormError>{error}</FormError>
          </div>
        ) : null}
      </div>
      <div className="shrink-0">
        <Button
          type="button"
          size="sm"
          variant={enabled ? "secondary" : "ghost"}
          onClick={() => setEditing(true)}
          disabled={editing}
        >
          {enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>
    </div>
  );
}

export function MaintenanceModeForm({
  moduleKey,
  isActive,
  message,
}: {
  moduleKey: string;
  isActive: boolean;
  message: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nextActive, setNextActive] = useState(isActive);
  const [nextMessage, setNextMessage] = useState(message ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, flash] = useSavedReset();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateMaintenanceMode({
        key: moduleKey,
        isActive: nextActive,
        message: nextMessage.trim() || null,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReason("");
      flash();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Checkbox
        id={`maint-active-${moduleKey}`}
        checked={nextActive}
        onChange={(e) => setNextActive(e.currentTarget.checked)}
        label={`${moduleKey === "global" ? "Platform" : moduleKey} is in maintenance`}
      />
      <Field
        label="Customer-facing message"
        htmlFor={`maint-msg-${moduleKey}`}
        hint="Shown instead of a generic failure. Leave blank for the default message."
      >
        <Textarea
          id={`maint-msg-${moduleKey}`}
          value={nextMessage}
          maxLength={500}
          rows={2}
          onChange={(e) => setNextMessage(e.currentTarget.value)}
        />
      </Field>
      <Field label="Reason" htmlFor={`maint-reason-${moduleKey}`} required>
        <Input id={`maint-reason-${moduleKey}`} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      </Field>
      <div>
        <Button type="button" size="sm" onClick={submit} disabled={pending || reason.trim().length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved ? <FormSuccess>Saved.</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

export function CommissionRateForm({ currentRate }: { currentRate: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rate, setRate] = useState(String(currentRate));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, flash] = useSavedReset();

  function submit() {
    setError(null);
    const parsed = Number.parseFloat(rate);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      setError("Enter a fraction between 0 and 1 (e.g. 0.08 for 8%).");
      return;
    }
    startTransition(async () => {
      // updateCommissionRate predates the ok/error convention the rest of
      // Phase 9 uses and throws instead — caught here rather than changed
      // there, since it is an already-shipped Phase 7 action with its own
      // audit action name (`commission_rate.updated`) that this form reuses
      // verbatim rather than forking.
      try {
        await updateCommissionRate({ newRate: parsed, reason });
        setReason("");
        flash();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the commission rate.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Commission rate" htmlFor="commission-rate" hint={`Currently ${Math.round(currentRate * 100)}%`} className="w-40">
        <Input id="commission-rate" type="number" min={0} max={1} step={0.01} value={rate} onChange={(e) => setRate(e.currentTarget.value)} />
      </Field>
      <Field label="Reason" htmlFor="commission-reason" required className="w-72">
        <Input id="commission-reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      </Field>
      <div className="pb-1">
        <Button type="button" size="sm" onClick={submit} disabled={pending || reason.trim().length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {saved ? <FormSuccess>Saved.</FormSuccess> : null}
      <FormError>{error}</FormError>
    </div>
  );
}

/** Generic form for the nine non-commission `admin_settings` keys, driven by
 *  a `SettingSpec` from lib/admin/settings-field-specs.ts. Handles both a
 *  single scalar field and a multi-field object uniformly. */
export function SettingValueForm({
  settingKey,
  fields,
  initialValue,
}: {
  settingKey: string;
  fields: SettingField[];
  initialValue: Json | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const numeric = extractFieldValues(initialValue, fields);
    const strings: Record<string, string> = {};
    for (const [k, v] of Object.entries(numeric)) strings[k] = String(v);
    return strings;
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, flash] = useSavedReset();

  function setField(path: string, raw: string) {
    setValues((prev) => ({ ...prev, [path]: raw }));
  }

  function submit() {
    setError(null);
    const numeric: Record<string, number> = {};
    for (const field of fields) {
      const key = field.path ?? "_scalar";
      const parsed = Number.parseFloat(values[key] ?? "");
      if (!Number.isFinite(parsed)) {
        setError(`Enter a number for "${field.label}".`);
        return;
      }
      numeric[key] = parsed;
    }

    startTransition(async () => {
      const result = await updateSetting({ key: settingKey, value: buildSettingValue(fields, numeric), reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReason("");
      flash();
      router.refresh();
    });
  }

  return (
    <div>
      <div className={fields.length > 1 ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "flex"}>
        {fields.map((field) => {
          const key = field.path ?? "_scalar";
          return (
            <Field key={key} label={field.label} htmlFor={`${settingKey}-${key}`} hint={field.hint} className={fields.length === 1 ? "w-48" : undefined}>
              <Input
                id={`${settingKey}-${key}`}
                type="number"
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                value={values[key] ?? ""}
                onChange={(e) => setField(key, e.currentTarget.value)}
              />
            </Field>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Reason" htmlFor={`${settingKey}-reason`} required className="w-72">
          <Input id={`${settingKey}-reason`} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        </Field>
        <div className="pb-1">
          <Button type="button" size="sm" onClick={submit} disabled={pending || reason.trim().length === 0}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
        {saved ? <FormSuccess>Saved.</FormSuccess> : null}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}

export function NotificationTemplateForm({
  templateKey,
  title,
  body,
  description,
  isActive,
  editable,
}: {
  templateKey: string;
  title: string | null;
  body: string;
  description: string | null;
  isActive: boolean;
  /** `channel = 'sms'` rows are retired history (see lib/platform/notification-templates.ts) — shown, not editable. */
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nextTitle, setNextTitle] = useState(title ?? "");
  const [nextBody, setNextBody] = useState(body);
  const [nextActive, setNextActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [saved, flash] = useSavedReset();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateNotificationTemplate({
        key: templateKey,
        title: nextTitle.trim() || null,
        body: nextBody,
        description,
        isActive: nextActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      flash();
      router.refresh();
    });
  }

  if (!editable) {
    return (
      <div className="opacity-60">
        <p className="text-sm font-medium text-ink">{title ?? templateKey}</p>
        <p className="mt-1 text-xs text-ink-muted">{body}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label="Title" htmlFor={`tmpl-title-${templateKey}`}>
        <Input id={`tmpl-title-${templateKey}`} value={nextTitle} maxLength={200} onChange={(e) => setNextTitle(e.currentTarget.value)} />
      </Field>
      <Field
        label="Body"
        htmlFor={`tmpl-body-${templateKey}`}
        hint={description ?? undefined}
      >
        <Textarea id={`tmpl-body-${templateKey}`} value={nextBody} maxLength={1000} rows={2} onChange={(e) => setNextBody(e.currentTarget.value)} />
      </Field>
      <Checkbox
        id={`tmpl-active-${templateKey}`}
        checked={nextActive}
        onChange={(e) => setNextActive(e.currentTarget.checked)}
        label="Active"
      />
      <div>
        <Button type="button" size="sm" onClick={submit} disabled={pending || nextBody.trim().length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved ? <FormSuccess>Saved.</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

export function RetentionPolicyForm({
  domain,
  retentionPeriod,
  disposition,
  rationale,
  automated,
}: {
  domain: string;
  retentionPeriod: string;
  disposition: RetentionDisposition;
  rationale: string | null;
  automated: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [period, setPeriod] = useState(retentionPeriod);
  const [nextDisposition, setNextDisposition] = useState<RetentionDisposition>(disposition);
  const [nextRationale, setNextRationale] = useState(rationale ?? "");
  const [nextAutomated, setNextAutomated] = useState(automated);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateRetentionPolicy({
        domain,
        retentionPeriod: period,
        disposition: nextDisposition,
        rationale: nextRationale.trim() || null,
        automated: nextAutomated,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setReason("");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Edit
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-brand border border-cream-300 bg-cream-50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Retention period" htmlFor={`ret-period-${domain}`}>
          <Input id={`ret-period-${domain}`} value={period} onChange={(e) => setPeriod(e.currentTarget.value)} />
        </Field>
        <Field label="Disposition" htmlFor={`ret-disp-${domain}`}>
          <Select id={`ret-disp-${domain}`} value={nextDisposition} onChange={(e) => setNextDisposition(e.currentTarget.value as RetentionDisposition)}>
            {RETENTION_DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Rationale" htmlFor={`ret-rationale-${domain}`}>
        <Textarea id={`ret-rationale-${domain}`} value={nextRationale} rows={2} maxLength={1000} onChange={(e) => setNextRationale(e.currentTarget.value)} />
      </Field>
      <Checkbox
        id={`ret-auto-${domain}`}
        checked={nextAutomated}
        onChange={(e) => setNextAutomated(e.currentTarget.checked)}
        label="Deletion/archival is automated (not yet true for any V1 domain)"
      />
      <Field label="Reason" htmlFor={`ret-reason-${domain}`} required>
        <Input id={`ret-reason-${domain}`} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={pending || reason.trim().length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
